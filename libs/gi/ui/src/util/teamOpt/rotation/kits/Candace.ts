import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, withHitlag } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/candace, main as of 2026-11-10. */

const candaceNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 20,
    toCharged: 32,
    toAbil: 11,
    frames: 32,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 33,
    toCharged: 33,
    toAbil: 16,
    frames: 33,
  },
  {
    hitmarks: [16, 39],
    hitlag: [0, 6],
    toNormal: 48,
    toCharged: 43,
    toAbil: 39,
    frames: 48,
  },
  {
    hitmarks: [43],
    hitlag: [6],
    toNormal: 69,
    toCharged: 69,
    toAbil: 43,
    frames: 69,
  },
]

/** Our sheet's node for each hit of each string step (N3's two hits are 3.1 and 3.2) */
const candaceNodes = [[0], [1], [2, 3], [4]]

interface CandaceState {
  /** Wagtail's Tide's status (from its hitmark), and the frame it ends (exclusive) */
  burstOn: boolean
  burstEnd: number
  /** Casts so far (a status ends only for the cast that started it) */
  burstSrc: number
  /** Waves so far in this burst (up to 3) */
  waves: number
  /** C2's Max HP status, its end and its cast */
  c2Src: number
  /** C6's ICD ends (frame) */
  c6Until: number
}

const burstDuration = (c: number) => (c >= 1 ? 720 : 540)

/** gcsim's AddStatus(burstKey, duration, true): active through its expiry frame */
const inBurst = (s: CandaceState, t: number) => s.burstOn && t < s.burstEnd

/**
 * Prayer of the Crimson Crown, from the burst's hitmark: gcsim's hitlag-affected status on Candace
 * (her own hitlag extends it). The DMG bonus (and the sheet's infusion) is the `afterBurst`
 * conditional; the engine's infusion (for reactions) covers the same window, one piece per
 * extension.
 */
function startPrayer(ctx: SimContext, s: CandaceState, duration: number) {
  const src = ++s.burstSrc
  s.burstOn = true
  s.burstEnd = ctx.now + duration + 1
  ctx.state('Candace', ['Candace', 'afterBurst'], 'on')
  ctx.infuse('hydro', 0, duration + 1)
  ctx.atCharacter('Candace', duration + 1, (c) => {
    if (src !== s.burstSrc) return
    s.burstOn = false
    c.state('Candace', ['Candace', 'afterBurst'], '')
  })
}

/** C2: Max HP +20% for 15 s, a hitlag-affected status on Candace (refreshed by each skill hit) */
function c2Status(ctx: SimContext, s: CandaceState) {
  const src = ++s.c2Src
  ctx.state('Candace', ['Candace', 'c2AfterSkillHit'], 'on')
  ctx.atCharacter('Candace', 15 * 60 + 1, (c) => {
    if (src === s.c2Src) c.state('Candace', ['Candace', 'c2AfterSkillHit'], '')
  })
}

/**
 * Hitlag on Candace: gcsim applies an attack's pause to its attacker only while that attacker is
 * on the field (player.ApplyHitlag). `pause` is the halt plus the 3.6-frame defense halt, rounded up.
 */
function hitlag(ctx: SimContext, delay: number, pause: number, label: string) {
  ctx.at(delay, (c) => {
    if (c.onField !== 'Candace') return
    c.hit(0, {
      characterKey: 'Candace',
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: pause,
      extendsAction: true,
      label,
    })
  })
}

/** A swap while the burst is up: one wave, 1 frame later (up to 3 per burst) */
function swapWave(ctx: SimContext, s: CandaceState) {
  if (!inBurst(s, ctx.now) || s.waves >= 3) return
  s.waves++
  // (its defense halt pauses Candace when she is the one taking the field)
  hitlag(ctx, 1, 4, 'Wave hitlag')
  ctx.hit(1, {
    characterKey: 'Candace',
    path: ['burst', 'waveDmg'],
    tag: 'burst',
    element: 'hydro',
    applies: true,
    durability: 25,
    icd: 'none',
    label: "Sacred Rite: Wagtail's Tide (Wave)",
  })
}

