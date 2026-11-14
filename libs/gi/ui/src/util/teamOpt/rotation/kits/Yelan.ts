import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  type NormalWatcher,
  newNormalWatcher,
  normalString,
  templateJump,
  watchAction,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yelan, main as of 2026-11-10. */

/** Normal attacks and aimed shots: gcsim's default travel time (frames after the hitmark) */
const TRAVEL = 10

/** Normal attack string (N1..N4; N4 has two hits): hitmarks and cancels (the aimed shot's too) */
const yelanNormals: NormalHit[] = [
  {
    hitmarks: [13 + TRAVEL],
    toNormal: 15,
    toCharged: 13,
    toAbil: 13,
    frames: 15,
  },
  {
    hitmarks: [13 + TRAVEL],
    toNormal: 21,
    toCharged: 13,
    toAbil: 13,
    frames: 21,
  },
  {
    hitmarks: [18 + TRAVEL],
    toNormal: 38,
    toCharged: 18,
    toAbil: 18,
    frames: 38,
  },
  {
    hitmarks: [15 + TRAVEL, 29 + TRAVEL],
    toNormal: 67,
    toCharged: 29,
    toAbil: 29,
    frames: 67,
  },
]

/** The sheet's normal node of each hit (the sheet has one node for N4's two hits) */
const normalNodes = [['0'], ['1'], ['2'], ['3', '3']]

/** Breakthrough's chance from each Lingering Lifeline hit (gcsim's 34%) */
const BREAKTHROUGH_CHANCE = 0.34

interface YelanState {
  /**
   * The chance Breakthrough is up (it starts up; the Lingering Lifeline gives it; a Fully-Charged
   * Aimed Shot uses it). The Breakthrough Barb and the shot are weighted by it, not picked.
   */
  breakthrough: number
  /** Depth-Clarion Dice (burst) is up until this frame */
  burstEnd: number
  /** C6: barb arrows shot in the 20 s after the burst (5 at most), and the C6 window's end */
  c6Count: number
  c6End: number
  /** C2: the next Exquisite Throw (C2) hit may land from this frame (1.8 s ICD) */
  c2Ready: number
  /** The burst's trigger: the active character's normal attacks (60-frame ICD, 1 s ticks) */
  watch: NormalWatcher
  /** C4: enemies marked while its 25 s status lasts (one per cast: a single target), and its end */
  c4Count: number
  c4Until: number
}

/** An Exquisite Throw wave: three hits (20, 26 and 32 frames in), and C2's extra hit */
function throwWave(c: SimContext, s: YelanState) {
  for (const delay of [20, 26, 32])
    c.hit(delay, {
      characterKey: 'Yelan',
      path: ['burst', 'throwDmg'],
      tag: 'burst',
      element: 'hydro',
      applies: true,
      durability: 25,
      icd: 'YelanBurst',
      // (gcsim: stats at the proc)
      snapshotDelay: 0,
      label: 'Exquisite Throw',
    })
  if (c.constellation('Yelan') >= 2 && c.now >= s.c2Ready) {
    s.c2Ready = c.now + 108
    // (C2's hit is put at the first throw's frame: gcsim's timing for it is a TODO there)
    c.hit(20, {
      characterKey: 'Yelan',
      path: ['constellation2', 'arrowDmg'],
      tag: 'burst',
      element: 'hydro',
      applies: true,
      icd: 'none',
      // (gcsim: stats at the proc)
      snapshotDelay: 0,
      label: 'Exquisite Throw (C2)',
    })
  }
}

