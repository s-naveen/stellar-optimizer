import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/furina, main as of 2026-11-10. */

// Normal attack string (gcsim's InitNormalCancelSlice, with its overrides): cancels into charged
// are the animation's length unless overridden
const furinaNormals: NormalHit[] = [
  {
    hitmarks: [15],
    hitlag: [5],
    toNormal: 31,
    toCharged: 34,
    toAbil: 15,
    frames: 34,
  },
  {
    hitmarks: [12],
    hitlag: [5],
    toNormal: 23,
    toCharged: 28,
    toAbil: 12,
    frames: 28,
  },
  {
    hitmarks: [21],
    hitlag: [5],
    toNormal: 36,
    toCharged: 45,
    toAbil: 21,
    frames: 48,
  },
  {
    hitmarks: [27],
    hitlag: [5],
    toNormal: 53,
    toCharged: 58,
    toAbil: 27,
    frames: 58,
  },
]

/**
 * Salon Solitaire's three members: each ticks from the summon with gcsim's mean interval (its
 * random offset is not modelled), and hits `travel` frames after a tick
 */
interface SalonMember {
  initial: number
  mean: number
  travel: number
  node: string
  /** % of each ally's max HP its tick drains (gcsim's consumeAlliesHealth) */
  drain: number
  icd: string
  icdGroup?: string
  label: string
}
const salon: SalonMember[] = [
  {
    initial: 72.3333,
    mean: 97.5858,
    travel: 20,
    node: 'chevalDmg',
    drain: 1.6,
    // (its own ICD counter, in the Salon Solitaire group: gcsim's ICDTagFurinaChevalmarin)
    icd: 'FurinaChevalmarin',
    icdGroup: 'FurinaSalonSolitaire',
    label: 'Surintendante Chevalmarin',
  },
  {
    initial: 74.5,
    mean: 202.138,
    travel: 40,
    node: 'usherDmg',
    drain: 2.4,
    // (its own ICD counter, in the Salon Solitaire group: gcsim's ICDTagFurinaUsher)
    icd: 'FurinaUsher',
    icdGroup: 'FurinaSalonSolitaire',
    label: 'Gentilhomme Usher',
  },
  {
    initial: 71.5926,
    mean: 313.859,
    travel: 41,
    node: 'crabDmg',
    drain: 3.6,
    icd: 'none',
    label: 'Mademoiselle Crabaletta',
  },
]

/** Let the People Rejoice's Fanfare lasts 18.2 s from 95 frames after the cast (gcsim's burstDur) */
const FANFARE_DUR = Math.round(18.2 * 60)
/** The party HP model: Furina and 3 allies, all above 50% HP (the drains always happen) */
const ALLIES = 4
/**
 * Fanfare comes from HP drained and from HP healed. The party is assumed to be healed back what the
 * Salon members drain (gcsim teams carry healing), so each drained % is also a healed % (x2)
 */
const FANFARE_PER_DRAIN = 2
/** gcsim's fanfareDrainToGainDelay: the gain lands a few frames after the drain */
const FANFARE_DELAY = 6
/** The Fanfare buff window is refreshed every 30 frames (it changes with every drain) */
const FANFARE_CHUNK = 30

