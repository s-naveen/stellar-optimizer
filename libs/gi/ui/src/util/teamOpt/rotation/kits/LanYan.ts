import type { HitElement, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/lanyan, main as of 2026-11-10. */

const lanyanNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 20,
    toCharged: 21,
    toAbil: 11,
    frames: 30,
  },
  {
    hitmarks: [17, 37],
    hitlag: [6, 4],
    worldTimeHits: true,
    toNormal: 46,
    toCharged: 30,
    toAbil: 37,
    frames: 46,
  },
  {
    hitmarks: [15, 21],
    hitlag: [2, 0],
    worldTimeHits: true,
    toNormal: 53,
    toCharged: 37,
    toAbil: 21,
    frames: 53,
  },
  {
    hitmarks: [40],
    hitlag: [8],
    toNormal: 63,
    toCharged: 50,
    toAbil: 40,
    frames: 63,
  },
]

/** Our sheet's node for each hit of each string step (N2 is 2.1 and 2.2, N3 is 3.1 and 3.2) */
const lanyanNodes = [[0], [1, 2], [3, 4], [5]]

/** gcsim's N2 CanQueueAfter (a written wait starts there, before its 2nd hit's 37) */
const n2QueueAfter = 30

/** Swallow-Wisp Pinion Dance: the Detect hits at 7 frames; the leap back lasts 66 frames */
const detectHitmark = 7
const leapFrames = 66
/**
 * The skill's cancels (gcsim's skillHitFrames while Leap Back is up, skillMissFrames after it):
 * N1 / E at 33 are Feathermoon Rings; everything else is only possible once the leap has ended
 * (frame 74 of the action, where the miss frames already allow it).
 */
const leapEndCancel = detectHitmark + leapFrames + 1

/** Feathermoon Rings hit at these frames; C1's extra ring at its own */
const ringHitmarks = [38, 62, 85]
const c1RingHitmarks = [38, 64, 90]

type AbsorbEle = 'pyro' | 'hydro' | 'electro' | 'cryo'
const absorbEles: readonly HitElement[] = ['pyro', 'hydro', 'electro', 'cryo']

interface LanYanState {
  /** Leap Back is up until this frame (a skill or normal attack press then is Feathermoon Rings) */
  leapEnd?: number
  /** For the cooldown check: a Leap Back is up (rings have no cooldown) */
  leapOn: boolean
  leapGen: number
  /** A1: the element the Detect absorbed (Swallow-Wisp Shield's Elemental Absorption) */
  absorbed?: AbsorbEle
}

/**
 * Feathermoon Rings (gcsim's reathermoonRings): three Anemo rings and, when the Detect absorbed an
 * element (A1), a 50% ring of that element with each (their own ICD). C1: with an absorbed element
 * another set of rings is thrown. Each ring hit pauses Lan Yan by the default defense halt (3.6).
 */
function feathermoonRings(ctx: SimContext, s: LanYanState) {
  s.leapEnd = undefined
  s.leapOn = false
  s.leapGen++
  const ele = s.absorbed
  const throwRings = (hitmarks: number[], label: string) => {
    for (const hitmark of hitmarks) {
      ctx.hit(hitmark, {
        path: ['skill', 'ringDmg'],
        tag: 'skill',
        element: 'anemo',
        applies: true,
        durability: 25,
        icd: 'LanyanRingAttack',
        label,
      })
      if (ele)
        ctx.hit(hitmark, {
          path: ['passive1', ele],
          tag: 'skill',
          element: ele,
          applies: true,
          durability: 25,
          icd: 'LanyanRingAttackMix',
          label: `${label} (${ele}, A1)`,
        })
      ctx.hit(hitmark, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 4,
        label: 'Feathermoon Ring hitlag',
      })
    }
  }
  throwRings(ringHitmarks, 'Feathermoon Ring')
  if (ele && ctx.constellation('LanYan') >= 1)
    throwRings(c1RingHitmarks, 'Feathermoon Ring (C1)')
  return {
    frames: 41,
    framesInto: { normal: 37, burst: 39, dash: 38, jump: 39, wait: 37 },
  }
}

