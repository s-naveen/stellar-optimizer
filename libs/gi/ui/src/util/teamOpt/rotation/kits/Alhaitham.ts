import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/alhaitham, main as of 2026-11-10. */

const alhaithamNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 15,
    toCharged: 23,
    toAbil: 11,
    frames: 29,
  },
  {
    hitmarks: [13],
    hitlag: [5],
    toNormal: 22,
    toCharged: 25,
    toAbil: 13,
    frames: 31,
  },
  {
    hitmarks: [15, 29],
    hitlag: [0, 5],
    toNormal: 44,
    toCharged: 45,
    toAbil: 29,
    frames: 55,
  },
  {
    hitmarks: [21],
    hitlag: [0],
    toNormal: 30,
    toCharged: 37,
    toAbil: 21,
    frames: 51,
  },
  {
    hitmarks: [35],
    hitlag: [5],
    toNormal: 67,
    toCharged: 90,
    toAbil: 35,
    frames: 90,
  },
]

/**
 * Projection Attack hitmarks, by the mirrors it is cast with. gcsim uses the 1-Mirror multiplier
 * for every projection hit (so our `mirrorDmg1` node is right for all of them); the 1- and 2-mirror
 * hitmarks differ by side (50/50), so the rounded average is used
 */
const projectionHitmarks: number[][] = [[], [40], [27, 36], [32, 41, 51]]

/**
 * A Chisel-Light Mirror is lost every 4 s while any are left: the skill's "Chisel-Light Mirror
 * Removal Interval" (gcsim measures 233 frames)
 */
const MIRROR_INTERVAL = 240
/** gcsim's snapshot of a Projection Attack, by the mirrors it is cast with */
const projectionSnapshot = [0, 20, 22, 26]
/** The Skill's hit pauses him (0.04 s halt and the defense halt) */
const SKILL_HITLAG = 6

interface AlhaithamState {
  /** Chisel-Light Mirrors, as of the last `settle` */
  mirrors: number
  /** Frame of the next mirror loss (restarted when mirrors are made from none, or overflow) */
  nextLoss: number
  /** A1's 12 s cooldown ends (frame) */
  a1Until: number
  /** The Projection Attack ICD (1.6 s) ends (frame) */
  projectionUntil: number
  /** C6: the Excess Mirror buff ends (frame) */
  c6Until: number
  /** C1: the cooldown reduction's 1 s ICD ends (frame) */
  c1Until: number
  /** C4: the last burst's consumed mirrors (its conditional's state) */
  c4Consumed: string
  /** C4: his clock when the last burst's mirrors were made (its Dendro DMG starts there) */
  c4GainClock: number
}

/** Brings the mirror count to frame `t` (the losses that happened by then) */
function settle(s: AlhaithamState, t: number) {
  if (s.mirrors <= 0 || t < s.nextLoss) return
  const losses = Math.floor((t - s.nextLoss) / MIRROR_INTERVAL) + 1
  s.mirrors = Math.max(0, s.mirrors - losses)
  s.nextLoss += losses * MIRROR_INTERVAL
}

/** C6: an excess mirror adds 6 s to the Excess Mirror buff (or starts it) */
function extendExcessMirror(c: SimContext, s: AlhaithamState) {
  if (c.now < s.c6Until) {
    c.buff(
      'Alhaitham',
      ['Alhaitham', 'excessMirror'],
      'on',
      s.c6Until - c.now,
      360
    )
    s.c6Until += 360
  } else {
    c.buff('Alhaitham', ['Alhaitham', 'excessMirror'], 'on', 0, 360)
    s.c6Until = c.now + 360
  }
}

/** Chisel-Light Mirrors made at `c.now` (C2 stacks for each one, even past the cap; C6 for the excess) */
function gainMirrors(c: SimContext, s: AlhaithamState, generated: number) {
  if (generated <= 0) return
  settle(s, c.now)
  if (s.mirrors === 0) s.nextLoss = c.now + MIRROR_INTERVAL
  s.mirrors += generated
  const cons = c.constellation('Alhaitham')
  if (cons >= 2)
    for (let i = 0; i < generated; i++)
      c.buff('Alhaitham', ['Alhaitham', 'debateStacks'], '1', 0, 480, {
        max: 4,
        hitlag: 'recipient',
      })
  if (s.mirrors > 3) {
    const excess = s.mirrors - 3
    if (cons >= 6) for (let i = 0; i < excess; i++) extendExcessMirror(c, s)
    s.mirrors = 3
    // an overflow restarts the loss clock
    s.nextLoss = c.now + MIRROR_INTERVAL
  }
}

