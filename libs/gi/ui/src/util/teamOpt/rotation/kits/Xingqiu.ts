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

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xingqiu, main as of 2026-11-10. */

// gcsim's InitNormalCancelSlice: the hitmark into abilities, the animation into normal and charged
const xingqiuNormals: NormalHit[] = [
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 18,
    toCharged: 35,
    toAbil: 10,
    frames: 35,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 24,
    toCharged: 29,
    toAbil: 13,
    frames: 29,
  },
  {
    hitmarks: [9, 19],
    hitlag: [8, 8],
    toNormal: 26,
    toCharged: 35,
    toAbil: 19,
    frames: 35,
  },
  {
    hitmarks: [17],
    hitlag: [8],
    toNormal: 28,
    toCharged: 33,
    toAbil: 17,
    frames: 33,
  },
  {
    hitmarks: [18, 39],
    hitlag: [10, 10],
    toNormal: 66,
    toCharged: 66,
    toAbil: 39,
    frames: 66,
  },
]

interface XingqiuState {
  /** Guhua Sword: Raincutter is up until this frame (cast + 15 s, +3 s at C2, +33 frames) */
  burstEnd: number
  /** Swords in the next wave: 2, 3, then 2 (3, 5, 2… at C6) */
  nextWave: number
  /** Raincutter's trigger: the active character's normal attacks (60-frame ICD, 1 s ticks) */
  watch: NormalWatcher
  /** The Rain Sword orbital is up until this frame (cast + 15 s) */
  orbitalEnd: number
  /** The orbital's tick chain is running */
  orbitalOn: boolean
}

/** One Raincutter wave: its Hydro swords land 20 frames after it is summoned */
function summonWave(c: SimContext, s: XingqiuState) {
  for (let k = 0; k < s.nextWave; k++)
    c.hit(20, {
      path: ['burst', 'dmg'],
      tag: 'burst',
      element: 'hydro',
      applies: true,
      icd: 'burst',
      // (gcsim: stats at the proc)
      snapshotDelay: 0,
      label: 'Raincutter (Hydro sword)',
    })
  // C2: the wave's hits on the enemy lower its Hydro RES by 15% for 4 s
  // (an enemy modifier added 1 frame after the hit, active on its expiry frame)
  if (c.constellation('Xingqiu') >= 2)
    c.buff('Xingqiu', ['Xingqiu', 'c2'], 'on', 21, 241, { hitlag: 'enemy' })
  // gcsim's sequence: 2 → 3 → 2 (C6: 3 → 5 → 2)
  s.nextWave =
    s.nextWave === 2
      ? 3
      : s.nextWave === 3 && c.constellation('Xingqiu') >= 6
        ? 5
        : 2
}

/**
 * The Rain Sword orbital: a Hydro application every 135 frames, the first 43 frames after the
 * skill. It does no damage: a marker hit (not in our sheet), applying Hydro for the reactions.
 */
function orbitalTick(c: SimContext, s: XingqiuState) {
  if (c.characterFrame('Xingqiu') >= s.orbitalEnd) {
    s.orbitalOn = false
    // A1 (Hydropathic): each Rain Sword's expiry heals the active character 6% of Xingqiu's Max
    // HP (3 swords; C1: 4). Not in gcsim; it only moves HP (Fanfare, HP-based effects).
    const swords = c.constellation('Xingqiu') >= 1 ? 4 : 3
    for (let k = 0; k < swords; k++)
      c.hit(0, {
        path: ['_heal', 'passive1', 'healing'],
        tag: 'other',
        element: 'hydro',
        healTargets: [c.onField],
        label: 'Hydropathic (Heal)',
      })
    return
  }
  if (c.target.distance <= c.target.radius + 1.2)
    c.hit(1, {
      path: ['_marker', 'xingqiuOrbital'],
      tag: 'other',
      element: 'hydro',
      applies: true,
      icd: 'none',
      label: 'Rain Sword orbital (Hydro, no DMG)',
    })
  c.atCharacter('Xingqiu', 135, (c2) => orbitalTick(c2, s))
}

function applyOrbital(
  c: SimContext,
  s: XingqiuState,
  duration: number,
  delay: number
) {
  s.orbitalEnd = c.characterFrame('Xingqiu') + duration
  if (s.orbitalOn) return
  s.orbitalOn = true
  c.atCharacter('Xingqiu', delay, (at) => orbitalTick(at, s))
}

export const kit: KitModel = {
  characterKey: 'Xingqiu',
  // Raincutter: on the active character's normal attacks (gcsim's watcher, kits/common.ts)
  onPartyAction(
    ctx,
    s: XingqiuState,
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
        clock: 'Xingqiu',
        active: (c) => c.characterFrame('Xingqiu') < s.burstEnd,
        fire: (c) => summonWave(c, s),
        icd: 60,
      },
      normalStarts,
      stateFrames
    )
  },
  element: 'hydro',
  source: `${GCSIM}/xingqiu`,
  init: (): XingqiuState => ({
    burstEnd: -1,
    nextWave: 2,
    watch: newNormalWatcher(),
    orbitalEnd: -1,
    orbitalOn: false,
  }),
  act(ctx, s: XingqiuState, action, previous) {
    const c = ctx.constellation('Xingqiu')
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        const result = normalString(
          xingqiuNormals,
          count,
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
        return result
      }
      case 'charged':
        ctx.hit(8, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(20, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        return {
          frames: 58,
          framesInto: { skill: 32, burst: 32, dash: 20, jump: 20, swap: 31 },
        }
      case 'skill': {
        ctx.hit(12, {
          path: ['skill', 'press1'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Guhua Sword: Fatal Rainscreen (1)',
        })
        ctx.hit(36, {
          path: ['skill', 'press2'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Guhua Sword: Fatal Rainscreen (2)',
        })
        // Rain Swords last 15 s; a recast extends them and keeps the orbital's tick chain
        applyOrbital(ctx, s, 900, 43)
        ctx.buff('Xingqiu', ['Xingqiu', 'skill'], 'on', 0, 900, {
          hitlag: 'recipient',
        })
        for (const delay of [12, 36])
          ctx.hit(delay, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 5,
            label: 'Fatal Rainscreen hitlag',
          })
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 1260, delay: 10 },
            frames: 67,
            // (a written wait starts at CanQueueAfter: the dash cancel)
            framesInto: { skill: 65, dash: 31, jump: 34, wait: 31 },
          },
          { hitmarks: [12, 31], hitlag: [5, 5] }
        )
      }
      case 'burst': {
        // Raincutter has no hit of its own: its waves come from normal attacks (see above)
        const dur = (c >= 2 ? 18 : 15) * 60
        s.burstEnd = ctx.characterFrame('Xingqiu') + dur + 33
        // the Rain Swords (orbital) from its hitmark, 18 frames
        applyOrbital(ctx, s, dur, 18)
        ctx.buff('Xingqiu', ['Xingqiu', 'skill'], 'on', 0, dur, {
          hitlag: 'recipient',
        })
        s.nextWave = 2
        // C4: the Skill's DMG +50% while Raincutter is up
        if (c >= 4)
          ctx.buff('Xingqiu', ['Xingqiu', 'burst'], 'on', 0, dur + 33, {
            hitlag: 'recipient',
          })
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 40,
          // (a written wait starts at CanQueueAfter: the hitmark, 18)
          framesInto: { normal: 33, skill: 33, dash: 33, jump: 33, wait: 18 },
        }
      }
      case 'dash':
        // Boy body: 21 frames, jump after 2
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // Boy body: 31 frames (34 after a dash)
        return templateJump('boy', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(_ctx, _s: XingqiuState) {},
}
