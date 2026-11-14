import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xianyun, main as of 2026-11-10. */

// Normal hits: damage at the hitmark + 10 frames of travel; cancels are from the hitmark
const xianyunNormals: NormalHit[] = [
  { hitmarks: [22], toNormal: 17, toCharged: 17, toAbil: 12, frames: 34 },
  { hitmarks: [24], toNormal: 24, toCharged: 23, toAbil: 14, frames: 38 },
  { hitmarks: [44], toNormal: 40, toCharged: 40, toAbil: 34, frames: 65 },
  { hitmarks: [48], toNormal: 91, toCharged: 93, toAbil: 38, frames: 93 },
]

/** White Clouds at Dawn by press (1st, 2nd, 3rd): the press's frames and its state's duration */
const leapFrames: {
  frames: number
  stateFrames: number
  framesInto: NonNullable<ActionResult['framesInto']>
}[] = [
  {
    frames: 244,
    stateFrames: 220,
    framesInto: {
      normal: 221,
      skill: 14,
      burst: 40,
      dash: 39,
      jump: 41,
      swap: 36,
      plunge: 14,
    },
  },
  {
    frames: 243,
    stateFrames: 238,
    framesInto: {
      skill: 15,
      burst: 60,
      dash: 60,
      jump: 60,
      swap: 59,
      plunge: 15,
    },
  },
  {
    frames: 178,
    stateFrames: 179,
    framesInto: {
      skill: 128,
      burst: 126,
      dash: 130,
      jump: 129,
      swap: 126,
      plunge: 18,
    },
  },
]

/** Driftcloud Wave (the plunge in White Clouds) by leaps 1-3: its damage frame and the plunge's frames */
const driftHitmark = [35, 40, 46]
const driftNodes = ['firstLeapDmg', 'secondLeapDmg', 'thirdLeapDmg']
const driftFrames: {
  frames: number
  framesInto: NonNullable<ActionResult['framesInto']>
}[] = [
  {
    frames: 65,
    framesInto: {
      normal: 57,
      charged: 49,
      skill: 56,
      burst: 54,
      dash: 51,
      jump: 56,
      swap: 49,
    },
  },
  {
    frames: 70,
    framesInto: {
      normal: 60,
      charged: 54,
      skill: 55,
      burst: 61,
      dash: 55,
      jump: 62,
      swap: 53,
    },
  },
  {
    frames: 76,
    framesInto: {
      normal: 66,
      charged: 60,
      skill: 64,
      burst: 67,
      dash: 63,
      jump: 68,
      swap: 62,
    },
  },
]

interface XianyunState {
  /** Presses in the current White Clouds cycle (0: none); its state is up until cycleEnd */
  presses: number
  cycleEnd: number
  /** The press that started the latest state (C: its unused end shortens the cooldown) */
  pressSrc: number
  /** The last action was a White Clouds press (its cooldown is then not waited for) */
  lastE: boolean
  /** Adeptal Assistance stacks (Starwicker), and the airborne buff of Stars Gather at Dusk until airEnd */
  stacks: number
  airEnd: number
  /** Jumped under the airborne buff: a high plunge can follow */
  airborne: boolean
  /** Swapped out since the last action */
  away: boolean
  /** C6: White Clouds at Dawn does not go on cooldown until c6End, for c6Uses more cycles */
  c6End: number
  c6Uses: number
}

/** A White Clouds cycle can start without its cooldown (C6 after the burst) */
const c6Free = (s: XianyunState, now: number) => now < s.c6End && s.c6Uses > 0
/** The next press continues the current cycle */
const cycling = (s: XianyunState, now: number) =>
  s.lastE && s.presses > 0 && s.presses < 3 && now < s.cycleEnd

/** Starwicker: a plunge while the airborne buff lasts and stacks are left; 5 frames after its hit */
function starwicker(ctx: SimContext, s: XianyunState, plungeHit: number) {
  if (s.stacks <= 0 || ctx.now + plungeHit >= s.airEnd) return
  s.stacks--
  ctx.hit(plungeHit + 5, {
    path: ['burst', 'coordinatedDmg'],
    tag: 'burst',
    element: 'anemo',
    applies: true,
    durability: 25,
    icd: 'burst',
    label: 'Starwicker',
  })
}