export const kit: KitModel = {
  characterKey: 'Yelan',
  element: 'hydro',
  source: `${GCSIM}/yelan`,
  init: (): YelanState => ({
    breakthrough: 1,
    burstEnd: -1,
    c6Count: 0,
    c6End: -1,
    c2Ready: -1,
    watch: newNormalWatcher(),
    c4Count: 0,
    c4Until: -1,
  }),
  // C1: Lingering Lifeline gains a second charge
  charges: (cons) => ({ skill: cons >= 1 ? 2 : 1 }),
  // Exquisite Throw: on the active character's normal attacks (gcsim's watcher, kits/common.ts)
  onPartyAction(ctx, s: YelanState, actor, action, frames, normalStarts) {
    watchAction(
      ctx,
      s.watch,
      action,
      frames,
      {
        delay: ctx.normalAnimationDelay(actor, 'yelan'),
        clock: 'Yelan',
        active: (c) => c.now < s.burstEnd,
        fire: (c) => throwWave(c, s),
        icd: 60,
      },
      normalStarts
    )
  },
  act(ctx, s: YelanState, action, previous) {
    const cons = ctx.constellation('Yelan')
    switch (action.kind) {
      case 'normal': {
        // C6: each normal attack (string step) is barb arrows while the window lasts and fewer than
        // 5 were shot (gcsim decides per attack; N4's two arrows both count)
        let barbs = false
        const result = normalString(
          yelanNormals,
          action.count ?? 1,
          (i, d, j) => {
            if (j === 0) barbs = cons >= 6 && ctx.now < s.c6End && s.c6Count < 5
            if (barbs) {
              s.c6Count++
              if (s.c6Count >= 5) s.c6End = ctx.now
              ctx.hit(d, {
                path: ['constellation6', 'barbDmg'],
                tag: 'charged',
                element: 'hydro',
                applies: true,
                icd: 'ExtraAttack',
                label: `C6 Barb (N${i + 1})`,
              })
              return
            }
            ctx.hit(d, {
              path: ['normal', normalNodes[i][j]],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            })
          },
          ctx
        )
        return result
      }
      case 'charged': {
        // the Breakthrough Barb (if Breakthrough is up) or the Fully-Charged Aimed Shot
        const p = s.breakthrough
        if (p > 0)
          ctx.hit(32 + TRAVEL, {
            path: ['charged', 'barb'],
            tag: 'charged',
            element: 'hydro',
            applies: true,
            durability: 25,
            icd: 'YelanBreakthrough',
            weight: p,
            label: 'Breakthrough Barb',
          })
        if (p < 1)
          ctx.hit(86 + TRAVEL, {
            path: ['charged', 'aimedCharged'],
            tag: 'charged',
            element: 'hydro',
            applies: true,
            icd: 'none',
            weight: 1 - p,
            label: 'Fully-Charged Aimed Shot',
          })
        s.breakthrough = 0
        // (the action's length, expected over the two)
        const dj = Math.round(p * 32 + (1 - p) * 86)
        return {
          frames: Math.round(p * 42 + (1 - p) * 96),
          framesInto: { dash: dj, jump: dj },
        }
      }
      case 'skill': {
        ctx.hit(36, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Lingering Lifeline',
        })
        // the hit gives Breakthrough with 34%; during the burst it also throws a wave
        ctx.at(36, (c2) => {
          s.breakthrough += (1 - s.breakthrough) * BREAKTHROUGH_CHANCE
          if (c2.now < s.burstEnd) throwWave(c2, s)
        })
        // C4: the party's Max HP +10% per marked enemy for 25 s (40% max): a single target is
        // marked per cast; the count builds while the status lasts (gcsim resets it at a cast
        // after the status ended)
        if (cons >= 4) {
          if (ctx.now > s.c4Until) s.c4Count = 0
          ctx.at(35, (c2) => {
            s.c4Count = Math.min(4, s.c4Count + 1)
            s.c4Until = c2.now + 25 * 60
            c2.buff(
              'Yelan',
              ['Yelan', 'c4Stacks'],
              `${s.c4Count}`,
              1,
              25 * 60 + 1,
              {
                hitlag: 'recipient',
              }
            )
          })
        }
        ctx.note('Yelan: one enemy is marked by Lingering Lifeline (C4).')
        return {
          cooldown: { key: 'skill', frames: 600, delay: 33 },
          frames: 42,
          framesInto: { burst: 41, dash: 41, jump: 41, swap: 40 },
        }
      }
      case 'burst': {
        ctx.hit(76, {
          path: ['burst', 'pressDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Depth-Clarion Dice',
        })
        // 15 s from the hit: Exquisite Throw waves on the active character's normal attacks
        s.burstEnd = ctx.now + 76 + 15 * 60
        // A4 (Adapt With Ease): the active character's DMG +1%, then +3.5% every second (the
        // sheet's a4Stacks: 0…14 stacks, one per second) while the burst lasts
        for (let k = 0; k < 15; k++)
          ctx.buff('Yelan', ['Yelan', 'a4Stacks'], `${k}`, 76 + 60 * k, 60)
        if (cons >= 6) {
          s.c6Count = 0
          s.c6End = ctx.now + 20 * 60
        }
        return {
          cooldown: { key: 'burst', frames: 18 * 60 },
          frames: 93,
          framesInto: { skill: 92, jump: 91, swap: 90 },
        }
      }
      case 'dash':
        // (Lady body: the template's dash)
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
