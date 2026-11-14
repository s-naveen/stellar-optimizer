import type { RotationAction } from '../parse'
import type {
  ActionResult,
  KitModel,
  NormalStateStart,
  SimContext,
  SimHit,
} from '../types'
import { atkSpdAdjust, KQMSIM, type NormalHit } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/columbina. */

/*
 * Assumptions: A1 and A4 are unlocked (the sim has no ascension); the Lunar Domain covers the
 * party while it lasts. Gravity accrues as in gcsim: every 3 frames, while a Lunar reaction or
 * Lunar hit came in the last 2 s, 0.5 Gravity (0.67 at C2) goes to the Lunar type that came last;
 * the Gravity Interference is the type with the most Gravity when the total reaches 60.
 * Energy (C1's 6 for the active character, C4's 4 for her), C1's Rainsea Shield and its
 * interruption resistance are not modelled (the sim tracks no energy or shields).
 */

/** gcsim attack.go: N1 23 / N2 20 / N3 41, no hitlag (catalyst) */
const columbinaNormals: NormalHit[] = [
  { hitmarks: [23], toNormal: 24, toCharged: 24, toAbil: 23, frames: 36 },
  { hitmarks: [20], toNormal: 20, toCharged: 33, toAbil: 20, frames: 37 },
  { hitmarks: [41], toNormal: 74, toCharged: 71, toAbil: 41, frames: 76 },
]

/** Lunar types, in gcsim's order (ties go to the earlier one) */
const LC = 0
const LB = 1
const LCR = 2
type LunarType = typeof LC | typeof LB | typeof LCR

const MARKS: Record<string, LunarType> = {
  lunarCharged: LC,
  lunarBloom: LB,
  lunarCrystallize: LCR,
}

interface Variant {
  label: string
  node: string
  element: SimHit['element']
  tag: SimHit['tag']
  /** gcsim's task delay of each hit after the Gravity Interference (QueueCharTask) */
  tasks: number[]
  /** travel after each task (QueueAttack's delay) */
  travel: number
  c2Cond: string
  c2State: string
  c6Cond: string
}

const VARIANTS: Variant[] = [
  {
    label: 'Gravity Interference (Lunar-Charged)',
    node: 'lunarchargedDmg',
    element: 'electro',
    tag: 'other',
    tasks: [43],
    travel: 0,
    c2Cond: 'c2Lunarcharged',
    c2State: 'lunarcharged',
    c6Cond: 'c6Lunarcharged',
  },
  {
    label: 'Gravity Interference (Lunar-Bloom)',
    node: 'lunarbloomDmg',
    element: 'dendro',
    tag: 'other',
    // tasks at 51, +5, +6, +9, +11, each with 20 frames of travel
    tasks: [51, 56, 62, 71, 82],
    travel: 20,
    c2Cond: 'c2Lunarbloom',
    c2State: 'lunarbloom',
    c6Cond: 'c6Lunarbloom',
  },
  {
    label: 'Gravity Interference (Lunar-Crystallize)',
    node: 'lunarcrystallizeDmg',
    element: 'geo',
    tag: 'directLunarCrystallize',
    tasks: [43],
    travel: 0,
    c2Cond: 'c2Lunarcrystallize',
    c2State: 'lunarcrystallize',
    c6Cond: 'c6Lunarcrystallize',
  },
]

/** Which Lunar type a hit is (a reaction, or Lunar damage by anyone), if any */
function lunarType(hit: SimHit): LunarType | undefined {
  if (hit.path[0] === '_reaction') return MARKS[hit.path[1]]
  if (
    hit.tag === 'directLunarCrystallize' ||
    hit.tag === 'reactionLunarCrystallize'
  )
    return LCR
  if (/Lunar-Charged/.test(hit.label)) return LC
  if (/Lunar-Bloom/.test(hit.label)) return LB
  if (/Lunar-Crystallize/.test(hit.label)) return LCR
  return undefined
}

