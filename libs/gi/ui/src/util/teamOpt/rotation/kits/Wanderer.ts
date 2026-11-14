import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { atkSpdAdjust, GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/wanderer, main as of 2026-11-10. */

/** Normal attack string N1..N3 (N3 has two hits), gcsim's attackFrames; hits include the 5-frame travel */
const wandererNormals: NormalHit[] = [
  { hitmarks: [16], toNormal: 26, toCharged: 24, toAbil: 11, frames: 35 },
  { hitmarks: [11], toNormal: 18, toCharged: 27, toAbil: 5, frames: 39 },
  { hitmarks: [37, 46], toNormal: 64, toCharged: 50, toAbil: 33, frames: 76 },
]

/** Windfavored (Kuugo) normal attacks: the same string, quicker */
const windNormals: NormalHit[] = [
  { hitmarks: [20], toNormal: 30, toCharged: 31, toAbil: 15, frames: 43 },
  { hitmarks: [8], toNormal: 17, toCharged: 23, toAbil: 3, frames: 34 },
  { hitmarks: [37, 45], toNormal: 54, toCharged: 53, toAbil: 33, frames: 70 },
]

type Cancels = Required<
  Pick<
    NonNullable<ActionResult['framesInto']>,
    'skill' | 'burst' | 'dash' | 'jump' | 'swap' | 'wait'
  >
>
/** gcsim's per-hit cancels into the other actions (InitNormalCancelSlice and its overrides) */
const normalCancels: Cancels[] = [
  { skill: 12, burst: 12, dash: 12, jump: 11, swap: 11, wait: 11 },
  { skill: 5, burst: 5, dash: 6, jump: 5, swap: 5, wait: 5 },
  { skill: 33, burst: 33, dash: 34, jump: 34, swap: 33, wait: 33 },
]
const windCancels: Cancels[] = [
  { skill: 15, burst: 15, dash: 15, jump: 15, swap: 15, wait: 15 },
  { skill: 4, burst: 6, dash: 5, jump: 5, swap: 3, wait: 3 },
  { skill: 33, burst: 33, dash: 40, jump: 33, swap: 40, wait: 33 },
]

/** Windfavored: 100 Kuugoryoku Points (120 with A1's Hydro), one per 6 frames; a dash costs 15 */
const WF_POINTS = 100
const POINT_FRAMES = 6
const WF_DASH_COST = 15
/** Windfavored lasts 20 s at most */
const WF_MAX = 1200
/** Falling when Windfavored ends: the next action waits for it; the low plunge is available meanwhile */
const FALL = 26
/** Windfavored's end is checked this often */
const POLL = 3

type Absorbed = 'pyro' | 'hydro' | 'electro' | 'cryo'
/** A1's elements, in gcsim's AbsorbCheck order */
const A1_ELES: readonly Absorbed[] = ['pyro', 'hydro', 'electro', 'cryo']

interface WandererState {
  /** Windfavored's points run out at this frame: undefined when it is not on */
  wfEnd?: number
  /** Windfavored's 20 s limit */
  wfLimit: number
  /** The current activation (stale polls stop) */
  wfId: number
  maxPoints: number
  /** The next action cannot start before this frame (the fall after Windfavored) */
  fallUntil: number
  /** The low plunge is available until this frame */
  plungeUntil: number
  /** A1 (and C4) buffs of this activation */
  contact: Absorbed[]
  /** C6: Kuugo hits that added points this activation, and the ICD's end (frame) */
  c6Count: number
  c6IcdEnd: number
  /** A4 Gales of Reverie: the chance, the Descent effect, the 0.1 s roll ICD */
  a4Prob: number
  descent: boolean
  a4IcdEnd: number
}

const inWf = (s: WandererState, t: number) =>
  s.wfEnd !== undefined && t < s.wfEnd && t < s.wfLimit

/** Points left at `t` (gcsim drops one every 6 frames) */
const pointsAt = (s: WandererState, t: number) =>
  s.wfEnd === undefined
    ? 0
    : Math.max(0, Math.ceil((s.wfEnd - t) / POINT_FRAMES))

const contactPath = (ele: 'pyro' | 'cryo') => [
  'Wanderer',
  ele === 'pyro' ? 'skillPyroContact' : 'skillCryoContact',
]

/** The Windfavored-only conditions, for hits landing after it has ended (snapshot, C6, arrows) */
function wfStates(s: WandererState): NonNullable<SimHit['states']> {
  return [
    { owner: 'Wanderer', path: ['Wanderer', 'afterSkill'], value: 'on' },
    ...(['pyro', 'cryo'] as const).map((ele) => ({
      owner: 'Wanderer' as const,
      path: contactPath(ele),
      value: s.contact.includes(ele) ? ele : '',
    })),
  ]
}

/**
 * Windfavored ends at `t`: its buffs go, the Skill's 6 s cooldown starts `cdDelay` frames
 * after `t`, and (`fall`) the Wanderer falls for 26 frames
 */
function endWf(
  c: SimContext,
  s: WandererState,
  t: number,
  fall: boolean,
  cdDelay = 0
) {
  if (s.wfEnd === undefined) return
  s.wfEnd = undefined
  s.wfId++
  s.descent = false
  s.a4Prob = 0.16
  c.state('Wanderer', ['Wanderer', 'afterSkill'], '')
  for (const ele of ['pyro', 'cryo'] as const)
    c.state('Wanderer', contactPath(ele), '')
  s.contact = []
  c.modifyAttackSpeed('WandererC1', 0, 0, 'Wanderer')
  c.setCooldown('skill', Math.max(0, t + cdDelay + 360 - c.now), 'Wanderer')
  if (fall) {
    s.fallUntil = t + FALL
    s.plungeUntil = t + FALL
  }
}

/** Windfavored's natural end (its points or its 20 s run out), checked every few frames */
function poll(c: SimContext, s: WandererState, id: number) {
  if (s.wfId !== id || s.wfEnd === undefined) return
  const end = Math.min(s.wfEnd, s.wfLimit)
  if (c.now >= end) endWf(c, s, end, true)
  else c.at(POLL, (c2) => poll(c2, s, id))
}

/** The windup before a normal attack (gcsim's attackWindupNormal / attackWindupE) */
function normalWindup(wf: boolean, prev: RotationAction | undefined): number {
  if (!wf) {
    if (prev?.kind === 'normal') return prev.count === 3 ? 3 : 0
    if (prev?.kind === 'charged' || prev?.kind === 'burst') return -2
    return 0
  }
  if (prev?.kind === 'dash') return -3
  if (prev?.kind === 'charged' || prev?.kind === 'jump') return -2
  return 0
}

/** The windup before a Charged Attack (gcsim's chargeWindupNormal / chargeWindupE) */
function chargeWindup(wf: boolean, prev: RotationAction | undefined): number {
  if (!wf) {
    if (prev?.kind === 'normal') return -2
    if (prev?.kind === 'plunge') return -4
    return 0
  }
  if (prev?.kind === 'normal') return -4
  if (prev?.kind === 'charged' || prev?.kind === 'jump') return -7
  if (prev?.kind === 'burst') return -2
  if (prev?.kind === 'dash') return -9
  return 0
}

/** Moves a result's frames (the whole action) by `by` */
function shifted(r: ActionResult, by: number): ActionResult {
  if (by === 0) return r
  return {
    ...r,
    frames: r.frames + by,
    framesInto:
      r.framesInto &&
      Object.fromEntries(
        Object.entries(r.framesInto).map(([k, v]) => [k, (v as number) + by])
      ),
  }
}

/**
 * C6: a Kuugo: Fushoudan hit in Windfavored (with points left) adds a hit of 40% of it 8 frames
 * later, and below 40 points restores 4 (0.2 s ICD, 5 times per Windfavored)
 */
function c6Hit(c: SimContext, s: WandererState, i: number) {
  if (!inWf(s, c.now) || pointsAt(s, c.now) <= 0) return
  if (s.c6Count < 5 && c.now > s.c6IcdEnd && pointsAt(s, c.now) < 40) {
    s.c6Count++
    s.c6IcdEnd = c.now + 12
    if (s.wfEnd !== undefined) s.wfEnd += 4 * POINT_FRAMES
  }
  c.hit(8, {
    path: ['constellation6', `${i}`],
    tag: 'normal',
    element: 'anemo',
    applies: true,
    icd: 'WandererC6',
    label: 'The Curtains’ Melancholic Sway (C6)',
    states: wfStates(s),
  })
}

/** A1 Jade-Claimed Flower: the elements Hanega touches (two at most; C4 adds a random other) */
function absorbA1(c: SimContext, s: WandererState) {
  const left = [...A1_ELES]
  for (let k = 0; k < 2; k++) {
    const ele = c.absorb(left) as Absorbed | undefined
    if (!ele || !left.includes(ele)) break
    s.contact.push(ele)
    left.splice(left.indexOf(ele), 1)
  }
  if (c.constellation('Wanderer') >= 4 && s.contact.length && left.length)
    s.contact.push(left[Math.floor(c.random() * left.length)])
  for (const ele of s.contact) {
    if (ele === 'pyro' || ele === 'cryo')
      c.state('Wanderer', contactPath(ele), ele)
    // Hydro: +20 Kuugoryoku Points (and cap); Electro: Energy (not simulated)
    if (ele === 'hydro' && s.wfEnd !== undefined) {
      s.maxPoints += 20
      s.wfEnd += 20 * POINT_FRAMES
    }
  }
}

export const kit: KitModel = {
  characterKey: 'Wanderer',
  element: 'anemo',
  source: `${GCSIM}/wanderer`,
  // A4's Descent and C4's extra buff are random
  sampled: true,
  normalAnimationDelay: (ctx, s: WandererState, kind) =>
    kind === 'xingqiu' && inWf(s, ctx.now) ? 12 : 0,
  init: (): WandererState => ({
    wfLimit: -1,
    wfId: 0,
    maxPoints: WF_POINTS,
    fallUntil: -1,
    plungeUntil: -1,
    contact: [],
    c6Count: 0,
    c6IcdEnd: -1,
    a4Prob: 0.16,
    descent: false,
    a4IcdEnd: -1,
  }),
  act(ctx, s: WandererState, action, previous) {
    const now = ctx.now
    // Windfavored ran out since the last check: it ends now (with the fall)
    if (s.wfEnd !== undefined && !inWf(s, now))
      endWf(ctx, s, Math.min(s.wfEnd, s.wfLimit), true)
    const fall = Math.max(0, s.fallUntil - now)
    const wf = inWf(s, now)
    const c = ctx.constellation('Wanderer')
    switch (action.kind) {
      case 'normal': {
        const windup = normalWindup(wf, previous) + fall
        const table = wf ? windNormals : wandererNormals
        const cancels = wf ? windCancels : normalCancels
        const n = action.count ?? 1
        const r = normalString(
          table,
          n,
          (i, d) => {
            ctx.hit(windup + d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              icd: 'normal',
              label: wf ? `Kuugo N${i + 1}` : `N${i + 1}`,
              // gcsim bakes the Kuugo multiplier into the attack when it is queued: it stays
              // even if Windfavored ends before the hit (a burst cancel)
              ...(wf ? { states: wfStates(s) } : {}),
            })
            if (wf && c >= 6) ctx.at(windup + d, (c2) => c6Hit(c2, s, i))
          },
          ctx
        )
        // gcsim's per-hit cancels for the last hit of the string
        const last = r.normalStarts![r.normalStarts!.length - 1]
        const speed = ctx.normalAttackSpeed(n > 1)
        const into = { ...r.framesInto }
        for (const [k, v] of Object.entries(cancels[last.index]))
          into[k as keyof Cancels] = last.offset + atkSpdAdjust(v, speed)
        return shifted({ ...r, framesInto: into }, windup)
      }
      case 'charged': {
        const windup = chargeWindup(wf, previous) + fall
        ctx.hit(windup + (wf ? 36 : 34), {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: wf ? 'Kuugo: Toufukai' : 'Charged Attack',
          ...(wf ? { states: wfStates(s) } : {}),
        })
        const adj = (f: number) => windup + atkSpdAdjust(f, ctx.attackSpeed)
        if (wf)
          return {
            frames: adj(70),
            framesInto: {
              normal: adj(49),
              charged: adj(49),
              skill: adj(38),
              burst: adj(38),
              dash: adj(38),
              jump: adj(38),
            },
          }
        return {
          frames: adj(69),
          framesInto: {
            normal: adj(51),
            charged: adj(50),
            skill: adj(49),
            burst: adj(49),
            dash: adj(37),
            jump: adj(37),
            swap: adj(47),
          },
        }
      }
      case 'plunge': {
        // gcsim's low plunge: only right after Windfavored ends (7 frames of fall before it)
        if (wf || now >= s.plungeUntil)
          return {
            frames: 0,
            failed:
              'Wanderer: a low plunge is only possible right after Windfavored ends',
          }
        s.plungeUntil = -1
        s.fallUntil = -1
        const d = fall > 0 ? 7 : 0
        ctx.hit(d + 41, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'anemo',
          applies: true,
          label: 'Low Plunge',
        })
        return shifted(
          {
            frames: 72,
            framesInto: {
              normal: 65,
              charged: 64,
              burst: 65,
              dash: 41,
              swap: 57,
            },
          },
          d
        )
      }
      case 'skill': {
        if (wf) {
          // the second press ends Windfavored: 26 frames of falling (7 for a low plunge)
          endWf(ctx, s, now, false)
          s.plungeUntil = now + FALL
          return { frames: FALL, framesInto: { plunge: 7 } }
        }
        // Hanega: Song of the Wind: Windfavored for its 100 points (600 frames) or 20 s
        s.fallUntil = -1
        s.wfEnd = now + WF_POINTS * POINT_FRAMES
        s.wfLimit = now + WF_MAX
        s.maxPoints = WF_POINTS
        s.wfId++
        s.c6Count = 0
        s.c6IcdEnd = -1
        s.contact = []
        ctx.state('Wanderer', ['Wanderer', 'afterSkill'], 'on')
        absorbA1(ctx, s)
        // C1: Kuugo attacks' ATK SPD +10% while it lasts
        if (c >= 1) ctx.modifyAttackSpeed('WandererC1', 0.1, WF_MAX, 'Wanderer')
        const id = s.wfId
        ctx.at(POLL, (c2) => poll(c2, s, id))
        ctx.hit(2, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          label: 'Hanega: Song of the Wind',
        })
        // (the cooldown starts when Windfavored ends: endWf)
        return { frames: 28 }
      }
      case 'burst': {
        // Five Ceremonial Plays: 5 hits from frame 92, 6 apart, on the stats at frame 55
        const states: NonNullable<SimHit['states']> = []
        if (wf) {
          // C2: +4% DMG per point spent (the sheet's steps of 5 points, 200% at most)
          const spent = s.maxPoints - pointsAt(s, now)
          const step = Math.min(50, Math.round(spent / 5) * 5)
          states.push(...wfStates(s), {
            owner: 'Wanderer',
            path: ['Wanderer', 'c2Points'],
            value: step >= 5 ? `${step}` : '',
          })
        }
        for (let i = 0; i < 5; i++)
          ctx.hit(fall + 92 + 6 * i, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            icd: 'burst',
            snapshotDelay: fall + 55,
            label: 'Five Ceremonial Plays',
            ...(states.length ? { states } : {}),
          })
        if (wf) {
          // a burst in Windfavored ends it; its frames include the fall (gcsim: 117 frames,
          // then the 26-frame fall at the next action, where the Skill's cooldown starts)
          endWf(ctx, s, now, false, 117)
          s.plungeUntil = now + 145 + FALL
          return {
            cooldown: { key: 'burst', frames: 900 },
            frames: 145,
            framesInto: {
              normal: 117 + FALL,
              charged: 119 + FALL,
              dash: 119 + FALL,
              jump: 119 + FALL,
              plunge: 145,
            },
          }
        }
        return shifted(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 101,
            framesInto: {
              normal: 94,
              charged: 96,
              skill: 95,
              dash: 97,
              jump: 96,
              swap: 94,
            },
          },
          fall
        )
      }
      case 'dash':
        if (wf && s.wfEnd !== undefined) {
          // A4: with Descent the dash costs nothing and fires 4 wind arrows (35% ATK each, 60%
          // at C1 in Windfavored); else it costs 15 points
          if (s.descent) {
            s.descent = false
            ;[16, 18, 21, 25].forEach((d) =>
              ctx.hit(d + 30, {
                path: ['passive2', 'dmg'],
                tag: 'other',
                element: 'anemo',
                applies: true,
                icd: 'WandererA4',
                label: 'Gales of Reverie (A4)',
                states: wfStates(s),
              })
            )
          } else s.wfEnd -= WF_DASH_COST * POINT_FRAMES
          return {
            frames: 24,
            framesInto: {
              normal: 21,
              charged: 21,
              skill: 5,
              dash: 22,
              jump: 22,
            },
          }
        }
        // the template's dash (boy body), no early cancel
        return { frames: fall + 21 }
      case 'jump':
        if (wf)
          // (its extra Kuugoryoku cost is not in gcsim or the game data: not modelled)
          return {
            frames: 46,
            framesInto: {
              normal: 22,
              charged: 22,
              skill: 5,
              burst: 5,
              dash: 5,
            },
          }
        // the template's jump (boy body): longer right after a dash. (gcsim's Wanderer jump
        // lasts the template's 60-frame plunge bound instead)
        return { frames: fall + (previous?.kind === 'dash' ? 34 : 31) }
      default:
        return { frames: 30 }
    }
  },
  // the Skill on cooldown only outside Windfavored (where it ends it)
  cooldownKey: (s: WandererState, action, now) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && !inWf(s, now)
        ? 'skill'
        : undefined,
  onHit(ctx, s: WandererState, hit: SimHit) {
    // A4: a Kuugo: Fushoudan or Toufukai hit in Windfavored (one roll per 0.1 s) gives Descent
    // with a 16% chance, +12% per failed roll
    if (
      hit.characterKey !== 'Wanderer' ||
      (hit.tag !== 'normal' && hit.tag !== 'charged') ||
      (hit.path[0] !== 'normal' && hit.path[0] !== 'charged') ||
      !inWf(s, ctx.now) ||
      s.descent ||
      ctx.now <= s.a4IcdEnd
    )
      return
    s.a4IcdEnd = ctx.now + 6
    if (ctx.random() > s.a4Prob) {
      s.a4Prob += 0.12
      return
    }
    s.a4Prob = 0.16
    s.descent = true
  },
  // The game (and gcsim) does not let him swap out in mid-air: a swap waits for Windfavored's end
  // (its points or its 20 s, or a second cast) and the fall after it.
  swapOutReadyAt(_ctx, s: WandererState) {
    return s.wfEnd === undefined
      ? s.fallUntil
      : Math.min(s.wfEnd, s.wfLimit) + FALL
  },
  onSwapOut(ctx, s: WandererState) {
    // (a forced swap: Windfavored ends)
    if (s.wfEnd !== undefined) endWf(ctx, s, ctx.now, false)
  },
}