interface FurinaState {
  /** Fanfare's debounce status: added at `debounceFrom`, active through `debounceEnd` */
  debounceFrom: number
  debounceEnd: number
  waltzEnd: number
  fanfare: number
  /** The Fanfare is up until this frame (-1: not up) */
  fanfareEnd: number
  /** The burst that Fanfare belongs to: a new burst ends the old one */
  fanfareSrc: number
  /** Ousia (Salon Solitaire) or Pneuma (Singer of Many Waters): changed by a charged attack */
  arkhe: 'ousia' | 'pneuma'
  /** The skill is up until this frame (1736 frames from its cast) */
  skillEnd: number
  /** The summon the Salon ticks belong to: a new summon ends the old ticks */
  salonSrc: number
  /** The latest burst animation in the party (its actor and frames), for the Salon's drain */
  burstAction?: { actor: string; start: number; end: number }
  /** C6 Center of Attention (10 s from the skill, hitlag-affected; ends after 6 triggers) */
  c6On: boolean
  c6Src: number
  c6Count: number
  /** C6's 0.1 s trigger ICD ends (frame) */
  c6IcdUntil: number
  /** C6 Ousia's heal status (2.9 s, extended by each trigger) and its run */
  c6HealEnd: number
  c6HealSrc: number
  /** The arkhe ICD of Spiritbreath Thorn (0) and Surging Blade (1): their 6 s ICD */
  arkheIcd: [number, number]
}

/** Fanfare points gained: C2 multiplies them by 3.5, up to its cap (gcsim's addFanfareFunc) */
function addFanfare(c: SimContext, s: FurinaState, points: number) {
  const cons = c.constellation('Furina')
  const max = cons >= 2 ? 800 : cons >= 1 ? 400 : 300
  s.fanfare = Math.min(max, s.fanfare + points * (cons >= 2 ? 3.5 : 1))
  if (c.healthTracked) {
    const cap = cons >= 1 ? 400 : 300
    c.state(
      'Furina',
      ['Furina', 'burstFanfare'],
      String(Math.round(Math.min(s.fanfare, cap)))
    )
    if (cons >= 2)
      c.state(
        'Furina',
        ['Furina', 'c2Overstack'],
        String(Math.round(Math.min(400, Math.max(0, s.fanfare - cap))))
      )
  }
}

/**
 * Keeps the Fanfare conditional (and C2's overstack HP) in step with the points: one window per
 * 30 frames, with the points rounded to the sheet's steps of 50
 */
function fanfareTick(c: SimContext, s: FurinaState, src: number) {
  if (src !== s.fanfareSrc || c.now >= s.fanfareEnd) return
  const len = Math.min(FANFARE_CHUNK, s.fanfareEnd - c.now)
  const cons = c.constellation('Furina')
  const maxQ = cons >= 1 ? 400 : 300
  const points = c.healthTracked
    ? Math.round(Math.min(s.fanfare, maxQ))
    : Math.round(Math.min(s.fanfare, maxQ) / 50) * 50
  if (c.healthTracked || points >= 50)
    c.buff('Furina', ['Furina', 'burstFanfare'], `${points}`, 0, len)
  if (cons >= 2) {
    // C2: the points above the cap (up to 400) add HP% (3.5x gain, 0.35% per point)
    const over = Math.min(
      c.healthTracked
        ? Math.round(s.fanfare - maxQ)
        : Math.floor((s.fanfare - maxQ) / 50) * 50,
      400
    )
    if ((c.healthTracked && over >= 0) || over >= 50)
      c.buff('Furina', ['Furina', 'c2Overstack'], `${over}`, 0, len)
  }
  c.at(len, (c2) => fanfareTick(c2, s, src))
}