/** gcsim's Gravity: 60 to trigger, accrued every 3 frames while the 2 s Gravity status is up */
const GRAVITY_MAX = 60
const ACCRUE_EVERY = 3
const GRAVITY_STATUS = 120
const accrual = (c2: boolean) => 10 * 0.05 * (c2 ? 1.34 : 1)

interface ColumbinaState {
  a1Stacks: number
  /** Gravity Ripple ends (undefined: not on the field) */
  rippleEnd?: number
  /** Gravity counts Lunar events after this frame (gcsim adds the Ripple's status after the
   * cast's own hit, so that hit's reaction does not count when the Ripple was not up) */
  rippleFrom: number
  /** The DoT chain that is running (a recast while it is up keeps it) */
  chainSrc: number
  /** Gravity per Lunar type */
  gravity: [number, number, number]
  /** gcsim's Gravity status: accrual calls stop from this frame */
  gravityActiveUntil: number
  /** The next accrual call (gcsim's gravityAccum task), or -1 when the chain is stopped */
  accrueNext: number
  /** The planned Gravity Interference check (a newer plan replaces it) */
  plan: number
  /** The type that accrues (none before the first Lunar event) */
  last?: LunarType
  /** C1's cast-time Gravity Interference, and C4's bonus, are on cooldown until */
  c1Icd: number
  c4Icd: number
  /** The Lunar Domain covers [domainStart, domainEnd) */
  domainStart: number
  domainEnd: number
  /** A4's Moonridge Dew: at most 3 per 18 s, in the Lunar Domain. */
  moonCount: number
  moonTimerEnd: number
  moonIcd: number
  /** Her last action, while she stays on the field, and when its animation ends (gcsim's
   * windups) */
  lastKind?: string
  lastEnd: number
}

const total = (s: ColumbinaState) => s.gravity[0] + s.gravity[1] + s.gravity[2]

/** Run gcsim's 3-frame accrual calls up to frame `t` (inclusive) */
function settle(s: ColumbinaState, t: number, c2: boolean) {
  while (s.accrueNext >= 0 && s.accrueNext <= t) {
    if (total(s) >= GRAVITY_MAX - 1e-9) return
    if (
      s.accrueNext >= s.gravityActiveUntil ||
      s.rippleEnd === undefined ||
      s.accrueNext >= s.rippleEnd
    ) {
      s.accrueNext = -1
      return
    }
    if (s.last !== undefined) s.gravity[s.last] += accrual(c2)
    s.accrueNext += ACCRUE_EVERY
    if (total(s) >= GRAVITY_MAX - 1e-9) return
  }
}

/** Schedule the accrual call that reaches 60 Gravity (if the status lasts until then) */
function plan(ctx: SimContext, s: ColumbinaState, c2: boolean) {
  if (s.accrueNext < 0) return
  const calls = Math.max(
    1,
    Math.ceil((GRAVITY_MAX - total(s)) / accrual(c2) - 1e-9)
  )
  const at = s.accrueNext + (calls - 1) * ACCRUE_EVERY
  if (
    at >= s.gravityActiveUntil ||
    s.rippleEnd === undefined ||
    at >= s.rippleEnd
  )
    return
  const id = ++s.plan
  ctx.at(at - ctx.now, (c3) => {
    if (s.plan !== id) return
    settle(s, c3.now, c2)
    if (total(s) >= GRAVITY_MAX - 1e-9) {
      gravityTick(c3, s, true)
      plan(c3, s, c2)
    }
  })
}

