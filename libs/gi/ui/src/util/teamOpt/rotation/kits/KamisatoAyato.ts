import { annulusHitChance } from '../geometry'
import type { ActionResult, KitModel, SimContext } from '../types'
import {
  atkSpdAdjust,
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ayato, main as of 2026-11-10. */

/** Normal attack string N1..N5 (gcsim's attackFrames) */
const ayatoNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 15,
    toCharged: 21,
    toAbil: 12,
    frames: 21,
  },
  {
    hitmarks: [18],
    hitlag: [6],
    toNormal: 27,
    toCharged: 27,
    toAbil: 18,
    frames: 27,
  },
  {
    hitmarks: [20],
    hitlag: [8],
    toNormal: 30,
    toCharged: 34,
    toAbil: 20,
    frames: 34,
  },
  { hitmarks: [22, 25], toNormal: 27, toCharged: 29, toAbil: 25, frames: 29 },
  {
    hitmarks: [41],
    hitlag: [9],
    toNormal: 63,
    toCharged: 63,
    toAbil: 41,
    frames: 63,
  },
]

/** Kamisato Art: Kyouka (the Namisen state): 6 s from the cast */
const KYOUKA = 6 * 60
/** The Water Illusion explodes this many frames after the cast (gcsim's default illusion delay) */
const ILLUSION_DELAY = 35
/** Shunsuiken (in Kyouka): hitmark and animation */
const SHUN_HITMARK = 5
const SHUN_FRAMES = 23

interface AyatoState {
  /** Kyouka (Namisen) ends at this frame (undefined: not in it) */
  kyoukaEnd?: number
  /** Namisen stacks now (A1: 2 on the cast, the max when the illusion explodes) */
  stacks: number
  /** The next Shunsuiken (0..2) */
  shun: number
  /** C6: the next Shunsuiken adds two strikes */
  c6: boolean
  /** C4: the party's Normal Attack SPD +15% until this frame (15 s from the burst) */
  c4End?: number
}

/**
 * Namisen stacks (the sheet's skillStacks): the count, held as a state from this frame (up to 4,
 * 5 with C2); '' ends it (Kyouka's end, or Ayato leaving the field)
 */
const setStacks = (ctx: SimContext, s: AyatoState, stacks: number) => {
  s.stacks = stacks
  ctx.state(
    'KamisatoAyato',
    ['KamisatoAyato', 'skillStacks'],
    stacks > 0 ? `${stacks}` : ''
  )
}

/**
 * Kyouka's Shunsuiken: one hit per normal attack, the three in turn. Each one uses the stacks it
 * has when it starts, then adds a stack from its hit (up to the max).
 */
function shunsuiken(
  ctx: SimContext,
  s: AyatoState,
  count: number,
  end: number
): ActionResult {
  const max = ctx.constellation('KamisatoAyato') >= 2 ? 5 : 4
  let start = 0
  // (Shunsuiken's animation follows Normal Attack SPD: gcsim's AtkSpdAdjust)
  const step = (i: number) =>
    atkSpdAdjust(SHUN_FRAMES, ctx.normalAttackSpeed(i > 0))
  for (let i = 0; i < count; i++) {
    const idx = s.shun
    s.shun = (s.shun + 1) % 3
    ctx.hit(start + SHUN_HITMARK, {
      path: ['skill', `dmg${idx}`],
      tag: 'normal',
      element: 'hydro',
      applies: true,
      icd: 'normal',
      label: `Shunsuiken ${idx + 1}`,
    })
    // C6: the first Shunsuiken after the cast adds two strikes (20 and 22 frames after its hit)
    if (s.c6) {
      s.c6 = false
      for (const extra of [20, 22])
        ctx.hit(start + SHUN_HITMARK + extra, {
          path: ['constellation6', 'dmg'],
          tag: 'normal',
          element: 'hydro',
          applies: true,
          label: 'Boundless Origin (C6)',
        })
    }
    // the stack it adds, from its hit (+1 frame, so the hit itself does not count it)
    const from = start + SHUN_HITMARK + 1
    if (ctx.now + from < end)
      ctx.at(from, (c2) => {
        if (s.kyoukaEnd === end && s.stacks < max)
          setStacks(c2, s, s.stacks + 1)
      })
    if (i < count - 1) start += step(i)
  }
  return {
    frames: start + step(count - 1),
    framesInto: {
      normal: start + step(count - 1),
      charged: start + step(count - 1),
      skill: start + SHUN_HITMARK,
      burst: start + SHUN_HITMARK,
      dash: start + SHUN_HITMARK,
      jump: start + SHUN_HITMARK,
      swap: start + SHUN_HITMARK,
    },
  }
}

