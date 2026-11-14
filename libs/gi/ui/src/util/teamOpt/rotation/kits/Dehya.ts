import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/dehya, main as of 2026-11-10. */

const dehyaNormals: NormalHit[] = [
  {
    hitmarks: [22],
    hitlag: [9],
    toNormal: 31,
    toCharged: 31,
    toAbil: 22,
    frames: 31,
  },
  {
    hitmarks: [26],
    hitlag: [10],
    toNormal: 34,
    toCharged: 34,
    toAbil: 26,
    frames: 34,
  },
  {
    hitmarks: [26],
    hitlag: [9],
    toNormal: 43,
    toCharged: 43,
    toAbil: 26,
    frames: 43,
  },
  {
    hitmarks: [41],
    hitlag: [11],
    toNormal: 85,
    toCharged: 85,
    toAbil: 41,
    frames: 85,
  },
]

/** Flame-Mane's Fist hitmarks while the burst is on (the first ones; the last one repeats) */
const punchHitmarks = [
  30, 30, 28, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27,
]

interface FieldState {
  /** Frames the Fiery Sanctum is placed [start, end) */
  start: number
  end: number
}

interface DehyaState {
  /** The Fiery Sanctum on the field (undefined: none, or being picked up) */
  field?: FieldState
  /** Ranging Flame (the recast) has been used since Molten Inferno */
  recast: boolean
  /** The field's DoT ICD (2.5 s) ends (frame) */
  dotUntil: number
  /** The duration (and the ICD left) of a field picked up for the burst, placed again after the kick */
  saved?: { dur: number; icd: number }
  /** The burst status (4.1 s, from its first punch) ends (frame) */
  burstUntil: number
  /** The burst's status is on (its cooldown and the skill then have no wait) */
  bursting: boolean
  /** Token of the auto punch chain: a newer punch or swap invalidates the older chain */
  chain: number
  /** Punches of the burst so far (the hitmark steps down through `punchHitmarks`) */
  punches: number
  /** Dash in the burst: a jump until then is the Incineration Drive kick (17 frames) */
  kickWindowUntil: number
  /** The field's stat snapshot (taken when it is placed; gcsim's skillSnapshot) */
  snap?: { t: number; onField: CharacterKey }
  /** C4: the heal/energy ICD (0.2 s, Dehya's clock) */
  c4Ready: number
  /** C6: Fist crits so far this burst (max 4), the 0.2 s ICD, and CRIT Rate accumulated */
  c6Count: number
  c6Ready: number
  c6Chance: number
}

/** The offensive stats a gcsim snapshot fixes (statSnapshots at `snap`) */
const snapshotStats = (snap: { t: number; onField: CharacterKey }) =>
  (
    [
      'atk',
      'hp',
      'eleMas',
      'critRate_',
      'critDMG_',
      'all_dmg_',
      'pyro_dmg_',
      'skill_dmg_',
    ] as const
  ).map((stat) => ({ stat, path: ['total', stat], ...snap }))

/** C4: a Fist or the kick restores 2.5% Max HP (and 1.5 Energy), once every 0.2 s */
function c4Heal(c: SimContext, s: DehyaState) {
  if (c.constellation('Dehya') < 4) return
  const now = c.characterFrame('Dehya')
  if (now <= s.c4Ready) return
  s.c4Ready = now + 12
  c.hit(0, {
    characterKey: 'Dehya',
    path: ['_heal', 'constellation4', 'heal'],
    tag: 'other',
    element: 'pyro',
    healTargets: ['Dehya'],
    label: 'An Oath Abiding (C4 heal)',
  })
}

/** C6 state on a Leonine Bite hit: the CRIT DMG stacks so far */
const c6State = (c: SimContext, s: DehyaState) =>
  c.constellation('Dehya') >= 6
    ? {
        states: [
          {
            owner: 'Dehya' as const,
            path: ['Dehya', 'c6CritStacks'],
            value: s.c6Count ? `${s.c6Count}` : '',
          },
        ],
      }
    : {}

