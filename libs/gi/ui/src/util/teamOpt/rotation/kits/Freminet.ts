import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  kitFramesInto,
  type NormalHit,
  normalInto,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/freminet, main as of 2026-11-10. */

const freminetNormals: NormalHit[] = [
  {
    hitmarks: [26],
    hitlag: [8],
    toNormal: 32,
    toCharged: 47,
    toAbil: 26,
    frames: 47,
  },
  {
    hitmarks: [23],
    hitlag: [8],
    toNormal: 33,
    toCharged: 49,
    toAbil: 23,
    frames: 49,
  },
  {
    hitmarks: [31],
    hitlag: [8],
    toNormal: 59,
    toCharged: 65,
    toAbil: 31,
    frames: 65,
  },
  {
    hitmarks: [42],
    hitlag: [9],
    toNormal: 86,
    toCharged: 86,
    toAbil: 42,
    frames: 86,
  },
]

/** Pers Time's frost after each normal attack: frames after that attack's hitmark */
const frostDelay = [10, 9, 10, 10]
/** Each normal hit's poise damage (gcsim) */
const attackPoise = [112.6437, 107.8804, 136.267, 165.5529]

/** Pers Time (from Upward Thrust) and Stalking (from the burst): 10 s each */
const persFrames = 10 * 60
const stalkFrames = 10 * 60
/** Spiritbreath Thorn's ICD */
const thornInterval = 9 * 60

interface FreminetState {
  /** Shattering Pressure stacks (0-4) */
  stacks: number
  /** Pers Time is up (ends on a timer; persGen guards stale timers) */
  persOn: boolean
  persGen: number
  /** Subnautical Hunter (Stalking) is up; leaving the field ends it */
  stalkOn: boolean
  stalkGen: number
  /** Spiritbreath Thorn's ICD ends (Freminet's clock) */
  thornReady: number
  /** A4 / C4 / C6 (Freminet's clock): the 0.3 s ICD, and the C4/C6 stacks until they expire */
  c46Ready: number
  c46Stacks: number
  c46End: number
}

const stalking = (s: FreminetState) => s.stalkOn

/** Shattering Pressure: detonates the stacks, `at` frames into the action */
function detonate(ctx: SimContext, s: FreminetState, at: number): ActionResult {
  const stacks = s.stacks
  const lv4 = stacks === 4
  const hm = at + (lv4 ? 37 : 42)
  // Cryo (levels 0-3; not at 4 stacks), then Physical (levels 1-4, the Lv4 box at 4 stacks)
  if (stacks <= 3) {
    ctx.hit(hm, {
      path: [
        'skill',
        ['level0Dmg', 'level1CryoDmg', 'level2CryoDmg', 'level3CryoDmg'][
          stacks
        ],
      ],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      durability: 25,
      icd: 'skill',
      blunt: true,
      poiseDamage: stacks > 0 ? 70 : 150,
      label: `Shattering Pressure (Cryo Lv ${stacks})`,
    })
    // 0.1 s halt
    hitlagMarker(ctx, hm, 6, 'Shattering Pressure hitlag')
  }
  if (stacks >= 1) {
    ctx.hit(hm, {
      path: [
        'skill',
        ['level1PhysDmg', 'level2PhysDmg', 'level3PhysDmg', 'level4Dmg'][
          stacks - 1
        ],
      ],
      tag: 'skill',
      element: 'physical',
      applies: true,
      durability: 25,
      icd: 'none',
      blunt: true,
      poiseDamage: lv4 ? 150 : 70,
      label: `Shattering Pressure (Physical Lv ${stacks})`,
    })
    // Level 4: 0.09 s halt
    if (lv4) hitlagMarker(ctx, hm, 6, 'Shattering Pressure hitlag')
  }
  // A1: a detonation below 4 stacks shortens the Upward Thrust cooldown by 1 s
  // (A1 is assumed unlocked: the simulation does not know ascension)
  if (!lv4) ctx.reduceCooldown('skill', 60)
  s.stacks = 0
  s.persOn = false
  s.persGen++
  const result = withHitlag(
    lv4
      ? {
          frames: 59,
          framesInto: {
            normal: 53,
            skill: 42,
            burst: 42,
            dash: 43,
            jump: 41,
            swap: 51,
          },
        }
      : {
          frames: 55,
          framesInto: {
            normal: 53,
            skill: 47,
            burst: 47,
            dash: 47,
            jump: 47,
            swap: 51,
          },
        },
    { hitmarks: [lv4 ? 37 : 42], hitlag: [6] }
  )
  return shift(result, at)
}

