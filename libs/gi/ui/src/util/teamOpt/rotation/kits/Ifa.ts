import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext } from '../types'
import {
  atkSpdAdjust,
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/ifa. */

/** Normal attacks outside Nightsoul Blessing (no travel) */
const ifaNormals: NormalHit[] = [
  { hitmarks: [10], toNormal: 15, toCharged: 18, toAbil: 10, frames: 27 },
  { hitmarks: [13], toNormal: 20, toCharged: 19, toAbil: 13, frames: 31 },
  { hitmarks: [42], toNormal: 90, toCharged: 81, toAbil: 42, frames: 90 },
]

/** Nightsoul Blessing: 80 points, 0.8 per 6f, the last drain at 598f */
const NS_FRAMES = 598
/** A dash costs 13.5 points: 101.25f of blessing */
const NS_DASH = 101.25
/** Swaps are locked for 37f when the blessing runs out (gcsim's exitNightsoul SwapCD) */
const EXIT_SWAP_LOCK = 37
/** A low plunge is allowed for 26f after the blessing ends */
const PLUNGE_WINDOW = 26
/** Sedation Mark's aura: the first of these the party has (gcsim's priority) */
const AURA = ['pyro', 'hydro', 'electro', 'cryo'] as const

interface IfaState {
  /** Nightsoul Blessing is on */
  ns: boolean
  /** Frame its points run out (dashes bring it earlier) */
  nsEnd: number
  /** Only the latest scheduled end counts */
  token: number
  /** A low plunge is allowed until this frame (-1: none) */
  plungeUntil: number
  healReady: number
  /** C6: the extra shot's 50% chance, accumulated */
  c6Acc: number
}

/**
 * gcsim's Ifa cannot be swapped out while she has Nightsoul points, and her fall locks swaps for
 * 37 frames when the blessing runs out: an action in the blessing can't be swapped out of sooner
 */
function holdSwap(ctx: SimContext, s: IfaState, r: ActionResult): ActionResult {
  if (!s.ns) return r
  const lock = s.nsEnd + EXIT_SWAP_LOCK - ctx.now
  return {
    ...r,
    framesInto: {
      ...r.framesInto,
      swap: Math.max(r.framesInto?.swap ?? r.frames, lock),
    },
  }
}

/** A Tonic Shot (Nightsoul-aligned, the skill's ICD) lands only while the blessing lasts */
function tonicShot(
  ctx: SimContext,
  s: IfaState,
  delay: number,
  path: string[],
  label: string
) {
  ctx.at(delay, (c) => {
    if (!s.ns || c.now >= s.nsEnd) return
    c.hit(0, {
      characterKey: 'Ifa',
      path,
      tag: 'normal',
      element: 'anemo',
      applies: true,
      icd: 'Ifa_Eart_Bullet',
      icdGroup: 'IfaSkillHit',
      nightsoul: true,
      label,
    })
  })
}

/** The blessing ends by its points at `nsEnd` (a scheduled event: it runs before the next action) */
function scheduleNsEnd(ctx: SimContext, s: IfaState) {
  const token = ++s.token
  ctx.at(Math.max(0, s.nsEnd - ctx.now), (c) => {
    if (s.token !== token || !s.ns) return
    s.ns = false
    s.plungeUntil = c.now + PLUNGE_WINDOW
  })
}

/** His moves while hovering in the blessing (E aside): the buttons with their own frames there */
const NIGHTSOUL_MOVES: Partial<Record<RotationAction['kind'], string>> = {
  normal: 'Tonic Shot',
  charged: 'Tonic Shot (hold)',
  burst: 'Compound Sedation Field (hovering)',
  dash: 'Hovering Dash',
}

export const kit: KitModel = {
  characterKey: 'Ifa',
  element: 'anemo',
  source: `${KQMSIM}/ifa`,
  nightsoul(ctx, s: IfaState) {
    return {
      active: s.ns && ctx.now < s.nsEnd,
      points: s.ns ? Math.max(0, ((s.nsEnd - ctx.now) * 80) / NS_FRAMES) : 0,
    }
  },
  onNightsoulBurst(ctx) {
    ctx.buff('Ifa', ['Ifa', 'a4NsBurst'], 'on', 0, 600, { hitlag: 'recipient' })
  },
  init: (): IfaState => ({
    ns: false,
    nsEnd: 0,
    token: 0,
    plungeUntil: -1,
    healReady: -1,
    c6Acc: 0,
  }),
  onHit(ctx, s: IfaState, hit) {
    const c2 = ctx.constellation('Ifa') >= 2
    const points = ctx.teamNightsoul
    const essentials =
      s.ns && ctx.now < s.nsEnd
        ? Math.min(
            c2 ? 200 : 150,
            points + (c2 ? 3 * Math.max(0, points - 60) : 0)
          )
        : 0
    ctx.state(
      'Ifa',
      ['Ifa', 'a1Essentials'],
      essentials >= 1 ? String(Math.floor(essentials)) : ''
    )
    // a Tonic Shot hit (tap or hold) heals the party (0.1 s ICD)
    if (
      hit.characterKey !== 'Ifa' ||
      hit.path[0] !== 'skill' ||
      hit.path[1] !== 'tonicDmg' ||
      ctx.now < s.healReady
    )
      return
    s.healReady = ctx.now + 6
    ctx.hit(0, {
      path: ['_heal', 'skill', 'tonicHeal'],
      tag: 'other',
      element: 'anemo',
      weight: ctx.members.length,
      label: 'Tonic Shot (Heal)',
    })
  },
  // Hovering in the blessing his normal and charged attacks are Tonic Shots, E ends the blessing (a
  // held E plunges), and his burst and dash have their own frames
  variant(_ctx, s: IfaState, action) {
    if (!s.ns) return undefined
    const label =
      action.kind === 'skill'
        ? action.hold
          ? 'Nightsoul Plunging Attack'
          : "End Nightsoul's Blessing"
        : NIGHTSOUL_MOVES[action.kind]
    return label
      ? { key: 'nightsoul', label, mode: "Nightsoul's Blessing" }
      : undefined
  },
  act(ctx, s: IfaState, action, previous) {
    const c = ctx.constellation('Ifa')
    switch (action.kind) {
      case 'normal': {
        if (s.ns) {
          // Tonic Shot taps: one per normal attack, 54f apart (attack speed applies), the hit 3f
          // in if the blessing is still on
          const n = action.count ?? 1
          let start = 0
          for (let i = 0; i < n; i++) {
            tonicShot(ctx, s, start + 3, ['skill', 'tonicDmg'], 'Tonic Shot')
            if (i < n - 1)
              start += atkSpdAdjust(54, ctx.normalAttackSpeed(i > 0))
          }
          const speed = ctx.normalAttackSpeed(n > 1)
          return holdSwap(ctx, s, {
            frames: start + atkSpdAdjust(54, speed),
            framesInto: {
              normal: start + atkSpdAdjust(54, speed),
              charged: start + atkSpdAdjust(42, speed),
              skill: start,
              burst: start,
              dash: start,
              jump: start,
              swap: start,
            },
          })
        }
        return normalString(
          ifaNormals,
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
      }
      case 'charged': {
        if (s.ns) {
          // Hold Tonic Shot: the hit 1f in, 42f per shot (attack speed applies)
          tonicShot(ctx, s, 1, ['skill', 'tonicDmg'], 'Tonic Shot (hold)')
          // C6: a 50% chance of an extra shot (120% ATK) 12f in, which lengthens this one by 11f
          // (gcsim rolls it; a deterministic accumulator procs every other hold shot, as Mitya's
          // refunds do, so C0-C5 rotations need no sampling)
          let ext = 0
          if (c >= 6) {
            s.c6Acc += 0.5
            if (s.c6Acc >= 1) {
              s.c6Acc -= 1
              ext = 11
            }
          }
          if (ext)
            tonicShot(ctx, s, 12, ['constellation6', 'dmg'], 'Tonic Shot (C6)')
          const speed = ctx.normalAttackSpeed(false)
          return holdSwap(ctx, s, {
            frames: atkSpdAdjust(42 + ext, speed),
            framesInto: {
              normal: atkSpdAdjust(54 + ext, speed),
              charged: atkSpdAdjust(42 + ext, speed),
              skill: atkSpdAdjust(ext, speed),
              burst: atkSpdAdjust(ext, speed),
              dash: atkSpdAdjust(ext, speed),
              swap: atkSpdAdjust(ext, speed),
            },
          })
        }
        // Charged Attack: the hit at 45f (Anemo)
        ctx.hit(45, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return {
          frames: 86,
          framesInto: {
            normal: 64,
            charged: 64,
            skill: 64,
            burst: 64,
            dash: 45,
            jump: 45,
            swap: 62,
          },
        }
      }
      case 'skill': {
        if (s.ns && action.hold) {
          // Hold E in the blessing: a low plunge at 39f, whose landing ends the blessing
          s.token++
          s.plungeUntil = -1
          ctx.at(39, () => {
            s.ns = false
            s.plungeUntil = -1
          })
          ctx.hit(39, {
            path: ['plunging', 'low'],
            tag: 'plunge',
            element: 'anemo',
            applies: true,
            icd: 'none',
            nightsoul: true,
            label: 'Low Plunge (Nightsoul)',
          })
          return {
            cooldown: { key: 'skill', frames: 450, delay: 39 },
            frames: 69,
            framesInto: {
              normal: 50,
              charged: 49,
              skill: 39,
              burst: 49,
              dash: 44,
              jump: 58,
              swap: 55,
            },
          }
        }
        if (s.ns) {
          // E again in the blessing: it ends now (the skill's cooldown starts now)
          s.token++
          s.ns = false
          s.plungeUntil = ctx.now + PLUNGE_WINDOW
          return {
            cooldown: { key: 'skill', frames: 450 },
            frames: 44,
            framesInto: {
              normal: 43,
              burst: 42,
              jump: 43,
              swap: 42,
              // the low plunge's cancel
              plunge: 6,
            },
          }
        }
        // Elemental Skill: Nightsoul Blessing, ending by its points (the cooldown starts then)
        s.ns = true
        s.nsEnd = ctx.now + NS_FRAMES
        scheduleNsEnd(ctx, s)
        ctx.note(
          'Ifa: C1 energy refunds are not included in damage comparisons.'
        )
        // swapping out waits for the fall: gcsim locks swaps for 37 frames when the blessing
        // runs out (exitNightsoul's SwapCD)
        return {
          cooldown: { key: 'skill', frames: 450, delay: NS_FRAMES },
          frames: 631,
          framesInto: {
            normal: 31,
            charged: 28,
            skill: 17,
            burst: 5,
            dash: 28,
            swap: NS_FRAMES + EXIT_SWAP_LOCK,
          },
        }
      }
      case 'burst': {
        const ns = s.ns
        // Sedation Mark (38f after the burst's hit) on an enemy with a Pyro, Hydro, Electro or
        // Cryo aura when the burst lands (gcsim checks the aura in that priority, before the
        // burst's own hit: the check is scheduled first); no mark without one
        ctx.at(41, (c2) => {
          const aura = c2.absorb(AURA)
          if (!aura) return
          c2.hit(38, {
            path: ['burst', aura],
            tag: 'burst',
            element: aura,
            applies: true,
            icd: 'Ifa_Burst_ExtraHit',
            icdGroup: 'IfaSedationMark',
            nightsoul: true,
            label: 'Sedation Mark',
          })
        })
        // Compound Sedation Field: the hit at 41f (queued after the mark's aura check, as in gcsim)
        ctx.hit(41, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: 'Compound Sedation Field',
        })
        // C4: EM for 15 s after the burst (the sheet's c4AfterBurst condition)
        if (c >= 4) ctx.buff('Ifa', ['Ifa', 'c4AfterBurst'], 'on', 0, 900)
        // a following wait starts at 64 frames either way (gcsim's CanQueueAfter is the
        // blessing's dash cancel)
        return holdSwap(ctx, s, {
          cooldown: { key: 'burst', frames: 900 },
          frames: ns ? 79 : 95,
          framesInto: ns
            ? { normal: 67, charged: 68, skill: 68, dash: 64, wait: 64 }
            : {
                normal: 79,
                charged: 79,
                skill: 79,
                dash: 78,
                jump: 79,
                swap: 76,
                wait: 64,
              },
        })
      }
      case 'dash':
        if (s.ns) {
          // a dash costs 13.5 points of blessing
          s.nsEnd -= NS_DASH
          const into: ActionResult['framesInto'] = {
            normal: 17,
            burst: 15,
            skill: 9,
          }
          if (s.nsEnd <= ctx.now) {
            s.ns = false
            s.token++
            s.plungeUntil = s.nsEnd + PLUNGE_WINDOW
            into.swap = Math.max(23, s.nsEnd + EXIT_SWAP_LOCK - ctx.now)
          } else scheduleNsEnd(ctx, s)
          return holdSwap(ctx, s, {
            cooldown: { key: 'skill', frames: 450, delay: s.nsEnd - ctx.now },
            frames: 23,
            framesInto: into,
          })
        }
        // template dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        if (s.ns)
          return {
            frames: 0,
            failed:
              'Ifa: no jump during Nightsoul Blessing (gcsim does not implement it)',
          }
        // template jump (Male body in gcsim's catalog)
        return templateJump('male', 'catalyst', previous, ctx)
      case 'plunge': {
        if (s.ns || ctx.now >= s.plungeUntil)
          return {
            frames: 0,
            failed:
              'Ifa: a low plunge only works in the 26 frames after Nightsoul Blessing ends',
          }
        // Low Plunge: the hit at 38f
        s.plungeUntil = -1
        ctx.hit(38, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 71,
          framesInto: {
            normal: 50,
            charged: 50,
            skill: 38,
            burst: 50,
            dash: 42,
            swap: 57,
          },
        }
      }
      default:
        return { frames: 30 }
    }
  },
  // E ends the blessing (no cooldown while it is on); the cooldown starts when it ends
  cooldownKey: (s: IfaState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && !s.ns
        ? 'skill'
        : undefined,
}