export const kit: KitModel = {
  characterKey: 'Alhaitham',
  element: 'dendro',
  source: `${GCSIM}/alhaitham`,
  init: (): AlhaithamState => ({
    mirrors: 0,
    nextLoss: 0,
    a1Until: -1,
    projectionUntil: -1,
    c6Until: -1,
    c1Until: -1,
    c4Consumed: '',
    c4GainClock: Number.NEGATIVE_INFINITY,
  }),
  act(ctx, s: AlhaithamState, action, previous) {
    const c = ctx.constellation('Alhaitham')
    switch (action.kind) {
      case 'normal':
        // (Dendro while he has mirrors when the hit lands: see onBeforeHit)
        return normalString(
          alhaithamNormals,
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
      case 'charged': {
        // (A1's mirror from the 1st hit is made before the 2nd hit lands, so the 2nd is Dendro)
        ;[19, 27].forEach((d, j) =>
          ctx.hit(d, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'Alhatham_ExtraAttack',
            icdGroup: 'AlhaithamExtraAttack',
            label: `Charged Attack ${j + 1}`,
          })
        )
        return {
          frames: 64,
          framesInto: {
            normal: 50,
            skill: 50,
            burst: 50,
            dash: 27,
            jump: 27,
            swap: 48,
          },
        }
      }
      case 'skill': {
        const hold = !!action.hold
        // the mirror gain, 15 (tap) / 23 (hold) frames in: 2 with none, else 1
        ctx.at(hold ? 23 : 15, (c2) => {
          settle(s, c2.now)
          gainMirrors(c2, s, s.mirrors === 0 ? 2 : 1)
        })
        const hitmark = hold ? 28 : 19
        ctx.hit(hitmark, {
          path: ['skill', 'rushDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: hold
            ? 'Universality: An Elaboration on Form (hold)'
            : 'Universality: An Elaboration on Form',
        })
        ctx.hit(hitmark, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: SKILL_HITLAG,
          label: 'Alhaitham skill hitlag',
        })
        const cooldown = { key: 'skill', frames: 1080, delay: hold ? 23 : 15 }
        return withHitlag(
          hold
            ? {
                cooldown,
                frames: 87,
                framesInto: { normal: 86, plunge: 35, skill: 80, swap: 85 },
              }
            : {
                cooldown,
                frames: 44,
                framesInto: {
                  normal: 27,
                  skill: 28,
                  burst: 28,
                  dash: 33,
                  jump: 33,
                  swap: 36,
                },
              },
          { hitmarks: [hitmark], hitlag: [SKILL_HITLAG] }
        )
      }
      case 'burst': {
        settle(s, ctx.now)
        const consumed = s.mirrors
        // 4 + 2 per mirror consumed, 21 frames apart from frame 94
        for (let i = 0; i < 4 + 2 * consumed; i++)
          ctx.hit(94 + 21 * i, {
            path: ['burst', 'instanceDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'burst',
            label: `Particular Field: Fetters of Phenomena (${i + 1})`,
          })
        // C4: the consumed mirrors are the others' EM buff, 15 s from the cast; the Dendro DMG from
        // the new ones is on the same conditional but runs 15 s from when they are made (184
        // frames in, if he is still on the field): his own hits read it from onBeforeHit
        if (c >= 4) {
          ctx.buff(
            'Alhaitham',
            ['Alhaitham', 'mirrorsConsumed'],
            `${consumed}`,
            0,
            900,
            { hitlag: 'recipient' }
          )
          s.c4Consumed = `${consumed}`
          s.c4GainClock = Number.NEGATIVE_INFINITY
        }
        // all consumed now; 3 - consumed (3 at C6) made 184 frames later if still on the field
        const generated = c >= 6 ? 3 : 3 - consumed
        s.mirrors = 0
        ctx.atCharacter('Alhaitham', 184, (c2) => {
          if (c2.onField !== 'Alhaitham') return
          gainMirrors(c2, s, generated)
          if (c >= 4) s.c4GainClock = c2.characterFrame('Alhaitham')
        })
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 91,
          framesInto: { normal: 88, skill: 89, dash: 89, swap: 87 },
        }
      }
      case 'plunge': {
        // after a hold Skill it is Universality's low plunge (always Dendro); otherwise a low plunge
        // out of a jump, Dendro while infused
        const afterHold = previous?.kind === 'skill' && !!previous.hold
        const d = afterHold ? 38 : 46
        ctx.hit(d, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: afterHold ? 'dendro' : 'physical',
          ...(afterHold
            ? {
                states: [
                  {
                    owner: 'Alhaitham' as const,
                    path: ['Alhaitham', 'withMirrors'],
                    value: 'on',
                  },
                ],
              }
            : {}),
          applies: true,
          icd: 'none',
          label: afterHold ? 'Low Plunge (after hold Skill)' : 'Low Plunge',
        })
        return {
          frames: 70,
          framesInto: { normal: 49, skill: 50, burst: 50, dash: 40, swap: 58 },
        }
      }
      case 'dash':
        // (no dash of its own in gcsim: the default, for a body type not known here)
        return { frames: 20, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('male', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onBeforeHit(ctx, s: AlhaithamState, hit) {
    if (hit.characterKey !== 'Alhaitham' || hit.path[0].startsWith('_')) return
    // the infusion: his Physical Normal, Charged and Plunging Attacks are Dendro while he has
    // mirrors when they land (gcsim snapshots them at the hitmark)
    if (
      hit.element === 'physical' &&
      (hit.tag === 'normal' || hit.tag === 'charged' || hit.tag === 'plunge')
    ) {
      settle(s, ctx.now)
      const dendro = s.mirrors > 0
      if (dendro) hit.element = 'dendro'
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'Alhaitham',
          path: ['Alhaitham', 'withMirrors'],
          value: dendro ? 'on' : '',
        },
      ]
    }
    if (ctx.constellation('Alhaitham') < 4 || !s.c4Consumed) return
    // C4's Dendro DMG (the EM part of the conditional is for the others)
    const clock = ctx.characterFrame('Alhaitham')
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Alhaitham',
        path: ['Alhaitham', 'mirrorsConsumed'],
        value:
          clock >= s.c4GainClock && clock < s.c4GainClock + 900
            ? s.c4Consumed
            : '',
      },
    ]
  },
  onHit(ctx, s: AlhaithamState, hit) {
    if (hit.characterKey !== 'Alhaitham') return
    // C1: a Projection Attack hit cuts the Skill's cooldown by 1.2 s, once per 1 s (gcsim's status
    // ICD: still active on its expiry frame)
    if (
      hit.path[1] === 'mirrorDmg1' &&
      ctx.constellation('Alhaitham') >= 1 &&
      ctx.now >= s.c1Until
    ) {
      s.c1Until = ctx.now + 61
      ctx.reduceCooldown('skill', 72)
    }
    if (hit.tag !== 'normal' && hit.tag !== 'charged' && hit.tag !== 'plunge')
      return
    // A1: a Charged or Plunging Attack hit makes a mirror, once per 12 s (before its projections)
    if (hit.tag !== 'normal' && hit.t >= s.a1Until) {
      s.a1Until = hit.t + 720
      gainMirrors(ctx, s, 1)
    }
    // Projection Attacks: a Normal, Charged or Plunging Attack hit with mirrors, while Alhaitham is
    // on the field and off the 1.6 s ICD; one per mirror
    settle(s, hit.t)
    if (hit.onField !== 'Alhaitham' || s.mirrors === 0) return
    if (hit.t < s.projectionUntil) return
    // (1.6 s ICD: gcsim's status, still active on its expiry frame)
    s.projectionUntil = hit.t + 97
    const n = Math.min(3, s.mirrors)
    projectionHitmarks[n].forEach((d, i) =>
      ctx.hit(d, {
        characterKey: 'Alhaitham',
        path: ['skill', 'mirrorDmg1'],
        tag: 'skill',
        element: 'dendro',
        applies: true,
        icd: 'Alhatham_ForlornLotus',
        icdGroup: 'AlhaithamProjectionAttack',
        snapshotDelay: projectionSnapshot[n],
        label: `Projection Attack (${n}-Mirror, hit ${i + 1})`,
      })
    )
  },
  onSwapOut(_ctx, s: AlhaithamState) {
    s.mirrors = 0
  },
}
