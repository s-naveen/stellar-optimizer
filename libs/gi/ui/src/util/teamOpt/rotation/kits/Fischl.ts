import type { CharacterKey } from '@genshin-optimizer/gi/consts'
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

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/fischl, main as of 2026-11-10. */

// Arrows land 10 frames (travel) after their hitmark; cancels are from the hitmark. The charged
// attack is the aimed shot: gcsim's normal cancel slice lets it start at the hitmark.
const fischlNormals: NormalHit[] = [
  { hitmarks: [25], toNormal: 25, toCharged: 15, toAbil: 15, frames: 25 },
  { hitmarks: [21], toNormal: 22, toCharged: 11, toAbil: 11, frames: 22 },
  { hitmarks: [34], toNormal: 38, toCharged: 24, toAbil: 24, frames: 38 },
  { hitmarks: [36], toNormal: 32, toCharged: 26, toAbil: 26, frames: 32 },
  { hitmarks: [31], toNormal: 67, toCharged: 21, toAbil: 21, frames: 67 },
]

interface FischlState {
  /** Oz is up from this frame (gcsim's oz-active status) */
  ozStart: number
  /** A4: Thundering Retribution's 0.5 s ICD (on the active character) ends (frame) */
  a4Icd: Map<CharacterKey, number>
  /** Oz is up until this frame (its ticks stop then; C1 needs it down) */
  ozEnd: number
  /** The current Oz: a new one stops the old one's ticks */
  ozId: number
  ozSnapshot?: {
    t: number
    onField: CharacterKey
  }
  /** C6: Oz attacks with the active character's normal attacks (no ICD, 1 s ticks) */
  c6Watch: NormalWatcher
  /** The burst's Oz (due at frame 113) is still to spawn: the burst's id (0: spawned or swapped) */
  burstOz: number
  burstSeq: number
  /** The recast's 92-frame CD (set when the skill's Oz spawns and by each recast) */
  recastReady: number
  /** A skill or burst started and its Oz has not spawned yet */
  ozPending: boolean
}

/** Oz lasts 10 s from its spawn; C6 adds 2 s */
const ozFrames = (c: number) => (c >= 6 ? 720 : 600)

/**
 * Oz spawns now: its first tick `firstTick` frames later, then every 59 frames while it is up.
 * Each tick's damage lands 10 frames later (travel).
 */
function startOz(
  ctx: SimContext,
  s: FischlState,
  firstTick: number,
  duration: number
) {
  s.ozPending = false
  s.ozStart = ctx.now
  // gcsim's oz-active status is active through its expiry frame: the end is exclusive
  s.ozEnd = ctx.now + duration + 1
  ozTicks(ctx, s, firstTick)
}

/** Oz's attack timer (restarted by a recast): ticks every 59 frames from `firstTick` */
function ozTicks(ctx: SimContext, s: FischlState, firstTick: number) {
  const id = ++s.ozId
  s.ozSnapshot = { t: ctx.now, onField: ctx.onField }
  const tick = (c: SimContext) => {
    if (id !== s.ozId || c.now >= s.ozEnd) return
    c.hit(10, {
      path: ['skill', 'ozDmg'],
      tag: 'skill',
      element: 'electro',
      applies: true,
      durability: 25,
      icd: 'skill',
      icdGroup: 'Fischl',
      label: 'Oz',
      statSnapshots: s.ozSnapshot
        ? [
            { stat: 'atk', path: ['total', 'atk'], ...s.ozSnapshot },
            { stat: 'critDMG_', path: ['total', 'critDMG_'], ...s.ozSnapshot },
          ]
        : undefined,
    })
    c.at(59, tick)
  }
  ctx.at(firstTick, tick)
}

/** Oz is on the field */
const ozUp = (s: FischlState, t: number) => t >= s.ozStart && t < s.ozEnd

/** gcsim's ozActive: set when the skill or burst starts (before Oz spawns): E recasts then */
const recastMode = (s: FischlState, t: number) => s.ozPending || ozUp(s, t)