/** Upward Thrust: starts Pers Time (10 s) with no stacks; a Spiritbreath Thorn every 9 s */
function thrust(ctx: SimContext, s: FreminetState): ActionResult {
  s.stacks = 0
  const gen = ++s.persGen
  s.persOn = true
  // Pers Time: 10 s on Freminet's clock (gcsim's status with hitlag)
  ctx.atCharacter('Freminet', persFrames + 1, () => {
    if (s.persGen === gen) s.persOn = false
  })
  ctx.hit(29, {
    path: ['skill', 'thrustDmg'],
    tag: 'skill',
    element: 'cryo',
    applies: true,
    durability: 25,
    icd: 'skill',
    blunt: true,
    poiseDamage: 75,
    label: 'Upward Thrust',
  })
  // 0.08 s halt
  hitlagMarker(ctx, 29, 5, 'Upward Thrust hitlag')
  if (ctx.characterFrame('Freminet') >= s.thornReady) {
    // the Thorn's 9 s ICD is a status on Freminet's clock: ready again on its expiry frame
    s.thornReady = ctx.characterFrame('Freminet') + thornInterval + 1
    ctx.hit(62, {
      path: ['skill', 'thornDmg'],
      tag: 'skill',
      element: 'cryo',
      applies: false,
      durability: 0,
      icd: 'none',
      label: 'Spiritbreath Thorn',
    })
  }
  // Stalking cuts the cooldown by 70% (3 s)
  const cd = stalking(s) ? 180 : 600
  return withHitlag(
    {
      cooldown: { key: 'skill', frames: cd, delay: 35 },
      frames: 46,
      framesInto: { normal: 42, skill: 31, burst: 42, dash: 32, jump: 31 },
    },
    { hitmarks: [29], hitlag: [5] }
  )
}

/** A hit's character hitlag (gcsim: ceil(halt × 0.99), the halt +3.6 when defense-halted) */
function hitlagMarker(
  ctx: SimContext,
  at: number,
  frames: number,
  label: string
) {
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: frames,
    label,
  })
}

/**
 * A Normal Attack string: in Pers Time each step gains a stack (2 while stalking) and a frost
 * hit; at 4 stacks the next step is a Level 4 Shattering Pressure instead (gcsim's Attack, which
 * also resets the combo), and the string goes on from N1 without Pers Time
 */
function normal(
  ctx: SimContext,
  s: FreminetState,
  count: number
): ActionResult {
  const n = Math.max(1, count)
  const first = ctx.normalSequence(freminetNormals.length, 0)
  let idx = first
  let start = 0
  let last: ActionResult | undefined
  for (let step = 0; step < n; step++) {
    if (step > 0) start += kitFramesInto(last!, 'normal')
    if (s.stacks >= 4) {
      last = detonate(ctx, s, start)
      // (the detonation's own frames are relative to the string's start: make them relative)
      last = shift(last, -start)
      idx = 0
      continue
    }
    const i = idx
    const step_ = freminetNormals[i]
    const hm = start + step_.hitmarks[0]
    ctx.hit(hm, {
      path: ['normal', `${i}`],
      tag: 'normal',
      element: 'physical',
      applies: true,
      durability: 25,
      icd: 'normal',
      poiseDamage: attackPoise[i],
      label: `N${i + 1}`,
    })
    hitlagMarker(ctx, hm, step_.hitlag![0], 'Melee hitlag')
    if (s.persOn) {
      // (gcsim: the frost's x2 and the stacks are decided when the attack starts)
      const stalk = stalking(s)
      s.stacks = Math.min(4, s.stacks + (stalk ? 2 : 1))
      ctx.hit(hm + frostDelay[i], {
        path: ['skill', 'frostDmg'],
        tag: 'skill',
        element: 'cryo',
        applies: true,
        durability: 25,
        icd: 'skill',
        blunt: true,
        poiseDamage: 25,
        label: 'Pers Time Frost',
        states: [
          {
            owner: 'Freminet',
            path: ['Freminet', 'stalk'],
            value: stalk ? 'on' : '',
          },
        ],
      })
    }
    last = withHitlag(
      {
        frames: step_.frames,
        framesInto: normalInto(step_),
      },
      step_
    )
    idx = (i + 1) % freminetNormals.length
  }
  ctx.normalSequence(
    freminetNormals.length,
    (idx - first + freminetNormals.length) % freminetNormals.length
  )
  return shift(last!, start)
}