/** The Salon members' ticks: they stop when the arkhe changes or the skill ends */
function salonTick(
  c: SimContext,
  s: FurinaState,
  src: number,
  n: number,
  m: SalonMember
) {
  if (s.arkhe !== 'ousia' || src !== s.salonSrc || c.now >= s.skillEnd) return
  let consumed = Math.min(ALLIES, c.members.length)
  if (c.healthTracked) {
    // every member above 50% HP counts; each is drained, except the active one during a burst's
    // animation (its invulnerability: gcsim's BurstState check)
    consumed = 0
    for (const member of c.members) {
      if ((c.hpRatio(member) ?? 0) <= 0.5) continue
      consumed++
      if (
        member === c.onField &&
        s.burstAction?.actor === member &&
        c.now >= s.burstAction.start &&
        c.now < s.burstAction.end
      )
        continue
      c.drainHp(member, m.drain / 100, 0.5)
    }
  } else if (c.now < s.fanfareEnd) {
    c.at(FANFARE_DELAY, (c2) =>
      addFanfare(c2, s, m.drain * consumed * FANFARE_PER_DRAIN)
    )
  }
  // the attack is dropped if the members are dismissed (a new summon, an arkhe change, the end)
  c.at(m.travel, (c2) => {
    if (src !== s.salonSrc || c2.now >= s.skillEnd) return
    c2.hit(0, {
      path: ['skill', m.node],
      tag: 'skill',
      element: 'hydro',
      applies: true,
      icd: m.icd,
      icdGroup: m.icdGroup,
      label: m.label,
      states: c.healthTracked
        ? [
            {
              owner: 'Furina',
              path: ['Furina', 'skillHpConsumeStacks'],
              value: String(consumed),
            },
          ]
        : undefined,
    })
  })
  // the next tick: gcsim's tick n is at src + initial + n·interval (rounded)
  c.at(Math.round(m.initial + (n + 1) * m.mean) - (c.now - src), (c2) =>
    salonTick(c2, s, src, n + 1, m)
  )
}

/** Summons the Salon Solitaire members `delay` frames from now: each ticks from its initial tick */
function summonSalon(ctx: SimContext, s: FurinaState, delay: number) {
  ctx.at(delay, (c) => {
    const src = c.now
    s.salonSrc = src
    for (const m of salon)
      c.at(Math.round(m.initial), (c2) => salonTick(c2, s, src, 0, m))
  })
}

/**
 * Pneuma: the Singer of Many Waters heals the active character, first 63 frames after the summon,
 * then every 120 frames less A4's reduction (0.4% per 1,000 Max HP, up to 16%)
 */
function summonSinger(ctx: SimContext, s: FurinaState, delay: number) {
  ctx.at(delay, (c) => {
    const src = c.now
    s.salonSrc = src
    const tick = (c2: SimContext) => {
      if (s.arkhe !== 'pneuma' || src !== s.salonSrc || c2.now >= s.skillEnd)
        return
      c2.hit(0, {
        path: ['_heal', 'skill', 'streamsHeal'],
        tag: 'other',
        element: 'hydro',
        healTargets: [c2.onField],
        label: 'Singer of Many Waters',
      })
      const hp = c2.calculate('Furina', ['total', 'hp']) ?? 0
      const reduction = Math.min((hp / 1000) * 0.004, 0.16)
      c2.at(Math.trunc(120 * (1 - reduction) + 0.5), tick)
    }
    c.at(63, tick)
  })
}

/** C6's per-hit states (Center of Attention, and its Pneuma bonus), decided when a hit is queued */
const c6States = (c6: boolean, pneuma: boolean) => [
  { owner: 'Furina' as const, path: ['Furina', 'c6'], value: c6 ? 'on' : '' },
  {
    owner: 'Furina' as const,
    path: ['Furina', 'c6Pneuma'],
    value: c6 && pneuma ? 'on' : '',
  },
]

/**
 * C6: a Normal, Charged or Plunging Attack hit under Center of Attention (0.1 s ICD): Ousia heals
 * the party (4% of Furina's Max HP every 1 s for 2.9 s, extended by each trigger); Pneuma drains 1%
 * of each member's current HP. The 6th trigger ends Center of Attention.
 */
function c6Trigger(c: SimContext, s: FurinaState) {
  if (c.now < s.c6IcdUntil) return
  s.c6IcdUntil = c.now + 7
  if (s.arkhe === 'ousia') {
    if (c.now > s.c6HealEnd) {
      const src = ++s.c6HealSrc
      s.c6HealEnd = c.now + 174
      const tick = (c2: SimContext) => {
        if (src !== s.c6HealSrc || c2.now > s.c6HealEnd) return
        c2.hit(0, {
          path: ['_heal', 'constellation6', 'heal'],
          tag: 'other',
          element: 'hydro',
          healTargets: [...c2.members],
          label: 'Center of Attention (Heal)',
        })
        c2.at(60, tick)
      }
      c.at(60, tick)
    } else s.c6HealEnd += 174
  } else if (c.healthTracked)
    for (const member of c.members)
      c.drainHp(member, 0.01 * (c.hpRatio(member) ?? 0))
  if (++s.c6Count >= 6) s.c6On = false
}