export const kit: KitModel = {
  characterKey: 'KamisatoAyato',
  element: 'hydro',
  source: `${GCSIM}/ayato`,
  normalAnimationDelay: (ctx, s: AyatoState, kind) =>
    kind === 'xingqiu'
      ? s.kyoukaEnd !== undefined && ctx.now < s.kyoukaEnd
        ? 17
        : 15
      : 0,
  init: (): AyatoState => ({ stacks: 0, shun: 0, c6: false }),
  // C4: the party's Normal Attack SPD +15% for 15 s after the burst (gcsim's stat modifier)
  normalAttackSpeed: (ctx, s: AyatoState) =>
    ctx.constellation('KamisatoAyato') >= 4 && ctx.now < (s.c4End ?? -1)
      ? 0.15
      : 0,
  // In Takimeguri Kanka his normal attacks are Shunsuiken slashes (their own frames)
  variant(ctx, s: AyatoState, action) {
    return action.kind === 'normal' &&
      s.kyoukaEnd !== undefined &&
      ctx.now < s.kyoukaEnd
      ? { key: 'shunsuiken', label: 'Shunsuiken', mode: 'Takimeguri Kanka' }
      : undefined
  },
  act(ctx, s: AyatoState, action, previous) {
    const inKyouka = s.kyoukaEnd !== undefined && ctx.now < s.kyoukaEnd
    switch (action.kind) {
      case 'normal':
        if (inKyouka) return shunsuiken(ctx, s, action.count ?? 1, s.kyoukaEnd!)
        return normalString(
          ayatoNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // gcsim: "charged attack called in skill state"
        if (inKyouka)
          return {
            frames: 0,
            failed: 'Ayato: no Charged Attack during Kamisato Art: Kyouka',
          }
        ctx.hit(24, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'extra',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 55,
          framesInto: {
            normal: 55,
            skill: 55,
            burst: 55,
            dash: 24,
            jump: 24,
            swap: 53,
          },
        }
      case 'plunge':
        // gcsim has low and high plunges (the rotation has no height): modelled as a low plunge
        if (inKyouka)
          return {
            frames: 0,
            failed: 'Ayato: no plunge during Kamisato Art: Kyouka',
          }
        ctx.hit(45, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 75,
          framesInto: {
            normal: 55,
            skill: 55,
            burst: 55,
            dash: 45,
            jump: 73,
            swap: 62,
          },
        }
      case 'skill': {
        const c = ctx.constellation('KamisatoAyato')
        ctx.hit(ILLUSION_DELAY, {
          path: ['skill', 'illusionDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Water Illusion',
        })
        // Kyouka: 6 s from the cast; A1: 2 Namisen stacks on use, the max when the illusion explodes
        s.kyoukaEnd = ctx.now + KYOUKA
        setStacks(ctx, s, 2)
        const end = s.kyoukaEnd
        const max = c >= 2 ? 5 : 4
        ctx.at(ILLUSION_DELAY, (c2) => {
          if (s.kyoukaEnd !== end || c2.now >= end) return
          setStacks(c2, s, max)
        })
        ctx.at(KYOUKA, (c2) => {
          if (s.kyoukaEnd === end) setStacks(c2, s, 0)
        })
        if (c >= 6) s.c6 = true
        if (c >= 1)
          ctx.note('Ayato: C1 (enemy at 50% HP or less) is not modelled.')
        return {
          cooldown: { key: 'skill', frames: 12 * 60 },
          frames: 21,
        }
      }
      case 'burst': {
        // Bloomwater Blade: a blade every 0.5 s from 101 frames in (36 ticks), each hitting 38
        // frames after its tick
        const chance = annulusHitChance(
          1.5,
          9.5,
          ctx.target.radius + 2.5,
          ctx.target.distance
        )
        let credit = 0
        ctx.note(
          'Ayato: random burst droplets use expected hit frequency for the single target’s size and distance.'
        )
        for (let k = 0; k < 36; k++) {
          // A target can be selected once per 1.45 s; the other droplets land randomly.
          if (k % 3 !== 0) {
            credit += chance
            if (credit < 1) continue
            credit--
          }
          ctx.hit(139 + 30 * k, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'hydro',
            applies: true,
            icd: 'burst',
            label: 'Bloomwater Blade',
          })
        }
        // the burst's Normal Attack DMG for the active member: from the first tick until 90
        // frames after the last one
        ctx.buff(
          'KamisatoAyato',
          ['KamisatoAyato', 'burstInArea'],
          'on',
          101,
          1151 + 90 - 101
        )
        if (ctx.constellation('KamisatoAyato') >= 4) {
          ctx.buff(
            'KamisatoAyato',
            ['KamisatoAyato', 'c4AfterBurst'],
            'on',
            0,
            15 * 60
          )
          s.c4End = ctx.now + 15 * 60
        }
        return {
          cooldown: { key: 'burst', frames: 20 * 60 },
          frames: 123,
          framesInto: { skill: 122, dash: 122, jump: 122, swap: 120 },
        }
      }
      case 'dash':
        // the template's dash (male body)
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // the template's jump: longer right after a dash
        return templateJump('male', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // leaving the field ends Kyouka and its stacks (C2's Max HP with them)
  onSwapOut(ctx, s: AyatoState) {
    if (s.kyoukaEnd !== undefined) setStacks(ctx, s, 0)
    s.kyoukaEnd = undefined
  },
}
