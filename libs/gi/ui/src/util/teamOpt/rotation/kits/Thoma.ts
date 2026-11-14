import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  type NormalWatcher,
  newNormalWatcher,
  normalString,
  templateJump,
  watchAction,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/thoma, main as of 2026-11-10. */

const thomaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 20,
    toCharged: 21,
    toAbil: 13,
    frames: 21,
  },
  {
    hitmarks: [18],
    hitlag: [9],
    toNormal: 27,
    toCharged: 25,
    toAbil: 18,
    frames: 27,
  },
  { hitmarks: [10, 23], toNormal: 31, toCharged: 32, toAbil: 23, frames: 32 },
  { hitmarks: [20], toNormal: 58, toCharged: 58, toAbil: 20, frames: 58 },
]

interface ThomaState {
  /** Crimson Ooyoroi's Scorching Ooyoroi (the Fiery Collapse window) ends */
  burstEnd: number
  /** Fiery Collapse's trigger: the active character's normal attacks (60-frame ICD, 1 s ticks) */
  watch: NormalWatcher
}

/**
 * Fiery Collapse (gcsim's summonFieryCollapse): snapshotted when triggered, it lands 11 frames
 * later, and its Blazing Barrier (C6's DMG bonus) comes with that hit
 */
function fieryCollapse(c: SimContext) {
  c.hit(11, {
    characterKey: 'Thoma',
    path: ['burst', 'collapseDmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    durability: 25,
    icd: 'burst',
    label: 'Fiery Collapse',
    snapshotDelay: 0,
  })
  if (c.constellation('Thoma') >= 6)
    c.buff('Thoma', ['Thoma', 'c6AfterBarrier'], 'on', 11, 360)
}

// Not modelled: the shields (no damage), Thoma's self Pyro aura from Blazing Blessing (no outgoing
// damage), A1's shield bonus and C4's energy. C1 follows gcsim (12 s / 17 s cooldowns, assuming a
// shielded teammate is hit), not its 20 s once-per trigger.
export const kit: KitModel = {
  characterKey: 'Thoma',
  element: 'pyro',
  source: `${GCSIM}/thoma`,
  init: (): ThomaState => ({ burstEnd: -1e9, watch: newNormalWatcher() }),
  act(ctx, s: ThomaState, action, previous) {
    const c = ctx.constellation('Thoma')
    switch (action.kind) {
      case 'normal':
        return normalString(
          thomaNormals,
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
      case 'charged':
        // (gcsim: needs a normal attack right before it; not checked here)
        ctx.hit(27, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          // (gcsim's ICDGroupPoleExtraAttack)
          icd: 'poleExtra',
          label: 'Charged Attack',
        })
        return {
          frames: 64,
          framesInto: { dash: 34, jump: 34, swap: 63 },
        }
      case 'skill': {
        ctx.hit(11, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          label: 'Blazing Blessing',
        })
        // 3.6 frames of hitlag plus the defense halt (7.2, rounded up)
        ctx.hit(11, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 8,
          label: 'Blazing Blessing hitlag',
        })
        // C6: the Blazing Barrier (9 frames in) gives the party +15% Normal, Charged and Plunging
        // DMG for 6 s
        if (c >= 6) ctx.buff('Thoma', ['Thoma', 'c6AfterBarrier'], 'on', 9, 360)
        // C1: the cooldown is 12 s (gcsim's sim value)
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: c >= 1 ? 720 : 900, delay: 9 },
            frames: 46,
            framesInto: { dash: 32, jump: 32, swap: 44 },
          },
          { hitmarks: [11], hitlag: [8] }
        )
      }
      case 'burst': {
        // Scorching Ooyoroi lasts 15 s (18 s at C2)
        s.burstEnd = ctx.now + (c >= 2 ? 1080 : 900)
        ctx.hit(40, {
          path: ['burst', 'pressDmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Crimson Ooyoroi',
        })
        return {
          // C1: 17 s (gcsim's sim value for the shield-triggered cut)
          cooldown: { key: 'burst', frames: c >= 1 ? 1020 : 1200 },
          frames: 58,
          framesInto: { normal: 57, skill: 56, dash: 57, swap: 56 },
        }
      }
      case 'dash':
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength, male body)
        return templateJump('male', 'polearm', previous, ctx)
      default:
        // gcsim has no plunge for Thoma: no damage
        return { frames: 30 }
    }
  },
  // Fiery Collapse: on the active character's normal attacks (gcsim's watcher, kits/common.ts)
  onPartyAction(
    ctx,
    s: ThomaState,
    actor,
    action,
    frames,
    normalStarts,
    stateFrames
  ) {
    watchAction(
      ctx,
      s.watch,
      action,
      frames,
      {
        delay: ctx.normalAnimationDelay(actor, 'xingqiu'),
        clock: 'Thoma',
        active: (c) => c.now < s.burstEnd,
        fire: fieryCollapse,
        icd: 60,
      },
      normalStarts,
      stateFrames
    )
  },
}
