import type { KitModel, SimContext, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/collei, main as of 2026-11-10. */

/** Arrows travel 10f (gcsim's default `travel`) before they hit */
const TRAVEL = 10

/** Hitmarks include the travel; the cancels are gcsim's (from the hitmark, not the hit) */
const colleiNormals: NormalHit[] = [
  {
    hitmarks: [16 + TRAVEL],
    toNormal: 24,
    toCharged: 16,
    toAbil: 16,
    frames: 24,
  },
  {
    hitmarks: [14 + TRAVEL],
    toNormal: 25,
    toCharged: 14,
    toAbil: 14,
    frames: 25,
  },
  {
    hitmarks: [22 + TRAVEL],
    toNormal: 43,
    toCharged: 22,
    toAbil: 22,
    frames: 43,
  },
  {
    hitmarks: [32 + TRAVEL],
    toNormal: 65,
    toCharged: 32,
    toAbil: 32,
    frames: 65,
  },
]

/** The Dendro reactions Floral Sidewinder (A1, C2) and The Languid Wood (A4) watch for */
const DENDRO_MARKS = [
  'burning',
  'quicken',
  'aggravate',
  'spread',
  'bloom',
  'lunarBloom',
]
/** Hyperbloom and Burgeon have no marker: their damage hits stand in (gcsim's events) */
const DENDRO_HITS = ['hyperbloom', 'burgeon']
const isDendroReaction = (hit: SimHit) =>
  (hit.path[0] === '_reaction' && DENDRO_MARKS.includes(hit.path[1])) ||
  (hit.path[0] === 'reaction' && DENDRO_HITS.includes(hit.path[1]))

/** Floral Brush: the ring is out from 20 frames (its release) until it returns at 157 */
const RING_OUT = 20
const RING_RETURN = 157
/** Sprout: 3 s from the return (C2: 3 s more, once); a tick 86 frames in, then every 89 */
const SPROUT = 180
const SPROUT_FIRST = 86
const SPROUT_PERIOD = 89

interface ColleiState {
  /** Trump-Card Kitty lasts until this frame */
  burstEnd: number
  extensions: number
  /** The current Floral Brush: its cast frame, while its ring is out or its Sprout lasts */
  brush: number
  /** A Dendro reaction happened while the ring was out (A1) / for C2's extension */
  sproutProc: boolean
  sproutExtend: boolean
  /** The Sprout ends at this frame of Collei's clock (undefined: none) */
  sproutEnd?: number
}

/** The Sprout's ticks from its start (the ring's return) while it lasts */
function sproutTicks(ctx: SimContext, s: ColleiState, brush: number) {
  const snapshot = { t: ctx.now, onField: ctx.onField }
  const tick = (c: SimContext) => {
    if (s.brush !== brush || s.sproutEnd === undefined) return
    if (c.characterFrame('Collei') > s.sproutEnd) return
    c.hit(0, {
      path: ['passive1', 'dmg'],
      tag: 'skill',
      element: 'dendro',
      applies: true,
      icd: 'ColleiSprout',
      label: 'Floral Sidewinder (Sprout)',
      statSnapshots: [
        { stat: 'atk', path: ['total', 'atk'], ...snapshot },
        { stat: 'dendro_dmg_', path: ['total', 'dendro_dmg_'], ...snapshot },
      ],
    })
    c.at(SPROUT_PERIOD, tick)
  }
  ctx.atCharacter('Collei', SPROUT_FIRST, tick)
}

export const kit: KitModel = {
  characterKey: 'Collei',
  element: 'dendro',
  source: `${GCSIM}/collei`,
  init: (): ColleiState => ({
    burstEnd: -1,
    extensions: 0,
    brush: -1,
    sproutProc: false,
    sproutExtend: false,
  }),
  act(ctx, s: ColleiState, action, previous) {
    const c = ctx.constellation('Collei')
    switch (action.kind) {
      case 'normal':
        return normalString(
          colleiNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // The Fully-Charged Aimed Shot (gcsim's default hold): hitmark 86f + travel
        ctx.hit(86 + TRAVEL, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return {
          frames: 96,
          framesInto: { dash: 86, jump: 86 },
        }
      case 'skill': {
        // Floral Brush: snapshot at its release (20f), hits at 34f (press) and 138f (the ring returns)
        for (const [t, label] of [
          [34, 'Floral Brush'],
          [138, 'Floral Brush (return)'],
        ] as const)
          ctx.hit(t, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'dendro',
            applies: true,
            icd: 'none',
            snapshotDelay: RING_OUT,
            label,
          })
        // A1: a party Dendro reaction while the ring is out gives the Sprout at its return (C2:
        // always, and one such reaction from the cast until the Sprout ends extends it by 3 s)
        const brush = ctx.now
        s.brush = brush
        s.sproutEnd = undefined
        s.sproutProc = c >= 2
        s.sproutExtend = false
        ctx.at(RING_RETURN, (c2) => {
          if (s.brush !== brush || !s.sproutProc) return
          s.sproutEnd =
            c2.characterFrame('Collei') + SPROUT + (s.sproutExtend ? SPROUT : 0)
          sproutTicks(c2, s, brush)
        })
        // C6: the first Floral Brush hit that lands also calls Forest of Falling Arrows, 22f later
        if (c >= 6)
          ctx.hit(34 + 22, {
            path: ['constellation6', 'dmg'],
            tag: 'other',
            element: 'dendro',
            applies: true,
            icd: 'none',
            label: 'Forest of Falling Arrows (C6)',
          })
        return {
          cooldown: { key: 'skill', frames: 720, delay: 20 },
          frames: 68,
          framesInto: {
            normal: 65,
            charged: 65,
            skill: 67,
            dash: 54,
            jump: 53,
            swap: 66,
          },
        }
      }
      case 'burst': {
        // Trump-Card Kitty: the explosion at 25f, then a leap every 30f from 68f (12 while it lasts)
        ctx.hit(25, {
          path: ['burst', 'explosionDmg'],
          tag: 'burst',
          element: 'dendro',
          applies: true,
          icd: 'Collei_Elemental_Burst',
          icdGroup: 'ColleiBurst',
          label: 'Trump-Card Kitty (Explosion)',
        })
        // the Zone: 378 frames from the explosion (gcsim's status: still on at its expiry frame);
        // the leaps keep the stats of that moment
        s.burstEnd = ctx.now + 25 + 378 + 1
        s.extensions = 0
        const snapshot = { t: ctx.now + 25, onField: ctx.onField }
        const tick = (c2: SimContext) => {
          if (c2.now >= s.burstEnd) return
          c2.hit(0, {
            path: ['burst', 'leapDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'Collei_Elemental_Burst',
            icdGroup: 'ColleiBurst',
            label: 'Trump-Card Kitty (Leap)',
            statSnapshots: [
              { stat: 'atk', path: ['total', 'atk'], ...snapshot },
              {
                stat: 'dendro_dmg_',
                path: ['total', 'dendro_dmg_'],
                ...snapshot,
              },
            ],
          })
          c2.at(30, tick)
        }
        ctx.at(68, tick)
        // C4: the others' EM for 12 s after the burst (the sheet's afterBurst condition)
        if (c >= 4)
          ctx.buff('Collei', ['Collei', 'afterBurst'], 'on', 0, 720, {
            hitlag: 'recipient',
          })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 67,
          framesInto: { normal: 65, charged: 65, swap: 66 },
        }
      }
      case 'plunge':
        // gcsim has no plunging attack for Collei
        ctx.note('Collei: plunging attacks are not in gcsim; not modelled.')
        return { frames: 30 }
      case 'dash':
        // template dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Girl body): 34f after a dash, 31f otherwise
        return templateJump('girl', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: ColleiState, hit) {
    if (!isDendroReaction(hit)) return
    // A1 (and C2): a Dendro reaction while the ring is out arms the Sprout; C2's extension, once,
    // from the cast until the Sprout ends
    const ringOut =
      ctx.now >= s.brush + RING_OUT && ctx.now < s.brush + RING_RETURN
    if (ringOut) s.sproutProc = true
    if (ctx.constellation('Collei') >= 2 && !s.sproutExtend) {
      const sproutOn =
        s.sproutEnd !== undefined && ctx.characterFrame('Collei') <= s.sproutEnd
      if (ringOut || sproutOn) {
        s.sproutExtend = true
        if (sproutOn) s.sproutEnd! += SPROUT
      }
    }
    // A4: the active member's Dendro reaction in the Zone adds 1 s to it, up to 3 times
    if (
      hit.characterKey === hit.onField &&
      ctx.now < s.burstEnd &&
      s.extensions < 3
    ) {
      s.burstEnd += 60
      s.extensions++
    }
  },
}