export const kit: KitModel = {
  characterKey: 'LanYan',
  element: 'anemo',
  source: `${GCSIM}/lanyan`,
  init: (): LanYanState => ({ leapOn: false, leapGen: 0 }),
  // C6: Swallow-Wisp Pinion Dance gains 1 additional charge
  charges: (cons) => ({ skill: cons >= 6 ? 2 : 1 }),
  // In mid-air after her E (the Leap Back), Normal Attack or E hurls the Feathermoon Rings (their own
  // frames)
  variant(ctx, s: LanYanState, action) {
    return (action.kind === 'normal' || action.kind === 'skill') &&
      s.leapEnd !== undefined &&
      ctx.now < s.leapEnd
      ? {
          key: 'rings',
          label: 'Feathermoon Rings',
          mode: 'Swallow-Wisp Pinion Dance',
        }
      : undefined
  },
  act(ctx, s: LanYanState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // During the Leap Back a Normal Attack press throws the Feathermoon Rings instead
        if (s.leapEnd !== undefined && ctx.now < s.leapEnd)
          return feathermoonRings(ctx, s)
        const result = normalString(
          lanyanNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${lanyanNodes[i][j]}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              durability: 25,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
        // A written wait after N2 starts at its CanQueueAfter (30), not its 2nd hit
        const last = result.normalStarts?.at(-1)
        if (last?.index === 1 && result.framesInto)
          result.framesInto.wait =
            last.offset +
            withHitlag(
              { frames: n2QueueAfter, framesInto: { wait: n2QueueAfter } },
              lanyanNormals[1]
            ).framesInto!.wait!
        return result
      }
      case 'charged':
        for (const hitmark of [42, 49, 56])
          ctx.hit(hitmark, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'anemo',
            applies: true,
            durability: 25,
            icd: 'ExtraAttack',
            label: 'Charged Attack',
          })
        return {
          frames: 70,
          framesInto: { normal: 41, skill: 44, burst: 44, dash: 59, swap: 45 },
        }
      case 'skill': {
        // (The Swallow-Wisp Shield is not damage: not modelled, nor C2's shield restore.)
        // Pressed again during the Leap Back: Feathermoon Rings (no cooldown)
        if (s.leapEnd !== undefined && ctx.now < s.leapEnd)
          return feathermoonRings(ctx, s)
        // The Detect is assumed to hit an enemy (the leap back). A hold only aims the dash.
        const gen = ++s.leapGen
        s.leapEnd = ctx.now + detectHitmark + leapFrames
        s.leapOn = true
        s.absorbed = undefined
        ctx.at(detectHitmark, (c) => {
          // A1: the Detect's hit absorbs Pyro > Hydro > Electro > Cryo from the enemy
          const ele = c.absorb(absorbEles)
          if (s.leapGen === gen && ele) s.absorbed = ele as AbsorbEle
        })
        ctx.at(detectHitmark + leapFrames, () => {
          if (s.leapGen === gen) s.leapOn = false
        })
        return {
          cooldown: { key: 'skill', frames: 960, delay: 4 },
          frames: leapEndCancel,
          framesInto: {
            normal: 33,
            skill: 33,
            charged: leapEndCancel,
            burst: leapEndCancel,
            dash: leapEndCancel,
            jump: leapEndCancel,
            swap: leapEndCancel,
            // gcsim's CanQueueAfter: the Detect's hitmark
            wait: detectHitmark,
          },
        }
      }
      case 'burst': {
        for (const hitmark of [30, 46, 51])
          ctx.hit(hitmark, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            durability: 50,
            icd: 'burst',
            label: 'Lustrous Moonrise',
          })
        // C4: party Elemental Mastery for 12 s
        if (ctx.constellation('LanYan') >= 4)
          ctx.buff('LanYan', ['LanYan', 'c4AfterBurst'], 'on', 0, 12 * 60)
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 100,
          framesInto: { normal: 75, skill: 75, dash: 72, swap: 75 },
        }
      }
      case 'plunge':
        // Low Plunge (P: the rotation does not give the height)
        ctx.hit(44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'anemo',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 67,
          framesInto: { normal: 56, skill: 56, burst: 57, dash: 44, swap: 53 },
        }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength)
        return templateJump('girl', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: LanYanState, action) =>
    action.kind === 'skill'
      ? s.leapOn
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
}