/** A Gravity Interference: `clear` empties the Gravity (C1's cast-time one does not) */
function gravityTick(ctx: SimContext, s: ColumbinaState, clear: boolean) {
  const c = ctx.constellation('Columbina')
  // the type with the most Gravity; nothing accrued (C1's first cast): the Lunar type most of
  // the team can make (gcsim: ties go to the earlier type)
  const counts = [
    ctx.partyCount('electro'),
    ctx.partyCount('dendro'),
    ctx.partyCount('geo'),
  ]
  let type = counts.indexOf(Math.max(...counts)) as LunarType
  let most = 0
  for (const i of [LC, LB, LCR] as const)
    if (s.gravity[i] > most) {
      most = s.gravity[i]
      type = i
    }
  if (clear) s.gravity = [0, 0, 0]
  const v = VARIANTS[type]
  const first = v.tasks[0] + v.travel
  const lastHit = v.tasks[v.tasks.length - 1] + v.travel
  for (const d of v.tasks)
    ctx.hit(d + v.travel, {
      characterKey: 'Columbina',
      path: ['skill', v.node],
      tag: v.tag,
      element: v.element,
      label: v.label,
    })
  // A1: +5% CRIT Rate per tick (stacks to 3, 10 s)
  s.a1Stacks = Math.min(
    3,
    (ctx.hasBuff('Columbina', ['Columbina', 'a1Stacks']) ? s.a1Stacks : 0) + 1
  )
  ctx.buff('Columbina', ['Columbina', 'a1Stacks'], String(s.a1Stacks), 0, 600, {
    hitlag: 'recipient',
  })
  if (c >= 2) {
    // Lunar Brilliance (8 s); its Ascendant Gleam stat is the latest tick's type only (gcsim
    // removes the other types' buffs), so the type is a state and Brilliance times it
    ctx.buff('Columbina', ['Columbina', 'c2Brilliance'], 'on', 0, 480)
    for (const other of VARIANTS)
      if (other !== v) ctx.state('Columbina', ['Columbina', other.c2Cond], '')
    ctx.state('Columbina', ['Columbina', v.c2Cond], v.c2State)
  }
  // C4: once per 15 s (from the first hit's task), this Gravity Interference's Lunar DMG gets a
  // flat bonus. gcsim adds it to the first hit only; the game text gives it to "this instance",
  // and the Lunar-Bloom value (2.5% of Max HP, a fifth of the others) is per hit of its five,
  // so it covers every hit here
  if (c >= 4 && ctx.now + v.tasks[0] >= s.c4Icd) {
    s.c4Icd = ctx.now + v.tasks[0] + 900
    ctx.buff(
      'Columbina',
      ['Columbina', 'c4Buff'],
      'on',
      first,
      lastHit - first + 1
    )
  }
}

/**
 * Columbina's normal string (gcsim attack.go): an N1 that restarts the string straight out of a
 * normal or charged attack has a 2-frame windup on its hitmark and cancels
 */
function columbinaString(ctx: SimContext, count: number, fromAttack: boolean) {
  const n = Math.max(1, count)
  const first = ctx.normalSequence(columbinaNormals.length, n)
  const normalStarts: NormalStateStart[] = []
  let start = 0
  let into: Record<string, number> = {}
  let frames = 0
  for (let step = 0; step < n; step++) {
    const i = (first + step) % columbinaNormals.length
    const h = columbinaNormals[i]
    const windup = i === 0 && (step > 0 || fromAttack) ? 2 : 0
    normalStarts.push({ offset: start, index: i })
    ctx.hit(start + h.hitmarks[0] + windup, {
      path: ['normal', `${i}`],
      tag: 'normal',
      element: 'hydro',
      applies: true,
      icd: 'normal',
      label: `N${i + 1}`,
    })
    const speed = ctx.normalAttackSpeed(step > 0)
    const adj = (f: number) =>
      Math.max(h.toAbil, atkSpdAdjust(f, speed)) + windup
    if (step < n - 1) {
      start += adj(h.toNormal)
      continue
    }
    frames = start + adj(h.frames)
    into = {
      normal: start + adj(h.toNormal),
      charged: start + adj(h.toCharged),
      skill: start + adj(h.toAbil),
      burst: start + adj(h.toAbil),
      dash: start + adj(h.toAbil),
      jump: start + adj(h.toAbil),
      swap: start + adj(h.toAbil),
      wait: start + adj(h.toAbil),
    }
  }
  return { normalStarts, frames, framesInto: into }
}

