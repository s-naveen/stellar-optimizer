import type { ActionResult, HitElement, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/chasca, main as of 2026-11-10. */

/** A normal attack's arrow travels 10 frames (gcsim's default `travel`) before it hits */
const TRAVEL = 10

/**
 * The physical normal string outside the blessing: gcsim's attackHitmarks plus the arrow's travel
 * (the cancels are from the release). gcsim's Attack() loops `for hitmark := range` over the
 * hitmarks, which yields their indices (0, 1), so its arrows land at windup + index + travel; we
 * use the hitmarks it intends.
 */
const chascaNormals: NormalHit[] = [
  {
    hitmarks: [10 + TRAVEL],
    toNormal: 17,
    toCharged: 10,
    toAbil: 10,
    frames: 27,
  },
  { hitmarks: [8 + TRAVEL], toNormal: 19, toCharged: 8, toAbil: 8, frames: 29 },
  {
    hitmarks: [14 + TRAVEL, 20 + TRAVEL],
    toNormal: 36,
    toCharged: 20,
    toAbil: 20,
    frames: 53,
  },
  {
    hitmarks: [39 + TRAVEL],
    toNormal: 73,
    toCharged: 39,
    toAbil: 39,
    frames: 62,
  },
]

/** Nightsoul Blessing: 80 points, drained at 8 a second (10 s); a dash costs 13.3 */
const BLESSING = 600
const DASH_COST = (13.3 / 8) * 60
/** The Elemental Skill's cooldown (6.5 s) starts when the blessing ends */
const SKILL_CD = 390
/** A plunge is available for 26 frames after the blessing ends (or after a Burst, 102 frames in) */
const PLUNGE_WINDOW = 26
/** ICD groups (gcsim's overrides): Shadowhunt and Tap share one; Shining and the Burst's shells have their own */
const GROUP_EXTRA = 'Chasca_MultiAimAttack_Extra'
const GROUP_BASE = 'Chasca_MultiAimAttack_Base'
const GROUP_BURST = 'Chasca_MultiAimAttack_ElementalBurst'

const PHEC = ['pyro', 'hydro', 'cryo', 'electro'] as const
type Phec = (typeof PHEC)[number]

interface ChascaState {
  /** The blessing ends at this frame (undefined: not in it) */
  blessingEnd: number | undefined
  /** Bumped on each change to the blessing, so an old end does nothing */
  gen: number
  /** A plunge is available from `plungeFrom` until `plungeUntil` */
  plungeFrom: number
  plungeUntil: number
  /** C6 Fatal Rounds: on until this frame, and its ICD */
  fatalUntil: number
  fatalIcdUntil: number
  /** A4 Nightsoul Burst: its team ICD */
  nsBurstIcdUntil: number
}

const endBlessing = (c: SimContext, s: ChascaState) => {
  s.blessingEnd = undefined
  s.plungeFrom = c.now
  s.plungeUntil = c.now + PLUNGE_WINDOW
}

/** Adds gcsim's windup to an action's frames (the cancels are relative to the same start) */
const shiftBy = (r: ActionResult, w: number): ActionResult => ({
  ...r,
  frames: r.frames + w,
  framesInto: Object.fromEntries(
    Object.entries(r.framesInto ?? {}).map(([k, v]) => [k, (v ?? 0) + w])
  ),
})

/** The party's Pyro / Hydro / Cryo / Electro members, one entry each */
const phecPool = (ctx: SimContext): Phec[] => {
  const pool: Phec[] = []
  for (const e of PHEC) for (let i = 0; i < ctx.partyCount(e); i++) pool.push(e)
  return pool
}

/** gcsim's Intn: a uniform index below n */
const pick = <T>(ctx: SimContext, list: readonly T[]): T =>
  list[Math.min(list.length - 1, Math.floor(ctx.random() * list.length))]

/**
 * The six Shadowhunt bullets, in the order they are loaded (gcsim's draws). Anemo, except: bullet 3
 * converts to a random unique party element with the A1 chance (by unique elements, +0.333 at C1),
 * and C1 then converts bullet 2 too; bullets 4-6 are drawn at random from the party's PHEC members
 * without repeats (the pool refills when it runs out), each only with 3 / 2 / 1 or more of them.
 */
const shadowhuntBullets = (ctx: SimContext, c: number): HitElement[] => {
  const party = phecPool(ctx)
  const unique = PHEC.filter((e) => ctx.partyCount(e) > 0)
  const b: HitElement[] = ['anemo', 'anemo', 'anemo', 'anemo', 'anemo', 'anemo']
  if (unique.length) {
    const chance =
      [0, 0.333, 0.667, 1][Math.min(unique.length, 3)] + (c >= 1 ? 0.333 : 0)
    if (!(ctx.random() > chance)) b[2] = pick(ctx, unique)
    if (c >= 1 && b[2] !== 'anemo') b[1] = pick(ctx, unique)
  }
  let pool = [...party]
  for (let k = 0; k < 3; k++) {
    if (party.length < 3 - k) continue
    if (!pool.length) pool = [...party]
    const i = Math.min(pool.length - 1, Math.floor(ctx.random() * pool.length))
    b[3 + k] = pool[i]
    pool[i] = pool[pool.length - 1]
    pool.pop()
  }
  return b
}

/** A Normal Attack in the blessing: one Multitarget Fire Tap per hit (N4 = four taps), 34 frames apart */
function tapString(
  ctx: SimContext,
  s: ChascaState,
  count: number,
  chained: boolean
): ActionResult {
  let start = 0
  for (let j = 0; j < count; j++) {
    // gcsim: windup 7 frames, none when chained into a Normal Attack. Damage: the sheet's Multitarget
    // Fire Tap node (gcsim applies its 1-Hit DMG table to the tap instead)
    const windup = j === 0 && !chained ? 7 : 0
    ctx.hit(start + windup + 11, {
      path: ['skill', 'pressDmg'],
      tag: 'normal',
      nightsoul: true,
      element: 'anemo',
      applies: true,
      icd: GROUP_EXTRA,
      label: `Multitarget Fire Tap ${j + 1}`,
    })
    start += 34
  }
  const last = start - 34
  return {
    frames: last + 39,
    framesInto: {
      normal: start,
      skill: last + 31,
      burst: last + 11,
      dash: last + 11,
      // no swap until the blessing is over (+37 frames)
      swap: Math.max(last + 39, (s.blessingEnd ?? ctx.now) - ctx.now + 37),
    },
  }
}

/** The charged attack in the blessing: a Shadowhunt (six bullets loaded, then fired from the back) */
function aimInBlessing(
  ctx: SimContext,
  s: ChascaState,
  chained: boolean
): ActionResult {
  const now = ctx.now
  const c = ctx.constellation('Chasca')
  // gcsim: windup 11 frames, none when chained into a normal attack, aim, skill or burst
  const windup = chained ? 0 : 11
  // C6 Fatal Rounds, consumed by this charge: instant reload, and +120% CRIT DMG on the shells
  const fatal = c >= 6 && now < s.fatalUntil
  if (fatal) s.fatalUntil = -1
  const load = fatal
    ? [1, 2, 2, 3, 3, 4]
    : c >= 6
      ? [14, 28, 42, 55, 69, 83]
      : [21, 38, 56, 70, 91, 108]
  const bullets = shadowhuntBullets(ctx, c)
  // C6: A1's Spiritbinding Conversion (the 3rd bullet, and the 2nd at C1) starts Fatal Rounds
  // when the converted bullet loads (3 s, once per 3 s). gcsim starts it on any non-Anemo bullet,
  // including the 4th to 6th; the game text, only on the conversion.
  if (c >= 6 && bullets[2] !== 'anemo') {
    const t = now + load[c >= 1 ? 1 : 2] + windup
    if (t >= s.fatalIcdUntil) {
      s.fatalIcdUntil = t + 180
      s.fatalUntil = t + 180
    }
  }
  const fire = load[5] + windup
  const shots = [4, 7, 10, 13, 16, 19]
  // This shot's own buffs, fixed at the shot: A1's Shining DMG bonus and C6's +120% CRIT DMG
  // on both kinds of shells (gcsim applies the C6 buff to their snapshot)
  const states = [
    {
      owner: 'Chasca' as const,
      path: ['Chasca', 'a1InMultitarget'],
      value: bullets.some((el) => el !== 'anemo') ? 'on' : '',
    },
    {
      owner: 'Chasca' as const,
      path: ['Chasca', 'c6FatalRounds'],
      value: fatal ? 'on' : '',
    },
  ]
  let c2Done = false
  shots.forEach((frame, i) => {
    // the last loaded bullet is fired first; the shells count as Charged Attack DMG
    const el = bullets[5 - i]
    const t = fire + frame
    if (el === 'anemo') {
      ctx.hit(t, {
        path: ['skill', 'shellDmg'],
        tag: 'charged',
        nightsoul: true,
        element: 'anemo',
        applies: true,
        icd: GROUP_EXTRA,
        icdGroup: 'ChascaShadowhunt',
        label: 'Shadowhunt Shell',
        states,
      })
      return
    }
    ctx.hit(t, {
      path: ['skill', `shiningShellDmg_${el}`],
      tag: 'charged',
      nightsoul: true,
      element: el,
      applies: true,
      icd: GROUP_BASE,
      icdGroup: 'ChascaShining',
      label: `Shining Shadowhunt Shell (${el})`,
      states,
    })
    // C2: one extra hit per shot, a frame after the first Shining hit (Charged Attack DMG)
    if (c >= 2 && !c2Done) {
      c2Done = true
      ctx.hit(t + 1, {
        path: ['constellation2', el],
        tag: 'charged',
        nightsoul: true,
        element: el,
        applies: true,
        icd: 'none',
        label: 'Shining Shadowhunt Shell (C2)',
      })
    }
  })
  return {
    frames: fire + 19,
    framesInto: {
      normal: fire + 19,
      charged: fire + 18,
      skill: fire + 19,
      burst: fire + 14,
      dash: fire,
      jump: fire + 19,
      swap: Math.max(fire + 19, (s.blessingEnd ?? now) - now + 37),
    },
  }
}

export const kit: KitModel = {
  characterKey: 'Chasca',
  element: 'anemo',
  // (random bullet elements: rotations with her are averaged over seeded samples)
  sampled: true,
  source: `${GCSIM}/chasca`,
  nightsoul(ctx, s: ChascaState) {
    return {
      active: s.blessingEnd !== undefined && ctx.now < s.blessingEnd,
      points: Math.max(0, (((s.blessingEnd ?? ctx.now) - ctx.now) * 80) / 600),
    }
  },
  init: (): ChascaState => ({
    blessingEnd: undefined,
    gen: 0,
    plungeFrom: 0,
    plungeUntil: 0,
    fatalUntil: -1,
    fatalIcdUntil: -1,
    nsBurstIcdUntil: -1,
  }),
  // In Nightsoul's Blessing her normal and charged attacks are Multitarget Fire (tap and hold),
  // her E ends the blessing and her Q is cast in the air, each with frames of its own
  variant(ctx, s: ChascaState, action) {
    if (s.blessingEnd === undefined || ctx.now >= s.blessingEnd)
      return undefined
    const mode = "Nightsoul's Blessing"
    switch (action.kind) {
      case 'normal':
        return { key: 'nightsoul', label: 'Multitarget Fire (Tap)', mode }
      case 'charged':
        return { key: 'nightsoul', label: 'Multitarget Fire (Hold)', mode }
      case 'skill':
        return {
          key: 'nightsoul',
          label: "Spirit Reins, Shadow Hunt (ends Nightsoul's Blessing)",
          mode,
        }
      case 'burst':
        return { key: 'nightsoul', label: "Soul Reaper's Fatal Round", mode }
      default:
        return undefined
    }
  },
  act(ctx, s: ChascaState, action, previous) {
    const now = ctx.now
    const kind = previous?.kind
    const inBlessing = s.blessingEnd !== undefined && now < s.blessingEnd
    switch (action.kind) {
      case 'normal': {
        if (inBlessing)
          return tapString(ctx, s, action.count ?? 1, kind === 'normal')
        // gcsim: windup 5 frames, none when chained into a Normal Attack or an aim
        const w = kind === 'normal' || kind === 'charged' ? 0 : 5
        return shiftBy(
          normalString(
            chascaNormals,
            action.count ?? 1,
            (i, d, j) =>
              ctx.hit(d + w, {
                path: ['normal', `${i}`],
                tag: 'normal',
                element: 'physical',
                applies: true,
                label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
              }),
            ctx
          ),
          w
        )
      }
      case 'charged': {
        if (inBlessing)
          return aimInBlessing(
            ctx,
            s,
            kind === 'normal' ||
              kind === 'charged' ||
              kind === 'skill' ||
              kind === 'burst'
          )
        // not in the blessing: the Fully-Charged Aimed Shot (gcsim's default hold)
        ctx.hit(96, {
          path: ['charged', 'fullyAimed'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      }
      case 'skill': {
        if (inBlessing) {
          // pressing the skill again ends the blessing; its cooldown starts now
          s.gen++
          endBlessing(ctx, s)
          return {
            cooldown: { key: 'skill', frames: SKILL_CD },
            frames: 40,
            framesInto: {
              normal: 38,
              charged: 38,
              plunge: 2,
              burst: 39,
              swap: 37,
            },
          }
        }
        ctx.hit(3, {
          path: ['skill', 'activationDmg'],
          tag: 'skill',
          nightsoul: true,
          element: 'anemo',
          applies: true,
          label: 'Spirit Reins, Shadow Hunt (Resonance)',
        })
        // Nightsoul Blessing: its points drain to zero at BLESSING frames (the cooldown starts then)
        s.gen++
        const gen = s.gen
        s.blessingEnd = now + BLESSING
        ctx.at(BLESSING, (c2) => {
          if (s.gen === gen) endBlessing(c2, s)
        })
        return {
          cooldown: { key: 'skill', frames: BLESSING + SKILL_CD },
          frames: 623,
          framesInto: {
            normal: 6,
            charged: 17,
            burst: 6,
            skill: 27,
            dash: 6,
            swap: BLESSING + 23,
          },
        }
      }
      case 'burst': {
        ctx.hit(96, {
          path: ['burst', 'galeSplittingDmg'],
          tag: 'burst',
          nightsoul: true,
          element: 'anemo',
          applies: true,
          label: 'Galesplitting Soulseeker Shell',
        })
        // six Soulseeker shells: the first min(6, 2 x party PHEC) are Radiant (the party's elements,
        // shuffled as gcsim does), the rest Anemo
        const pool = [...phecPool(ctx), ...phecPool(ctx)]
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.min(i, Math.floor(ctx.random() * (i + 1)))
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
        const radiant = Math.min(6, pool.length)
        const hitmarks = [103, 139, 147, 153, 157, 160]
        hitmarks.forEach((t, i) => {
          if (i < radiant) {
            const el = pool[i % pool.length]
            ctx.hit(t, {
              path: ['burst', `radiantDmg_${el}`],
              tag: 'burst',
              nightsoul: true,
              element: el,
              applies: true,
              icd: GROUP_BURST,
              icdGroup: 'ChascaBurst',
              label: `Radiant Soulseeker Shell (${el})`,
            })
          } else
            ctx.hit(t, {
              path: ['burst', 'shellDmg'],
              tag: 'burst',
              nightsoul: true,
              element: 'anemo',
              applies: true,
              icd: GROUP_BURST,
              icdGroup: 'ChascaBurst',
              label: 'Soulseeker Shell',
            })
        })
        // C4: the first shell to hit adds a Radiant Shadowhunt Shell (once per Burst)
        const first = pool[0]
        if (ctx.constellation('Chasca') >= 4 && first && radiant > 0)
          ctx.hit(hitmarks[0] + 1, {
            path: ['constellation4', first],
            // (Charged Attack DMG, the game text)
            tag: 'charged',
            nightsoul: true,
            element: first,
            applies: true,
            icd: 'none',
            label: 'Radiant Shadowhunt Shell (C4)',
          })
        // gcsim: 102 frames in, a plunge is available if the blessing is over
        ctx.at(102, (c2) => {
          if (s.blessingEnd === undefined) {
            s.plungeFrom = c2.now
            s.plungeUntil = c2.now + PLUNGE_WINDOW
          }
        })
        if (inBlessing)
          return {
            cooldown: { key: 'burst', frames: 900 },
            frames: 111,
            framesInto: {
              normal: 106,
              skill: 104,
              dash: 103,
              swap: Math.max(111, (s.blessingEnd ?? now) - now + 37),
            },
          }
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 114,
          framesInto: {
            normal: 99,
            charged: 100,
            skill: 102,
            dash: 101,
            jump: 100,
            swap: 98,
          },
        }
      }
      case 'dash': {
        if (!inBlessing) return { frames: 22, framesInto: { jump: 3 } }
        const end = s.blessingEnd ?? now
        if (end - now <= DASH_COST) {
          // the points run out on the dash: the blessing ends here
          s.gen++
          endBlessing(ctx, s)
          return {
            cooldown: { key: 'skill', frames: SKILL_CD },
            frames: 22,
            framesInto: { jump: 3 },
          }
        }
        // the dash spends 13.3 points: the blessing (and so the cooldown) ends earlier
        const newEnd = end - DASH_COST
        s.blessingEnd = newEnd
        s.gen++
        const gen = s.gen
        ctx.at(newEnd - now, (c2) => {
          if (s.gen === gen) endBlessing(c2, s)
        })
        return {
          cooldown: { key: 'skill', frames: newEnd - now + SKILL_CD },
          frames: 22,
          framesInto: { jump: 3 },
        }
      }
      case 'jump':
        if (inBlessing)
          return {
            frames: 0,
            failed:
              'Chasca: no jump in the Nightsoul Blessing (gcsim has none)',
          }
        return templateJump('lady', 'bow', previous, ctx)
      case 'plunge': {
        if (now < s.plungeFrom || now >= s.plungeUntil)
          return {
            frames: 0,
            failed:
              'Chasca: plunge only after the Nightsoul Blessing ends (26 frames)',
          }
        s.plungeUntil = now
        ctx.hit(50, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 80,
          framesInto: { normal: 69, skill: 66, burst: 66, dash: 52, swap: 67 },
        }
      }
      default:
        return { frames: 30 }
    }
  },
  // The Elemental Skill's cooldown only starts when the blessing ends: pressing it inside is free
  cooldownKey: (s: ChascaState, action) => {
    if (action.kind === 'burst') return 'burst'
    if (action.kind === 'skill' && s.blessingEnd === undefined) return 'skill'
    return undefined
  },
  onNightsoulBurst(ctx) {
    // A4 Nightsoul Burst: an Elemental hit starts a Burning Shadowhunt Shot 60 frames later. Team ICD
    // 18 s (one Natlan character assumed); its element is a random unique party PHEC element, else
    // Anemo
    const unique = PHEC.filter((e) => ctx.partyCount(e) > 0)
    const el: HitElement = unique.length ? pick(ctx, unique) : 'anemo'
    ctx.hit(60, {
      characterKey: 'Chasca',
      path: ['passive2', el],
      // (Charged Attack DMG, the game text)
      tag: 'charged',
      nightsoul: true,
      element: el,
      applies: true,
      label: 'Burning Shadowhunt Shot (A4)',
    })
  },
}
