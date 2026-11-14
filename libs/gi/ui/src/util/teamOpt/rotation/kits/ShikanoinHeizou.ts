import type { HitElement, KitModel } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/heizou, main as of 2026-11-10. */

const heizouNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 20,
    toCharged: 21,
    toAbil: 12,
    frames: 21,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 17,
    toCharged: 21,
    toAbil: 13,
    frames: 21,
  },
  {
    hitmarks: [21],
    hitlag: [8],
    toNormal: 45,
    toCharged: 46,
    toAbil: 21,
    frames: 46,
  },
  // the 4th string step: 3 hits (sheet nodes 3, 4, 5)
  {
    hitmarks: [13, 19, 27],
    hitlag: [0, 0, 9],
    toNormal: 36,
    toCharged: 38,
    toAbil: 27,
    frames: 38,
  },
  {
    hitmarks: [31],
    hitlag: [11],
    toNormal: 66,
    toCharged: 66,
    toAbil: 31,
    frames: 66,
  },
]

/** The sheet's normal nodes: 0-2 are the first three steps, 3-5 the three hits of step 4, 6 step 5 */
const normalNode = (i: number, j: number) => (i === 3 ? 3 + j : i === 4 ? 6 : i)

/** Elements a Windmuster Iris can take, in gcsim's aura priority */
const irisEles: HitElement[] = ['pyro', 'hydro', 'electro', 'cryo']

interface HeizouState {
  /** Declension stacks (0-4) */
  stacks: number
  /** C1: the next swap-in works from this frame (once every 10 s) */
  c1Ready: number
  /** A1: the next Swirl stack from this frame (0.1 s ICD) */
  a1Ready: number
}

const addStack = (s: HeizouState) => {
  s.stacks = Math.min(4, s.stacks + 1)
}

export const kit: KitModel = {
  characterKey: 'ShikanoinHeizou',
  element: 'anemo',
  source: `${GCSIM}/heizou`,
  init: (): HeizouState => ({ stacks: 0, c1Ready: 0, a1Ready: -1 }),
  act(ctx, s: HeizouState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          heizouNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${normalNode(i, j)}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              icd: 'normal',
              label: i === 3 ? `N4 (hit ${j + 1})` : `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(24, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return {
          frames: 46,
          framesInto: { normal: 38, skill: 38, burst: 38, dash: 24, jump: 24 },
        }
      case 'skill': {
        const hold = !!action.hold
        const d0 = s.stacks
        // a press releases at once; a hold adds a stack every 45 frames up to 4, then releases
        // (after 17 frames if already at 4). The release is 2 frames before the hit.
        const release = hold ? (d0 >= 4 ? 17 : 45 * (4 - d0)) : 0
        const hitAt = 20 + release
        const stacksAt = hold ? 4 : d0
        // its hitlag on Heizou: 0.09 s (0.12 s with Conviction), no defense halt
        const hitlag = stacksAt >= 4 ? 8 : 6
        // the stacks it has at the release (the sheet's declensionStacks; Conviction at 4, C6)
        ctx.hit(hitAt, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          snapshotDelay: hitAt - 2,
          label: `Heartstopper Strike, ${stacksAt} stacks`,
          states: [
            {
              owner: 'ShikanoinHeizou',
              path: ['ShikanoinHeizou', 'declensionStacks'],
              value: stacksAt ? `${stacksAt}` : '',
            },
          ],
        })
        ctx.hit(hitAt, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: hitlag,
          label: 'Heartstopper Strike hitlag',
        })
        s.stacks = 0
        // A4: the other members' Elemental Mastery +80 for 10 s (a sheet conditional)
        ctx.buff(
          'ShikanoinHeizou',
          ['ShikanoinHeizou', 'skillHit'],
          'on',
          hitAt,
          600
        )
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 600, delay: 18 + release },
            frames: release + 39,
            framesInto: {
              normal: release + 39,
              charged: release + 39,
              skill: release + 39,
              burst: release + 39,
              dash: release + 30,
              jump: release + 30,
              swap: release + 30,
            },
          },
          { hitmarks: [hitAt], hitlag: [hitlag] }
        )
      }
      case 'burst': {
        ctx.hit(34, {
          path: ['burst', 'slugger_dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'Fudou Style Vacuum Slugger',
        })
        // Windmuster Iris: the Slugger's aura check finds a Pyro / Hydro / Electro / Cryo aura
        // left after the Slugger's own Swirl (gcsim runs the check's callback after it): that
        // element's Iris explodes 40 frames later
        ctx.at(34, (c) => {
          const ele = c.absorb(irisEles)
          if (!ele || !irisEles.includes(ele)) return
          c.hit(40, {
            path: ['burst', `${ele}_iris_dmg`],
            tag: 'burst',
            element: ele,
            applies: true,
            icd: 'none',
            label: 'Windmuster Iris',
          })
        })
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 72,
          framesInto: { normal: 71, skill: 71, jump: 70, swap: 69 },
        }
      }
      case 'plunge':
        ctx.note(
          "Heizou: a plunge needs the team airborne (Xianyun's burst), assumed; modelled as a High Plunge."
        )
        // (gcsim's optional collision hit, a plunge parameter, is not modelled)
        ctx.hit(47, {
          path: ['plunging', 'high'],
          tag: 'plunge',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'High Plunge',
        })
        return {
          frames: 78,
          framesInto: { normal: 69, skill: 70, burst: 69, dash: 47, swap: 62 },
        }
      case 'dash':
        // Boy body: a 21-frame dash, which can jump after 2 frames
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // Boy body: 31 frames, 34 after a dash
        return templateJump('boy', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onPartySwap(ctx, s: HeizouState, _from, to) {
    // C1: taking the field gives +15% Normal Attack SPD for 5 s and a Declension stack (10 s ICD)
    if (
      to !== 'ShikanoinHeizou' ||
      ctx.constellation('ShikanoinHeizou') < 1 ||
      ctx.now < s.c1Ready
    )
      return
    s.c1Ready = ctx.now + 600
    addStack(s)
    ctx.modifyAttackSpeed('HeizouC1', 0.15, 300, 'ShikanoinHeizou')
  },
  onHit(ctx, s: HeizouState, hit) {
    // A1: a Swirl (or Stellar Swirl) Heizou triggers while on the field: a Declension stack
    // (0.1 s ICD)
    if (
      hit.path[0] !== '_reaction' ||
      hit.characterKey !== 'ShikanoinHeizou' ||
      ctx.onField !== 'ShikanoinHeizou' ||
      !/Swirl$/.test(hit.path[1]) ||
      ctx.now < s.a1Ready
    )
      return
    s.a1Ready = ctx.now + 7
    addStack(s)
  },
}