function columbinaAct(
  ctx: SimContext,
  s: ColumbinaState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  const now = ctx.now
  const c = ctx.constellation('Columbina')
  // gcsim's windups depend on her current state: her own normal or charged attack whose
  // animation is still running (not after a swap, nor once it has ended)
  const prevKind = ctx.now < s.lastEnd ? s.lastKind : undefined
  switch (action.kind) {
    case 'normal':
      return columbinaString(
        ctx,
        action.count ?? 1,
        prevKind === 'normal' || prevKind === 'charged'
      )
    case 'charged': {
      const dew = ctx.dew
      if (dew > 0) {
        // with Verdant or Moonridge Dew: Moondew Cleanse, three direct Lunar-Bloom hits that
        // spend one Dew (Verdant first)
        const windup =
          prevKind === 'charged' ? 3 : prevKind === 'normal' ? -5 : 12
        for (const d of [50, 58, 80])
          ctx.hit(d + windup, {
            path: ['charged', 'dewDmg'],
            tag: 'other',
            element: 'dendro',
            label: 'Moondew Cleanse (Lunar-Bloom)',
          })
        ctx.at(43 + windup, (c) => c.consumeDew(1))
        return {
          frames: 124,
          framesInto: {
            normal: 82,
            // the next one is another Cleanse while Dew is left, else a plain charged attack
            charged: dew - 1 > 0 ? 80 : 89,
            skill: 43,
            burst: 43,
            dash: 43,
            jump: 43,
            swap: 43,
          },
        }
      }
      const windup =
        prevKind === 'charged' ? 3 : prevKind === 'normal' ? -2 : 15
      ctx.hit(57 + windup, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'hydro',
        applies: true,
        label: 'Charged Attack',
      })
      return {
        frames: 101,
        framesInto: {
          normal: 94,
          skill: 57,
          burst: 57,
          dash: 57,
          jump: 57,
          swap: 57,
        },
      }
    }
    case 'skill': {
      ctx.hit(21, {
        path: ['skill', 'skillDmg'],
        tag: 'skill',
        element: 'hydro',
        applies: true,
        icd: 'none',
        label: 'Eternal Tides',
      })
      // Gravity Ripple: 1500 frames from frame 21, a Hydro DoT every 117 frames. A recast while
      // it is up refreshes the duration and keeps the chain; otherwise a new chain starts
      ctx.at(21, (c2) => {
        const up = s.rippleEnd !== undefined && c2.now < s.rippleEnd
        if (!up) {
          s.gravity = [0, 0, 0]
          s.accrueNext = -1
          s.rippleFrom = c2.now + 1
        } else settle(s, c2.now, c >= 2)
        s.rippleEnd = c2.now + 1500
        if (!up) {
          const src = c2.now
          s.chainSrc = src
          const tick = (c3: SimContext) => {
            if (
              s.chainSrc !== src ||
              s.rippleEnd === undefined ||
              c3.now >= s.rippleEnd
            )
              return
            c3.hit(0, {
              path: ['skill', 'continuousDmg'],
              tag: 'skill',
              element: 'hydro',
              applies: true,
              icd: 'none',
              label: 'Gravity Ripple',
            })
            c3.at(117, tick)
          }
          c2.at(117, tick)
        }
        // C1: casting also calls a Gravity Interference (without emptying the Gravity), 15 s
        if (c >= 1 && c2.now >= s.c1Icd) {
          s.c1Icd = c2.now + 900
          gravityTick(c2, s, false)
        }
        // a longer Ripple can let the running accrual reach 60
        plan(c2, s, c >= 2)
      })
      return {
        cooldown: { key: 'skill', frames: 1020, delay: 20 },
        frames: 41,
        framesInto: {
          normal: 41,
          charged: 40,
          skill: 28,
          burst: 28,
          dash: 27,
          jump: 32,
          swap: 26,
        },
      }
    }
    case 'burst':
      ctx.hit(110, {
        path: ['burst', 'skillDmg'],
        tag: 'burst',
        element: 'hydro',
        applies: true,
        durability: 50,
        icd: 'none',
        label: 'Moonlit Melancholy',
      })
      // the Lunar Domain: Lunar DMG bonus for party members inside it (assumed: always)
      s.domainStart = now + 86
      s.domainEnd = now + 86 + 1200 + 72
      ctx.buff('Columbina', ['Columbina', 'burstDomain'], 'on', 86, 1200 + 72)
      return {
        cooldown: { key: 'burst', frames: 900 },
        frames: 131,
        framesInto: {
          charged: 130,
          skill: 122,
          dash: 122,
          jump: 124,
          swap: 122,
        },
      }
    case 'dash':
      // gcsim's template dash for her body: 20 frames, 4 into a jump
      return { frames: 20, framesInto: { jump: 4 } }
    case 'jump': {
      // gcsim's own jump for Columbina: 48 frames (52 out of a dash), no earlier cancel
      const f = previous?.kind === 'dash' ? 52 : 48
      return { frames: f }
    }
    default:
      return { frames: 30 }
  }
}

