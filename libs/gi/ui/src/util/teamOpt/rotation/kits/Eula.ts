import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/eula, main as of 2026-11-10. */

const eulaNormals: NormalHit[] = [
  {
    hitmarks: [30],
    hitlag: [9],
    toNormal: 34,
    toCharged: 34,
    toAbil: 30,
    frames: 34,
  },
  {
    hitmarks: [19],
    hitlag: [11],
    toNormal: 36,
    toCharged: 36,
    toAbil: 19,
    frames: 36,
  },
  {
    hitmarks: [25, 42],
    hitlag: [0, 9],
    toNormal: 56,
    toCharged: 56,
    toAbil: 42,
    frames: 56,
  },
  {
    hitmarks: [17],
    hitlag: [9],
    toNormal: 44,
    toCharged: 44,
    toAbil: 17,
    frames: 44,
  },
  {
    hitmarks: [29, 56],
    hitlag: [0, 11],
    toNormal: 105,
    toCharged: 105,
    toAbil: 56,
    frames: 105,
  },
]

/** Icewhirl Brand hitmarks (one per Grimheart stack consumed) */
const ICEWHIRL_HITMARKS = [79, 92]
/** Grimheart: 18 s, refreshed by each Icetide Vortex press hit; up to 2 stacks */
const GRIMHEART_DURATION = 1080
/**
 * Lightfall Sword: the status runs from 117 to 566 frames after Glacial Illumination, and the
 * sword explodes at 565 (or when Eula leaves the field), landing 35 frames later
 */
const LIGHTFALL_START = 117
const LIGHTFALL_END = 566
const LIGHTFALL_TRIGGER = 565
const LIGHTFALL_HITMARK = 35
/** A Lightfall stack is gained at most once per 0.1 s */
const STACK_ICD = 6

interface LightfallSword {
  /** Its status window: a stack counts while the status runs */
  start: number
  end: number
  /** Stacks (C6 adds 1.5 expected stacks per stack: the extra one is 50%) */
  stacks: number
}

interface EulaState {
  /** Grimheart stacks, and the frame of Eula's clock they run out (inclusive) */
  grimheart: number
  grimheartUntil: number
  grimheartToken: number
  /** The Lightfall Sword, while its status runs (undefined: none) */
  lightfall?: LightfallSword
  stackIcdUntil: number
  /** Notes shown once */
  noted: Set<string>
}

/** The sheet's Grimheart state (its DEF bonus) */
function syncGrimheart(ctx: SimContext, s: EulaState) {
  ctx.state(
    'Eula',
    ['Eula', 'Grimheart'],
    s.grimheart > 0 ? `stack${s.grimheart}` : ''
  )
}

/** Settles the Grimheart stacks to now (they go when the status runs out) */
function grimheart(ctx: SimContext, s: EulaState): number {
  if (ctx.characterFrame('Eula') > s.grimheartUntil) s.grimheart = 0
  return s.grimheart
}

/** A Grimheart stack (max 2); the duration (18 s, Eula's clock) restarts */
function addGrimheart(ctx: SimContext, s: EulaState) {
  grimheart(ctx, s)
  s.grimheart = Math.min(2, s.grimheart + 1)
  s.grimheartUntil = ctx.characterFrame('Eula') + GRIMHEART_DURATION
  syncGrimheart(ctx, s)
  const token = ++s.grimheartToken
  ctx.atCharacter('Eula', GRIMHEART_DURATION + 1, (c) => {
    if (s.grimheartToken !== token) return
    s.grimheart = 0
    syncGrimheart(c, s)
  })
}

function noteOnce(ctx: SimContext, s: EulaState, text: string) {
  if (s.noted.has(text)) return
  s.noted.add(text)
  ctx.note(text)
}