/** An action result `by` frames later */
const shift = (r: ActionResult, by: number): ActionResult => ({
  ...r,
  frames: r.frames + by,
  ...(r.framesInto
    ? {
        framesInto: Object.fromEntries(
          Object.entries(r.framesInto).map(([k, v]) => [k, (v as number) + by])
        ),
      }
    : {}),
})

export const kit: KitModel = {
  characterKey: 'Freminet',
  element: 'cryo',
  source: `${GCSIM}/freminet`,
  init: (): FreminetState => ({
    stacks: 0,
    persOn: false,
    persGen: 0,
    stalkOn: false,
    stalkGen: 0,
    thornReady: -1,
    c46Ready: -1,
    c46Stacks: 0,
    c46End: -1,
  }),
  act(ctx, s: FreminetState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normal(ctx, s, action.count ?? 1)
      case 'skill':
        // in Pers Time the skill detonates (no cooldown), otherwise it is Upward Thrust
        return s.persOn ? detonate(ctx, s, 0) : thrust(ctx, s)
      case 'burst':
        ctx.hit(44, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 25,
          icd: 'none',
          label: "Shadowhunter's Ambush",
        })
        // Subnautical Hunter (Stalking, 10 s on Freminet's clock): two stacks per normal and
        // x2 frost (the 'stalk' conditional, decided per attack); leaving the field ends it
        {
          const gen = ++s.stalkGen
          s.stalkOn = true
          ctx.atCharacter('Freminet', stalkFrames + 1, () => {
            if (s.stalkGen === gen) s.stalkOn = false
          })
        }
        // the burst resets Upward Thrust's cooldown
        ctx.resetCooldown('skill')
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 65,
          framesInto: { normal: 52, skill: 52, dash: 53, jump: 52, swap: 51 },
        }
      case 'charged':
        // gcsim has no charged attack for Freminet (its charge action is not implemented)
        ctx.note(
          'Freminet: the charged attack has no frame data in gcsim, so no damage is modelled.'
        )
        return { frames: 30 }
      case 'plunge':
        // Low Plunge (P: the rotation does not give the height)
        ctx.hit(43, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 85,
          framesInto: {
            normal: 56,
            skill: 55,
            burst: 57,
            dash: 43,
            jump: 84,
            swap: 67,
          },
        }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength)
        return {
          frames: previous?.kind === 'dash' ? 34 : 31,
          framesInto: { plunge: 4 },
        }
      default:
        return { frames: 30 }
    }
  },
  // Pers Time's detonations have no cooldown
  cooldownKey: (s: FreminetState, action) =>
    action.kind === 'skill'
      ? s.persOn
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(_ctx, s: FreminetState) {
    s.stalkOn = false
    s.stalkGen++
  },
  onHit(ctx, s: FreminetState, hit) {
    if (hit.path[0] !== '_reaction' || hit.characterKey !== 'Freminet') return
    const r = hit.path[1]
    const now = ctx.characterFrame('Freminet')
    // A4: Freminet's Shatter: Shattering Pressure DMG +40% for 5 s (Freminet's clock)
    if (r === 'shattered')
      ctx.buff('Freminet', ['Freminet', 'a4AfterShatter'], 'on', 0, 301, {
        hitlag: 'recipient',
      })
    // C4 / C6: Frozen, Shatter, Superconduct or Stellar-Conduct: ATK +9% (2 stacks) and CRIT
    // DMG +12% (3 stacks) for 6 s, once every 0.3 s
    if (
      ctx.constellation('Freminet') < 4 ||
      !['frozen', 'shattered', 'superconduct', 'stellarConduct'].includes(r) ||
      now < s.c46Ready
    )
      return
    s.c46Ready = now + 19
    if (now > s.c46End) s.c46Stacks = 0
    s.c46Stacks = Math.min(3, s.c46Stacks + 1)
    s.c46End = now + 360
    ctx.buff('Freminet', ['Freminet', 'c4C6Stacks'], `${s.c46Stacks}`, 0, 361, {
      hitlag: 'recipient',
    })
  },
}