export const kit: KitModel = {
  characterKey: 'Fischl',
  element: 'electro',
  source: `${GCSIM}/fischl`,
  init: (): FischlState => ({
    ozStart: Number.POSITIVE_INFINITY,
    a4Icd: new Map(),
    ozEnd: -1,
    ozId: 0,
    c6Watch: newNormalWatcher(),
    burstOz: 0,
    burstSeq: 0,
    recastReady: -1,
    ozPending: false,
  }),
  // While Oz is up, the skill is the recast (no skill CD): it waits only for the recast's CD
  cooldownKey: (s: FischlState, action, now) =>
    action.kind === 'skill'
      ? recastMode(s, now)
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  actionReadyAt: (ctx, s: FischlState, action) =>
    action.kind === 'skill' && recastMode(s, ctx.now)
      ? Math.max(ctx.now, s.recastReady)
      : ctx.now,
  // C6: while Oz is up, it attacks with the active character's normal attacks (gcsim's watcher)
  onPartyAction(
    ctx,
    s: FischlState,
    actor,
    action,
    frames,
    normalStarts,
    stateFrames
  ) {
    if (ctx.constellation('Fischl') < 6) return
    watchAction(
      ctx,
      s.c6Watch,
      action,
      frames,
      {
        delay: ctx.normalAnimationDelay(actor, 'yelan'),
        active: (c) => c.now < s.ozEnd,
        fire: (c) => {
          // Hexerei: C6 doubles the Lock effects, for 10 s from each Evernight Raven
          c.buff('Fischl', ['Fischl', 'lockC6Oz'], 'on', 0, 600)
          c.hit(10, {
            characterKey: 'Fischl',
            path: ['constellation6', 'ozActiveCharDmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'skill',
            icdGroup: 'Fischl',
            label: 'Evernight Raven (C6)',
            statSnapshots: s.ozSnapshot
              ? [
                  { stat: 'atk', path: ['total', 'atk'], ...s.ozSnapshot },
                  {
                    stat: 'critDMG_',
                    path: ['total', 'critDMG_'],
                    ...s.ozSnapshot,
                  },
                ]
              : undefined,
          })
        },
      },
      normalStarts,
      stateFrames
    )
  },
  act(ctx, s: FischlState, action, previous) {
    const oz = ozFrames(ctx.constellation('Fischl'))
    switch (action.kind) {
      case 'normal':
        return normalString(
          fischlNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            })
            // C1: with Oz down, each normal attack also fires an extra arrow
            if (ctx.constellation('Fischl') >= 1 && ctx.now >= s.ozEnd)
              ctx.hit(d, {
                path: ['constellation1', 'dmg'],
                tag: 'normal',
                element: 'physical',
                applies: true,
                durability: 100,
                label: 'Gaze of the Deep (C1)',
              })
          },
          ctx
        )
      case 'charged':
        // the fully-charged Aimed Shot (gcsim's default aim): damage at 86 + 10 frames of travel
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      case 'skill':
        if (recastMode(s, ctx.now)) {
          // Recast: Oz returns to Fischl's side; 2 frames later its attack timer restarts (first
          // tick 60 frames on) with a new snapshot. 92-frame recast CD; no skill CD.
          s.recastReady = ctx.now + 93
          ctx.at(2, (c) => ozTicks(c, s, 60))
          return {
            frames: 37,
            framesInto: { normal: 36, burst: 35, dash: 4, jump: 5 },
          }
        }
        // the summon's damage at 38 frames; Oz appears at 18 and first ticks 64 frames after that
        ctx.hit(38, {
          path: ['skill', 'summonDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          durability: 25,
          icd: 'none',
          icdGroup: 'Fischl',
          label: 'Oz (Summon)',
        })
        s.ozPending = true
        s.recastReady = ctx.now + 18 + 93
        ctx.at(18, (c) => startOz(c, s, 64, oz))
        // A4 (Thundering Retribution) is in onHit
        return {
          cooldown: { key: 'skill', frames: 1518 },
          frames: 43,
          framesInto: { dash: 14, jump: 16, swap: 42 },
        }
      case 'burst': {
        ctx.hit(18, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 25,
          icd: 'burst',
          icdGroup: 'Fischl',
          label: 'Midnight Phantasmagoria',
        })
        // C4: the extra burst hit, 8 frames in (its heal is not modelled)
        if (ctx.constellation('Fischl') >= 4)
          ctx.hit(8, {
            path: ['constellation4', 'burstAdditionalDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            durability: 50,
            icd: 'burst',
            icdGroup: 'Fischl',
            label: 'Her Pilgrimage of Bleak (C4)',
          })
        // the burst's Oz comes at frame 113, unless she swaps out first (see onSwapOut)
        const id = ++s.burstSeq
        s.burstOz = id
        s.ozPending = true
        ctx.at(113, (c) => {
          if (s.burstOz !== id) return
          s.burstOz = 0
          startOz(c, s, 69, oz)
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 148,
          framesInto: { dash: 115, jump: 115, swap: 24 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'bow', previous, ctx)
      case 'plunge':
        // not in gcsim (no plunge frames): not modelled
        ctx.note('Fischl: the plunge is not in gcsim; not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: FischlState, hit) {
    const isMark = hit.path[0] === '_reaction'
    const isHyperbloom =
      hit.path[0] === 'reaction' && hit.path[1] === 'hyperbloom'
    if (!isMark && !isHyperbloom) return
    const t = hit.t
    // (everything below needs Oz on the field)
    if (t < s.ozStart || t >= s.ozEnd) return
    const reaction = isMark ? hit.path[1] : 'hyperbloom'
    // Hexerei: Overload gives ATK, Electro-Charged / Lunar-Charged give EM, for 10 s (any member's)
    if (reaction === 'overloaded')
      ctx.buff('Fischl', ['Fischl', 'lockOverload'], 'on', 0, 600)
    else if (reaction === 'electroCharged' || reaction === 'lunarCharged')
      ctx.buff('Fischl', ['Fischl', 'lockEcLc'], 'on', 0, 600)
    // A4: Electro-related reactions triggered by the active character
    switch (reaction) {
      case 'crystallize':
        // only an Electro Crystallize (the marker carries the consumed aura)
        if (hit.element !== 'electro') return
        break
      case 'overloaded':
      case 'electroCharged':
      case 'lunarCharged':
      case 'superconduct':
      case 'stellarConduct':
      case 'electroSwirl':
      case 'hyperbloom':
      case 'quicken':
      case 'aggravate':
        break
      default:
        return
    }
    if (hit.characterKey !== (hit.onField ?? ctx.onField)) return
    const frame = ctx.characterFrame(hit.characterKey)
    if (frame < (s.a4Icd.get(hit.characterKey) ?? -1)) return
    s.a4Icd.set(hit.characterKey, frame + 31)
    ctx.hit(4, {
      characterKey: 'Fischl',
      path: ['passive2', 'dmg'],
      tag: 'skill',
      element: 'electro',
      applies: true,
      durability: 25,
      icd: 'none',
      icdGroup: 'Fischl',
      label: 'Thundering Retribution (A4)',
      statSnapshots: s.ozSnapshot
        ? [
            { stat: 'atk', path: ['total', 'atk'], ...s.ozSnapshot },
            { stat: 'critDMG_', path: ['total', 'critDMG_'], ...s.ozSnapshot },
          ]
        : undefined,
    })
  },
  onSwapOut(ctx, s: FischlState) {
    // a swap cut the burst before its Oz came: the Oz spawns 2 frames after the swap (swap delay
    // 1 frame), its first tick 64 frames after that
    if (s.burstOz === 0) return
    s.burstOz = 0
    ctx.at(2, (c) => startOz(c, s, 64, ozFrames(c.constellation('Fischl'))))
  },
}