/** The Lightfall Sword explodes: its damage by the stacks it has (the sheet's stack state) */
function explode(ctx: SimContext, s: EulaState, lf: LightfallSword) {
  s.lightfall = undefined
  const stacks = Math.min(30, Math.round(lf.stacks))
  ctx.hit(LIGHTFALL_HITMARK, {
    path: ['burst', 'lightFallSwordNew'],
    tag: 'burst',
    element: 'physical',
    applies: true,
    durability: 50,
    icd: 'none',
    blunt: true,
    poiseDamage: 400,
    label: 'Lightfall Sword',
    states: [
      {
        owner: 'Eula',
        path: ['Eula', 'LightfallSword'],
        value: stacks > 0 ? `${stacks}` : '',
      },
    ],
  })
}

export const kit: KitModel = {
  characterKey: 'Eula',
  element: 'cryo',
  source: `${GCSIM}/eula`,
  init: (): EulaState => ({
    grimheart: 0,
    grimheartUntil: -1,
    grimheartToken: 0,
    stackIcdUntil: -1,
    noted: new Set(),
  }),
  act(ctx, s: EulaState, action, previous) {
    const c = ctx.constellation('Eula')
    switch (action.kind) {
      case 'normal':
        return normalString(
          eulaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              blunt: true,
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // gcsim has no Eula charged attack (its spin is not implemented)
        noteOnce(ctx, s, 'Eula: charged attack is not in gcsim: not modelled')
        return { frames: 30 }
      case 'skill': {
        if (!action.hold) {
          // Icetide Vortex (press): one hit, a Grimheart stack on hit (at 20)
          ctx.hit(20, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'none',
            blunt: true,
            poiseDamage: 120,
            label: 'Icetide Vortex',
          })
          ctx.hit(20, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 9,
            label: 'Icetide Vortex hitlag',
          })
          ctx.at(20, (c2) => addGrimheart(c2, s))
          const result: ActionResult = {
            frames: 48,
            framesInto: {
              normal: 31,
              charged: 48,
              skill: 48,
              burst: 31,
              dash: 29,
              jump: 30,
              swap: 29,
            },
            cooldown: { key: 'skill', frames: 240, delay: 16 },
          }
          return withHitlag(result, { hitmarks: [20], hitlag: [9] })
        }
        // Icetide Vortex (hold): consumes the Grimheart stacks
        const v = grimheart(ctx, s)
        ctx.hit(49, {
          path: ['skill', 'hold'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 150,
          label: 'Icetide Vortex (hold)',
        })
        ctx.hit(49, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 11,
          label: 'Icetide Vortex hitlag',
        })
        // each stack: an Icewhirl Brand hit (the first at 79 frames, world time; the second at 92
        // of Eula's clock); its hit lowers Physical and Cryo RES after its damage, for 7 s per
        // stack consumed (gcsim; the game's "RES Decrease Duration: 7s" does not say per what)
        const brand = (c2: SimContext, i: number) => {
          c2.hit(0, {
            path: ['skill', 'icewhirl'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'skill',
            label: `Icewhirl Brand (${i + 1})`,
          })
          c2.buff(
            'Eula',
            ['Eula', 'grimheartConsumed'],
            'on',
            1,
            7 * v * 60 + 1,
            {
              hitlag: 'enemy',
            }
          )
        }
        if (v >= 1) ctx.at(ICEWHIRL_HITMARKS[0], (c2) => brand(c2, 0))
        if (v >= 2)
          ctx.atCharacter('Eula', ICEWHIRL_HITMARKS[1], (c2) => brand(c2, 1))
        // A1: 2 stacks: a Shattered Lightfall Sword explodes at 108 frames (queued at 50 of
        // Eula's clock, then world time)
        if (v === 2)
          ctx.atCharacter('Eula', 50, (c2) =>
            c2.hit(108 - 50, {
              path: ['passive1', 'shatteredLightfallSword'],
              tag: 'burst',
              element: 'physical',
              applies: true,
              durability: 25,
              icd: 'none',
              blunt: true,
              poiseDamage: 180,
              label: 'Shattered Lightfall Sword (A1)',
            })
          )
        // C1: Tidal Illusion, +30% Physical DMG for (6 x stacks + 6) s, up to 18 s
        if (c >= 1 && v > 0)
          ctx.buff(
            'Eula',
            ['Eula', 'TidalIllusion'],
            'on',
            0,
            (6 * v + 6) * 60,
            {
              hitlag: 'recipient',
            }
          )
        s.grimheart = 0
        s.grimheartUntil = -1
        s.grimheartToken++
        syncGrimheart(ctx, s)
        const cd = c >= 2 ? 4 : 10
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: cd * 60, delay: 46 },
            frames: 75,
            framesInto: {
              normal: 77,
              charged: 100,
              skill: 100,
              burst: 77,
              dash: 75,
              jump: 75,
              swap: 100,
            },
          },
          { hitmarks: [49], hitlag: [11] }
        )
      }
      case 'burst': {
        // Glacial Illumination: the initial hit (no Lightfall stack from it)
        ctx.hit(100, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'none',
          blunt: true,
          label: 'Glacial Illumination',
        })
        // A4 (assumed unlocked): Icetide Vortex's cooldown resets and Eula gains a Grimheart stack
        // (gcsim adds it only to stacks whose status is still up; the game text has no condition)
        addGrimheart(ctx, s)
        ctx.resetCooldown('skill')
        const lf: LightfallSword = {
          start: ctx.now + LIGHTFALL_START,
          end: ctx.now + LIGHTFALL_END,
          stacks: c >= 6 ? 5 : 0,
        }
        s.lightfall = lf
        const trigger = (c2: SimContext) => {
          if (s.lightfall !== lf) return
          if (c2.now < lf.end - 1) c2.at(lf.end - 1 - c2.now, trigger)
          else explode(c2, s, lf)
        }
        ctx.at(LIGHTFALL_TRIGGER, trigger)
        if (c >= 4)
          noteOnce(
            ctx,
            s,
            'Eula C4 (+25% Lightfall Sword DMG below 50% enemy HP): not modelled'
          )
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 97 },
          frames: 117,
          framesInto: {
            normal: 120,
            charged: 123,
            skill: 123,
            burst: 123,
            dash: 122,
            jump: 121,
            swap: 120,
          },
        }
      }
      case 'plunge':
        // gcsim's Low Plunge (collision off, its default); the High Plunge needs Xianyun's
        // airborne state, which the rotation text can't give
        ctx.hit(37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 79,
          framesInto: {
            normal: 50,
            charged: 80,
            skill: 51,
            burst: 50,
            dash: 37,
            jump: 80,
            swap: 62,
          },
        }
      case 'dash':
        // Lady body (gcsim's template): 22 frames, 3 to a jump
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // Lady body: 32 frames, 37 after a dash
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: EulaState, hit) {
    if (
      hit.characterKey === 'Eula' &&
      hit.path[0] === 'skill' &&
      ['press', 'hold'].includes(hit.path[1])
    )
      ctx.hit(100, {
        path: ['_particle', 'cryo'],
        tag: 'other',
        element: 'cryo',
        weight: hit.path[1] === 'hold' ? 2.5 : 1.5,
        label: 'Icetide Vortex (particles)',
      })
    const lf = s.lightfall
    if (!lf || hit.characterKey !== 'Eula' || hit.onField !== 'Eula') return
    if (hit.t < lf.start || hit.t >= lf.end) return
    // (the sword's status and its explosion run on world time: gcsim's core status and task)
    // gcsim's stack hook: Eula's normal attacks, Icetide Vortex and A1's sword (with damage)
    const stackable =
      hit.tag === 'normal' || hit.tag === 'skill' || hit.path[0] === 'passive1'
    if (!stackable || hit.t < s.stackIcdUntil) return
    s.stackIcdUntil = hit.t + STACK_ICD
    lf.stacks += ctx.constellation('Eula') >= 6 ? 1.5 : 1
  },
  onSwapOut(ctx, s: EulaState) {
    // leaving the field explodes the sword (if its status is up)
    const lf = s.lightfall
    if (lf && ctx.now >= lf.start) explode(ctx, s, lf)
  },
}