export const kit: KitModel = {
  characterKey: 'Xianyun',
  element: 'anemo',
  source: `${GCSIM}/xianyun`,
  init: (): XianyunState => ({
    presses: 0,
    cycleEnd: -1,
    pressSrc: -1,
    lastE: false,
    stacks: 0,
    airEnd: -1,
    airborne: false,
    away: false,
    c6End: -1,
    c6Uses: 0,
  }),
  // C1: two charges of White Clouds at Dawn
  charges: (cons) => ({ skill: cons >= 1 ? 2 : 1 }),
  act(ctx, s: XianyunState, action, previous) {
    const afterE = s.lastE
    const swapped = s.away
    s.lastE = false
    s.away = false
    switch (action.kind) {
      case 'normal':
        return normalString(
          xianyunNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // 14 frames of windup after a normal attack (not after a swap)
        const windup = previous?.kind === 'normal' && !swapped ? 14 : 0
        ctx.hit(66 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: 'Charged Attack',
        })
        return {
          frames: 73 - windup,
          framesInto: {
            normal: 62 - windup,
            charged: 61 - windup,
            skill: 62 - windup,
            burst: 61 - windup,
            dash: 56 - windup,
            jump: 56 - windup,
            swap: 56 - windup,
          },
        }
      }
      case 'skill': {
        // a press inside a cycle continues it; otherwise a new cycle starts (12 s cooldown,
        // none within 16 s of the burst at C6, for 8 cycles)
        const cont =
          afterE && s.presses > 0 && s.presses < 3 && ctx.now < s.cycleEnd
        let cooldown: ActionResult['cooldown']
        if (!cont) {
          s.presses = 0
          if (ctx.constellation('Xianyun') >= 6 && c6Free(s, ctx.now))
            s.c6Uses--
          else cooldown = { key: 'skill', frames: 720 }
          // Skyladder: one hit per enemy per cycle. (gcsim only hits an enemy whose centre is
          // within 1.5 m of her: not the case for its standard target, so it never hits there)
          ctx.hit(3, {
            path: ['skill', 'trailDmg'],
            tag: 'skill',
            element: 'anemo',
            applies: false,
            durability: 0,
            label: 'Skyladder',
          })
        }
        const press = leapFrames[s.presses]
        s.presses++
        s.cycleEnd = ctx.now + press.stateFrames
        s.lastE = true
        // the state running out without a Driftcloud Wave shortens the next cooldown by 3 s
        const src = ctx.now
        s.pressSrc = src
        ctx.atCharacter('Xianyun', press.stateFrames, (c2) => {
          if (s.pressSrc !== src) return
          s.pressSrc = -1
          c2.reduceCooldown('skill', 180, 'Xianyun')
        })
        if (ctx.constellation('Xianyun') >= 2)
          ctx.buff('Xianyun', ['Xianyun', 'c2AfterSkill'], 'on', 0, 900)
        return {
          ...(cooldown ? { cooldown } : {}),
          frames: press.frames,
          framesInto: press.framesInto,
        }
      }
      case 'burst':
        ctx.hit(75, {
          path: ['burst', 'instantDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 25,
          label: 'Stars Gather at Dusk',
        })
        // 8 Adeptal Assistance stacks and the airborne buff, 16 s from the hit at 75 frames
        // C6: White Clouds at Dawn goes on no cooldown for 16 s (8 cycles at most)
        if (ctx.constellation('Xianyun') >= 6) {
          s.c6End = ctx.now + 960
          s.c6Uses = 8
        }
        ctx.at(75, (c) => {
          s.stacks = 8
          s.airEnd = c.now + 960
          c.state('Xianyun', ['Xianyun', '_airborne'], 'on')
          c.at(960, (c2) => c2.state('Xianyun', ['Xianyun', '_airborne'], ''))
        })
        // Register A4 as a simulated conditional; eligible impact hits snapshot it below.
        ctx.buff('Xianyun', ['Xianyun', 'a4HasStacks'], '', 0, 0)
        ctx.hit(75, {
          path: ['_heal', 'burst', 'instantHeal'],
          tag: 'other',
          element: 'anemo',
          weight: ctx.members.length,
          label: 'Stars Gather at Dusk (heal)',
        })
        for (let at = 79; at <= 1039; at += 150)
          ctx.hit(at, {
            path: ['_heal', 'burst', 'deviceHeal'],
            tag: 'other',
            element: 'anemo',
            weight: ctx.members.length,
            label: 'Starwicker (heal)',
          })
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 103,
          framesInto: {
            normal: 101,
            charged: 102,
            skill: 101,
            dash: 101,
            swap: 99,
          },
        }
      case 'plunge': {
        if (s.presses > 0 && ctx.now < s.cycleEnd) {
          // Driftcloud Wave: its damage, then an A1 Boost stack for the party (enemy hit, 20 s)
          const ind = s.presses - 1
          const at = driftHitmark[ind]
          ctx.hit(at, {
            path: ['skill', driftNodes[ind]],
            tag: 'plunge',
            element: 'anemo',
            applies: true,
            durability: 25,
            label: `Driftcloud Wave (${s.presses} leap${s.presses > 1 ? 's' : ''})`,
            // C6: its CRIT DMG +15/35/70% by the Skyladders used (the sheet gates C6)
            states: [
              {
                owner: 'Xianyun',
                path: ['Xianyun', 'c6SkyladderUses'],
                value: `${s.presses}`,
              },
            ],
          })
          // A1: each hit gives the party a Storm Pinion for 20 s (4 at most, each on its own)
          ctx.buff('Xianyun', ['Xianyun', 'a1Stacks'], '1', at + 1, 1200, {
            max: 4,
          })
          s.presses = 0
          s.cycleEnd = -1
          s.pressSrc = -1
          return driftFrames[ind]
        }
        if (s.airborne) {
          // a high plunge (the rotation's plunge; a low plunge is not told apart)
          s.airborne = false
          ctx.hit(46, {
            path: ['plunging', 'high'],
            tag: 'plunge',
            element: 'anemo',
            applies: true,
            durability: 25,
            label: 'High Plunge',
          })
          return {
            frames: 68,
            framesInto: {
              normal: 59,
              charged: 54,
              skill: 59,
              burst: 59,
              dash: 46,
              swap: 51,
            },
          }
        }
        return {
          frames: 0,
          failed:
            'Xianyun: a plunge needs White Clouds at Dawn or a jump under Stars Gather at Dusk',
        }
      }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        if (ctx.now < s.airEnd && s.stacks > 0) {
          // jumping under the airborne buff: a high plunge can follow (8 frames)
          s.airborne = true
          return { frames: 60, framesInto: { plunge: 8, wait: 4 } }
        }
        s.airborne = false
        // gcsim's template jump (Lady body): a following wait starts at the low-plunge cancel
        return templateJump('lady', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // a plain E's follow-up press is not waited for (see act): the cycle continues
  cooldownKey: (s: XianyunState, action, now) =>
    action.kind === 'skill'
      ? cycling(s, now) || (now < s.c6End && s.c6Uses > 0 && s.c6End > 0)
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(_ctx, s: XianyunState) {
    s.away = true
    s.lastE = false
  },
  onHit(ctx, s: XianyunState, hit) {
    // Evaluate impact bonuses before consuming a stack, including the eighth impact.
    if (
      hit.characterKey === hit.onField &&
      (hit.tag === 'plunge' || /Low Plunge|High Plunge/.test(hit.label)) &&
      hit.applies &&
      (hit.durability ?? 25) > 0 &&
      s.stacks > 0 &&
      ctx.now < s.airEnd
    ) {
      if (hit.tag === 'plunge')
        (hit.states ??= []).push({
          owner: 'Xianyun',
          path: ['Xianyun', 'a4HasStacks'],
          value: 'on',
        })
      starwicker(ctx, s, 0)
      if (s.stacks === 0) ctx.state('Xianyun', ['Xianyun', '_airborne'], '')
    }
  },
}