export const kit: KitModel = {
  characterKey: 'Columbina',
  moonsign: 1,
  element: 'hydro',
  source: `${KQMSIM}/columbina`,
  init: (): ColumbinaState => ({
    a1Stacks: 0,
    rippleFrom: 0,
    chainSrc: -1,
    gravity: [0, 0, 0],
    gravityActiveUntil: -1,
    accrueNext: -1,
    plan: 0,
    c1Icd: -1e9,
    c4Icd: -1e9,
    domainStart: 1e9,
    domainEnd: -1,
    moonCount: 0,
    moonTimerEnd: -1,
    moonIcd: -1,
    lastEnd: -1,
  }),
  act(ctx, s: ColumbinaState, action, previous) {
    const r = columbinaAct(ctx, s, action, previous)
    s.lastKind = action.kind
    s.lastEnd = ctx.now + r.frames
    return r
  },
  onSwapOut(_ctx, s: ColumbinaState) {
    s.lastKind = undefined
  },
  onHit(ctx, s: ColumbinaState, hit) {
    const c = ctx.constellation('Columbina')
    const type = lunarType(hit)
    if (type === undefined) return
    const mark = hit.path[0] === '_reaction'
    // Lunar reactions (not damage) in the Lunar Domain: A4's Moonridge Dew on Lunar-Bloom, C6's
    // CRIT DMG buff for 8 s (per element; the same element's buff refreshes, it does not stack)
    if (mark && hit.t >= s.domainStart && hit.t < s.domainEnd) {
      if (c >= 6)
        ctx.buff(
          'Columbina',
          ['Columbina', VARIANTS[type].c6Cond],
          VARIANTS[type].c2State,
          0,
          480,
          { hitlag: 'recipient' }
        )
      if (type === LB && hit.t >= s.moonIcd && s.moonCount < 3) {
        s.moonIcd = hit.t + 3
        s.moonCount++
        ctx.addMoonridgeDew()
        if (hit.t >= s.moonTimerEnd) {
          s.moonTimerEnd = hit.t + 18 * 60
          ctx.at(18 * 60, () => {
            s.moonCount = 0
          })
        }
      }
    }
    // Gravity (only while Gravity Ripple is up): the event refreshes the 2 s Gravity status and
    // names the type that accrues; a stopped accrual chain restarts with a call right away
    if (
      s.rippleEnd === undefined ||
      hit.t >= s.rippleEnd ||
      hit.t < s.rippleFrom
    )
      return
    settle(s, hit.t - 1, c >= 2)
    s.gravityActiveUntil = hit.t + GRAVITY_STATUS
    // gcsim's reaction hooks name the type before the immediate accrual call; its Lunar-damage
    // hook names it after that call (so a chain started by Lunar damage first accrues into the
    // previous type, or nothing before the first Lunar event)
    if (mark) s.last = type
    if (s.accrueNext < 0) s.accrueNext = hit.t
    settle(s, hit.t, c >= 2)
    s.last = type
    if (total(s) >= GRAVITY_MAX - 1e-9) gravityTick(ctx, s, true)
    plan(ctx, s, c >= 2)
  },
}