/** Places the Fiery Sanctum on the field for `dur` frames from now */
function placeField(c: SimContext, s: DehyaState, dur: number) {
  const end = c.now + dur
  s.field = { start: c.now, end }
  s.snap = { t: c.now, onField: c.onField }
  // (a status: active through its expiry frame)
  c.at(dur + 1, () => {
    if (s.field?.end === end) s.field = undefined
  })
}

/** One Flame-Mane's Fist (and, once the burst is over, the Incineration Drive kick) */
function burstStep(c: SimContext, s: DehyaState) {
  c.hit(0, {
    characterKey: 'Dehya',
    path: ['burst', 'fistDmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    icd: 'burst',
    blunt: true,
    poiseDamage: 50,
    label: "Flame-Mane's Fist",
    ...c6State(c, s),
  })
  c4Heal(c, s)
  // C6: a Fist CRIT Hit (once per 0.2 s, 4 at most per burst) extends the state by 0.5 s and adds
  // a 15% CRIT DMG stack. The crit is the expected one: the Fist's CRIT Rate accumulated over hits
  if (c.constellation('Dehya') >= 6 && s.c6Count < 4) {
    const now = c.characterFrame('Dehya')
    if (now > s.c6Ready) {
      // (without the damage evaluator's stats: a typical 65% CRIT Rate, +10% from C6)
      const cr =
        (c.calculate('Dehya', ['total', 'critRate_']) ?? 0.65) +
        (c.calculate('Dehya', ['total', 'burst_critRate_']) ?? 0.1)
      s.c6Chance += Math.max(0, Math.min(1, cr))
      if (s.c6Chance >= 1 - 1e-9) {
        s.c6Chance -= 1
        s.c6Ready = now + 12
        s.c6Count++
        s.burstUntil += 30
      }
    }
  }
  // the auto punch chain: every 50 frames while the burst is on; the kick 46 frames after the last
  // (the burst status is active through its expiry frame)
  if (c.now > s.burstUntil) {
    s.chain++
    s.bursting = false
    const src = s.chain
    c.at(46, (c2) => kick(c2, s, src))
    return
  }
  s.punches++
  s.chain++
  const src = s.chain
  c.at(50, (c2) => {
    if (src === s.chain && c2.onField === 'Dehya') burstStep(c2, s)
  })
}

/** The Incineration Drive kick; the field picked up for the burst goes back down 1 frame later */
function kick(c: SimContext, s: DehyaState, src: number) {
  if (src !== s.chain || c.onField !== 'Dehya') return
  c.hit(0, {
    characterKey: 'Dehya',
    path: ['burst', 'driveDmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    icd: 'none',
    blunt: true,
    poiseDamage: 100,
    label: 'Incineration Drive',
    ...c6State(c, s),
  })
  c4Heal(c, s)
  if (s.saved) {
    const { dur, icd } = s.saved
    s.saved = undefined
    c.at(1, (c2) => {
      s.dotUntil = c2.now + icd
      placeField(c2, s, dur)
    })
  }
}

/** Actions during the burst are punches (gcsim's UseBurstAction): `n` of them, one after another */
function punches(ctx: SimContext, s: DehyaState, n: number) {
  let t = 0
  for (let k = 0; k < n; k++) {
    const hm = punchHitmarks[Math.min(s.punches + k, punchHitmarks.length - 1)]
    // each Roaring Barrage replaces the pending auto punch (gcsim's burstHitSrc) as it starts
    const start = (c1: SimContext) => {
      s.chain++
      const src = s.chain
      c1.at(hm, (c2) => {
        if (src === s.chain && c2.onField === 'Dehya') burstStep(c2, s)
      })
    }
    if (t === 0) start(ctx)
    else ctx.at(t, start)
    t += hm
  }
  return { frames: t }
}

export const kit: KitModel = {
  characterKey: 'Dehya',
  element: 'pyro',
  source: `${GCSIM}/dehya`,
  init: (): DehyaState => ({
    recast: false,
    dotUntil: -1,
    burstUntil: -1,
    bursting: false,
    chain: 0,
    punches: 0,
    kickWindowUntil: -1,
    c4Ready: -1,
    c6Count: 0,
    c6Ready: -1,
    c6Chance: 0,
  }),
  // In Blazing Lioness her normal attack and E are Roaring Barrage, her dash can be jump-cancelled
  // and a jump in that window is Incineration Drive; with her field up, her E is Ranging Flame.
  // Each has frames of its own
  variant(ctx, s: DehyaState, action) {
    if (ctx.now <= s.burstUntil) {
      const mode = 'Blazing Lioness'
      switch (action.kind) {
        case 'normal':
        case 'skill':
          return { key: 'lioness', label: 'Roaring Barrage', mode }
        case 'dash':
          return { key: 'lioness', label: 'Dash', mode }
        case 'jump':
          return ctx.now <= s.kickWindowUntil
            ? { key: 'lioness', label: 'Incineration Drive', mode }
            : undefined
        default:
          return undefined
      }
    }
    return action.kind === 'skill' && s.field && !s.recast
      ? { key: 'rangingFlame', label: 'Ranging Flame' }
      : undefined
  },
  act(ctx, s: DehyaState, action, previous) {
    const c = ctx.constellation('Dehya')
    switch (action.kind) {
      case 'normal':
        if (ctx.now <= s.burstUntil) return punches(ctx, s, action.count ?? 1)
        return normalString(
          dehyaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // gcsim has no charged attack for Dehya yet
        ctx.note(
          'Dehya: the charged attack is not modelled (gcsim has none yet).'
        )
        return { frames: 30 }
      case 'skill': {
        if (ctx.now <= s.burstUntil) return punches(ctx, s, 1)
        if (s.field && !s.recast) {
          // Ranging Flame: the field is picked up now (its time left + 0.4 s, C2 +6 s) and placed
          // again 41 frames later; the DoT's ICD runs on for 40 frames plus what it had left
          const dur = s.field.end - ctx.now + 24 + (c >= 2 ? 360 : 0)
          const icdLeft = Math.max(0, s.dotUntil - ctx.now)
          s.dotUntil = ctx.now + 40 + icdLeft
          s.field = undefined
          s.recast = true
          ctx.at(41, (c2) => placeField(c2, s, dur))
          // (with the field's snapshot; a 0.02 s halt)
          ctx.hit(40, {
            characterKey: 'Dehya',
            path: ['skill', 'rangingDmg'],
            tag: 'skill',
            element: 'pyro',
            applies: true,
            icd: 'none',
            blunt: true,
            poiseDamage: 50,
            label: 'Ranging Flame',
            ...(s.snap ? { statSnapshots: snapshotStats(s.snap) } : {}),
          })
          ctx.hit(40, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 2,
            label: 'Ranging Flame hitlag',
          })
          return withHitlag(
            {
              frames: 74,
              framesInto: {
                skill: 45,
                burst: 45,
                dash: 45,
                jump: 49,
                swap: 44,
              },
            },
            { hitmarks: [40], hitlag: [2] }
          )
        }
        // Molten Inferno: a new 12 s field from frame 21 (a field on the field is picked up first)
        s.field = undefined
        s.recast = false
        // (the field's DoT cannot come from the initial hit: its ICD runs to frame 21)
        s.dotUntil = ctx.now + 21
        ctx.at(21, (c2) => placeField(c2, s, 720))
        // (snapshotted at the cast)
        ctx.hit(20, {
          characterKey: 'Dehya',
          path: ['skill', 'indomitableDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 50,
          label: 'Molten Inferno',
          statSnapshots: snapshotStats({ t: ctx.now, onField: ctx.onField }),
        })
        return {
          cooldown: { key: 'skill', frames: 1200, delay: 18 },
          frames: 39,
          framesInto: { skill: 30, burst: 29, dash: 26, jump: 28, swap: 25 },
        }
      }
      case 'burst': {
        // the field is picked up (its time left + 0.4 s is kept for the kick)
        s.saved = s.field
          ? {
              dur: s.field.end - ctx.now + 24,
              icd: Math.max(0, s.dotUntil - ctx.now),
            }
          : undefined
        s.field = undefined
        s.bursting = true
        s.burstUntil = ctx.now + 105 + 246
        s.punches = 0
        s.c6Count = 0
        s.c6Chance = 0
        // the first punch at frame 105, the burst status (4.1 s, C6 crits extend it) from there
        ctx.at(105, (c2) => {
          if (c2.onField === 'Dehya') burstStep(c2, s)
        })
        return {
          cooldown: { key: 'burst', frames: 1080, delay: 1 },
          frames: 105,
        }
      }
      case 'plunge':
        // the low plunge (gcsim's default: out of a jump)
        ctx.hit(38, {
          characterKey: 'Dehya',
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 80,
          framesInto: { normal: 51, skill: 51, burst: 50, dash: 38, swap: 62 },
        }
      case 'dash':
        // a Lady's dash (22 frames, also into a jump); in the burst it can be jump-cancelled
        // after 7 frames into the kick (a 17-frame window)
        if (ctx.now <= s.burstUntil) {
          s.kickWindowUntil = ctx.now + 17
          return { frames: 22, framesInto: { jump: 7, wait: 7 } }
        }
        return { frames: 22 }
      case 'jump':
        if (ctx.now <= s.burstUntil && ctx.now <= s.kickWindowUntil) {
          // a jump in the dash's window: the Incineration Drive kick (46 frames later)
          s.chain++
          const src = s.chain
          ctx.at(46, (c2) => kick(c2, s, src))
          return {
            frames: 76,
            framesInto: { skill: 71, dash: 73, jump: 73, swap: 46 },
          }
        }
        if (ctx.now <= s.burstUntil) {
          // any other jump ends the burst (no kick), and the field goes back down now
          s.burstUntil = ctx.now - 1
          s.bursting = false
          s.chain++
          if (s.saved) {
            const { dur } = s.saved
            s.saved = undefined
            placeField(ctx, s, dur)
          }
        }
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Molten Inferno's cooldown; Ranging Flame (the field is up) and anything during the burst have none
  cooldownKey: (s: DehyaState, action) => {
    if (action.kind === 'burst') return 'burst'
    if (action.kind !== 'skill') return undefined
    return s.bursting || (s.field !== undefined && !s.recast)
      ? undefined
      : 'skill'
  },
  onHit(ctx, s: DehyaState, hit) {
    // Fiery Sanctum: damage to an enemy inside the field (assumed inside) makes a DoT 2 frames
    // later, once per 2.5 s (an ICD status active through its expiry frame). Markers, heals and
    // zero-damage hits do not count
    const f = s.field
    if (
      !f ||
      hit.path[0].startsWith('_') ||
      hit.t < f.start ||
      hit.t > f.end ||
      hit.t <= s.dotUntil
    )
      return
    s.dotUntil = hit.t + 150
    if (ctx.constellation('Dehya') >= 2)
      ctx.note(
        'Dehya C2: the Fiery Sanctum DoT +50% (when the active character is hit in the field) is not modelled.'
      )
    ctx.hit(2, {
      characterKey: 'Dehya',
      path: ['skill', 'fieldDmg'],
      tag: 'skill',
      element: 'pyro',
      applies: true,
      icd: 'none',
      label: 'Fiery Sanctum (DoT)',
      // (the field's snapshot, from when it was placed)
      ...(s.snap ? { statSnapshots: snapshotStats(s.snap) } : {}),
    })
    // (deployable: a 0.02 s halt on the enemy only)
    ctx.hit(2, {
      characterKey: 'Dehya',
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: 0,
      enemyAnimationPause: 2,
      label: 'Fiery Sanctum enemy hitlag',
    })
  },
  onSwapOut(ctx, s: DehyaState) {
    // a swap during the burst ends it; a field picked up for the kick goes back down 46 frames
    // later, if Dehya is back on the field then
    if (ctx.now <= s.burstUntil) {
      s.burstUntil = ctx.now - 1
      s.bursting = false
      s.chain++
    }
    if (s.saved) {
      const { dur, icd } = s.saved
      s.saved = undefined
      ctx.at(46, (c2) => {
        if (c2.onField !== 'Dehya') return
        s.dotUntil = c2.now + icd
        placeField(c2, s, dur)
      })
    }
  },
}