export const kit: KitModel = {
  characterKey: 'Candace',
  element: 'hydro',
  source: `${GCSIM}/candace`,
  init: (): CandaceState => ({
    burstOn: false,
    burstEnd: -1,
    burstSrc: 0,
    waves: 0,
    c2Src: 0,
    c6Until: -1,
  }),
  act(ctx, s: CandaceState, action, previous) {
    const c = ctx.constellation('Candace')
    // (within the burst, the engine's infusion makes her Physical attacks Hydro)
    switch (action.kind) {
      case 'normal':
        return normalString(
          candaceNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${candaceNodes[i][j]}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              durability: 25,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(25, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 53,
          framesInto: { skill: 52, burst: 52, dash: 29, jump: 28, swap: 51 },
        }
      case 'skill': {
        // (The shield of Heron's Sanctum is not damage: not modelled.)
        // A1 (finish the Hold's charge when hit) is not modelled.
        if (!action.hold) {
          ctx.hit(16, {
            path: ['skill', 'basicDmg'],
            tag: 'skill',
            element: 'hydro',
            applies: true,
            durability: 25,
            icd: 'none',
            label: "Sacred Rite: Heron's Sanctum",
          })
          // C2: Max HP +20% for 15 s after the skill hits
          if (c >= 2) ctx.at(16, (c2) => c2Status(c2, s))
          // the hit pauses her 0.05 s plus the 3.6-frame defense halt (6.6, applied as 7)
          ctx.hit(16, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 7,
            label: "Heron's Sanctum hitlag",
          })
          return withHitlag(
            {
              cooldown: { key: 'skill', frames: 360, delay: 14 },
              frames: 26,
              framesInto: { burst: 25, swap: 25 },
            },
            { hitmarks: [16], hitlag: [7] }
          )
        }
        ctx.hit(91, {
          path: ['skill', 'chargedDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          durability: 25,
          icd: 'none',
          label: "Sacred Rite: Heron's Sanctum (Charged)",
        })
        if (c >= 2) ctx.at(91, (c2) => c2Status(c2, s))
        ctx.hit(91, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 7,
          label: "Heron's Sanctum hitlag",
        })
        return withHitlag(
          {
            // C4: the Hold's cooldown is the Tap's
            cooldown: { key: 'skill', frames: c >= 4 ? 360 : 540, delay: 89 },
            frames: 113,
            framesInto: { normal: 112, burst: 112, jump: 111, swap: 110 },
          },
          { hitmarks: [91], hitlag: [7] }
        )
      }
      case 'burst': {
        ctx.hit(33, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 25,
          icd: 'none',
          label: "Sacred Rite: Wagtail's Tide",
        })
        // the burst's window starts at its hitmark: the infusion, the DMG bonus and the waves
        s.waves = 0
        ctx.at(33, (c2) => startPrayer(c2, s, burstDuration(c)))
        // its hit pauses her by the defense halt (3.6 frames, applied as 4)
        ctx.hit(33, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          label: "Wagtail's Tide hitlag",
        })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 51,
            framesInto: { normal: 50, dash: 50, jump: 50, swap: 49 },
          },
          { hitmarks: [33], hitlag: [4] }
        )
      }
      case 'plunge':
        // Low Plunge (P: the rotation does not give the height). Collision is not modelled.
        ctx.hit(42, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 81,
          framesInto: { normal: 59, skill: 59, burst: 60, dash: 79, swap: 65 },
        }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength)
        return {
          frames: previous?.kind === 'dash' ? 37 : 32,
          framesInto: { plunge: 5 },
        }
      default:
        return { frames: 30 }
    }
  },
  // gcsim's OnCharacterSwap: any member taking the field while the burst is up
  onPartySwap(ctx, s: CandaceState) {
    swapWave(ctx, s)
  },
  // her hitlag extends Prayer's status (and so its infusion)
  onHitlag(ctx, s: CandaceState, frames) {
    if (!inBurst(s, ctx.now) || frames <= 0) return
    ctx.infuse('hydro', s.burstEnd - ctx.now, frames)
    s.burstEnd += frames
  },
  onHit(ctx, s: CandaceState, hit) {
    // C6 (The Overflow): another member's Elemental Normal Attack while the burst's Prayer is up
    if (ctx.constellation('Candace') < 6) return
    if (
      hit.characterKey === 'Candace' ||
      hit.tag !== 'normal' ||
      hit.element === 'physical' ||
      hit.onField !== hit.characterKey ||
      !inBurst(s, hit.t) ||
      hit.t < s.c6Until
    )
      return
    // (a 138-frame status: active on its expiry frame)
    s.c6Until = hit.t + 139
    ctx.hit(1, {
      characterKey: 'Candace',
      path: ['constellation6', 'dmg'],
      tag: 'burst',
      element: 'hydro',
      applies: true,
      durability: 25,
      icd: 'none',
      label: 'The Overflow (C6)',
    })
  },
}