/** The arkhe changes (a charged attack, 1 frame after its hit) */
function flipArkhe(c: SimContext, s: FurinaState) {
  if (s.arkhe === 'ousia') {
    s.arkhe = 'pneuma'
    c.hit(0, {
      path: ['_marker', 'arkhePneuma'],
      tag: 'other',
      element: 'hydro',
      label: 'Arkhe: Pneuma',
    })
    // the Singer is summoned while the skill is up
    if (c.now < s.skillEnd) summonSinger(c, s, 0)
  } else {
    s.arkhe = 'ousia'
    c.hit(0, {
      path: ['_marker', 'arkheOusia'],
      tag: 'other',
      element: 'hydro',
      label: 'Arkhe: Ousia',
    })
    // the Salon Solitaire members are summoned again while the skill is up
    if (c.now < s.skillEnd) summonSalon(c, s, 0)
  }
}

export const kit: KitModel = {
  characterKey: 'Furina',
  element: 'hydro',
  source: `${GCSIM}/furina`,
  init: (): FurinaState => ({
    fanfare: 0,
    debounceFrom: -1,
    debounceEnd: -2,
    waltzEnd: -1,
    fanfareEnd: -1,
    fanfareSrc: 0,
    arkhe: 'ousia',
    skillEnd: -1,
    salonSrc: -1,
    c6On: false,
    c6Src: 0,
    c6Count: 0,
    c6IcdUntil: -1,
    c6HealEnd: -1,
    c6HealSrc: 0,
    arkheIcd: [-1e9, -1e9],
  }),
  onStart(ctx) {
    ctx.state('Furina', ['Furina', 'burstFanfare'], '')
    ctx.state('Furina', ['Furina', 'c2Overstack'], '')
  },
  onHpChange(ctx, s: FurinaState, change) {
    if (!ctx.healthTracked) return
    if (ctx.now < s.fanfareEnd && change.ratio > 0) {
      // gcsim's debounce: a change while it is up lands when it ends; otherwise 6 frames later,
      // and the debounce (35 frames) starts on the next frame (same-frame changes all wait 6)
      let delay = 6
      if (ctx.now >= s.debounceFrom && ctx.now <= s.debounceEnd)
        delay = s.debounceEnd - ctx.now
      else if (ctx.now >= s.debounceFrom) {
        s.debounceFrom = ctx.now + 1
        s.debounceEnd = ctx.now + 1 + 35
      }
      ctx.at(delay, (c) => {
        if (c.now < s.fanfareEnd) addFanfare(c, s, change.ratio * 100)
      })
    }
    // A1 (Endless Waltz): the active character's healing overflows, from another source. (gcsim
    // also counts an off-field member's overflow from a party-wide heal; the text says the active
    // character's.)
    if (
      change.kind !== 'heal' ||
      change.source === 'Furina' ||
      change.overheal <= 0 ||
      change.characterKey !== ctx.onField
    )
      return
    if (ctx.now > s.waltzEnd) {
      const tick = (c: SimContext) => {
        if (c.now > s.waltzEnd) return
        c.healPercent('Furina', 0.02)
        c.at(120, tick)
      }
      ctx.at(120, tick)
    }
    s.waltzEnd = ctx.now + 240
  },
  onPartyAction(ctx, s: FurinaState, actor, action, frames) {
    if (action.kind === 'burst')
      s.burstAction = { actor, start: ctx.now, end: ctx.now + frames }
    else if (s.burstAction && s.burstAction.end > ctx.now)
      s.burstAction.end = ctx.now
  },
  // her hitlag (on the field) extends Fanfare's status
  onHitlag(ctx, s: FurinaState, frames) {
    if (ctx.now < s.fanfareEnd && frames > 0) s.fanfareEnd += frames
  },
  act(ctx, s: FurinaState, action, previous) {
    const c = ctx.constellation('Furina')
    switch (action.kind) {
      case 'normal':
        return normalString(
          furinaNormals,
          action.count ?? 1,
          (i, d) =>
            // gcsim queues the hit at its hitmark: C6 and the arkhe are read then
            ctx.at(d, (c2) => {
              const c6 = c >= 6 && s.c6On
              c2.hit(0, {
                path: ['normal', `${i}`],
                tag: 'normal',
                // C6: Hydro (not overridable) while Center of Attention is up
                element: c6 ? 'hydro' : 'physical',
                applies: true,
                icd: 'normal',
                label: `N${i + 1}`,
                ...(c >= 6
                  ? { states: c6States(c6, s.arkhe === 'pneuma') }
                  : {}),
              })
              if (c6) c6Trigger(c2, s)
              // Arkhe: the hit starts the thorn (30 frames later), 6 s ICD per arkhe (a
              // hitlag-affected status, active on its expiry frame)
              const idx = s.arkhe === 'ousia' ? 0 : 1
              if (c2.now < s.arkheIcd[idx]) return
              s.arkheIcd[idx] = c2.now + 361
              c2.at(30, (c3) =>
                c3.hit(0, {
                  path: ['normal', 'thornBladeDmg'],
                  tag: 'normal',
                  element: 'hydro',
                  applies: false,
                  icd: 'none',
                  label: idx === 0 ? 'Spiritbreath Thorn' : 'Surging Blade',
                  // (C6's 18% Max HP applies to it, not Pneuma's extra)
                  ...(c >= 6 ? { states: c6States(s.c6On, false) } : {}),
                })
              )
            }),
          ctx
        )
      case 'charged': {
        // the charged attack starts 11 frames early after a normal attack
        const windup = previous?.kind === 'normal' ? 11 : 0
        const hitAt = 33 - windup
        ctx.at(hitAt, (c2) => {
          const c6 = c >= 6 && s.c6On
          c2.hit(0, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: c6 ? 'hydro' : 'physical',
            applies: true,
            icd: 'ExtraAttack',
            label: 'Charged Attack',
            ...(c >= 6 ? { states: c6States(c6, s.arkhe === 'pneuma') } : {}),
          })
          if (c6) c6Trigger(c2, s)
        })
        // its 0.02 s halt (factor 0, no defense halt): 2 frames
        ctx.hit(hitAt, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 2,
          label: 'Charged Attack hitlag',
        })
        // the arkhe changes 1 frame after the hit (a character task: after the hit's hitlag)
        ctx.atCharacter('Furina', hitAt + 1, (c2) => flipArkhe(c2, s))
        return withHitlag(
          {
            frames: 253 - windup,
            framesInto: {
              normal: 37 - windup,
              skill: 47 - windup,
              burst: 33 - windup,
              dash: 33 - windup,
              jump: 33 - windup,
              swap: 33 - windup,
              // (a written wait starts at the hitmark: CanQueueAfter)
              wait: 33 - windup,
            },
          },
          { hitmarks: [hitAt], hitlag: [2] }
        )
      }
      case 'skill': {
        if (c >= 6) {
          // Center of Attention: 10 s from the cast (hitlag-affected, active on its expiry
          // frame), or until its 6th trigger
          const src = ++s.c6Src
          s.c6On = true
          s.c6Count = 0
          ctx.atCharacter('Furina', 601, () => {
            if (src === s.c6Src) s.c6On = false
          })
        }
        if (s.arkhe === 'ousia') {
          // Ousia Bubble at 18 frames, then the Salon Solitaire members, for the skill's 1736 frames
          ctx.hit(18, {
            path: ['skill', 'bubbleDmg'],
            tag: 'skill',
            element: 'hydro',
            applies: true,
            icd: 'none',
            label: 'Ousia Bubble',
          })
          // (the skill's status: 1736 frames from the bubble, active on its expiry frame)
          s.skillEnd = ctx.now + 18 + 1736 + 1
          summonSalon(ctx, s, 18)
          // the skill's DMG per member with a drained HP: 4 assumed (a healthy party)
          ctx.buff(
            'Furina',
            ['Furina', 'skillHpConsumeStacks'],
            String(Math.min(ALLIES, ctx.members.length)),
            18,
            1736
          )
          return {
            cooldown: { key: 'skill', frames: 1200, delay: 0 },
            frames: 54,
            framesInto: {
              normal: 53,
              charged: 53,
              dash: 18,
              jump: 18,
              swap: 53,
            },
          }
        }
        // Pneuma: the Singer of Many Waters (heals the active character)
        s.skillEnd = ctx.now + 10 + 1736 + 1
        summonSinger(ctx, s, 10)
        return {
          cooldown: { key: 'skill', frames: 1200, delay: 10 },
          frames: 57,
          framesInto: { normal: 56, charged: 56, dash: 15, jump: 18, swap: 56 },
        }
      }
      case 'burst':
        // Let the People Rejoice: the hit at 98 frames. Fanfare restarts from 0 at the cast, is up
        // from frame 95 (C1: with 150 points, so the hit gets it) for 18.2 s, and grows with the
        // Salon members' HP drains
        s.fanfare = 0
        s.fanfareEnd = -1
        ctx.state('Furina', ['Furina', 'burstFanfare'], '')
        ctx.state('Furina', ['Furina', 'c2Overstack'], '')
        {
          const src = ++s.fanfareSrc
          // (a character task, and a hitlag-affected status active on its expiry frame: Furina's
          // own hitlag extends it, see onHitlag)
          ctx.atCharacter('Furina', 95, (c2) => {
            s.fanfare = c2.constellation('Furina') >= 1 ? 150 : 0
            s.fanfareEnd = c2.now + FANFARE_DUR + 1
            fanfareTick(c2, s, src)
            c2.atCharacter('Furina', FANFARE_DUR + 1, (end) => {
              if (s.fanfareSrc !== src) return
              s.fanfareEnd = -1
              end.state('Furina', ['Furina', 'burstFanfare'], '')
              end.state('Furina', ['Furina', 'c2Overstack'], '')
            })
          })
        }
        if (!ctx.healthTracked)
          ctx.note(
            "Furina: Fanfare counts the Salon members' HP drains, the party being healed back what they drain; other HP changes (Neuvillette's Equitable Judgment drain, other heals) are not counted"
          )
        ctx.hit(98, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Let the People Rejoice',
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 121,
          framesInto: {
            normal: 113,
            charged: 113,
            skill: 114,
            dash: 115,
            jump: 115,
            swap: 111,
          },
        }
      case 'plunge': {
        // gcsim's Low Plunge (the rotation's plunge has no high/low choice; collision not used);
        // C6 is read at the cast
        const c6 = c >= 6 && s.c6On
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: c6 ? 'hydro' : 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
          ...(c >= 6 ? { states: c6States(c6, s.arkhe === 'pneuma') } : {}),
        })
        if (c6) ctx.at(46, (c2) => c6Trigger(c2, s))
        return {
          frames: 75,
          framesInto: {
            normal: 58,
            charged: 56,
            skill: 58,
            burst: 58,
            dash: 46,
            swap: 60,
          },
        }
      }
      case 'dash':
        // Girl body: 20 frames, jump after 4
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 31 frames (34 after a dash)
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
