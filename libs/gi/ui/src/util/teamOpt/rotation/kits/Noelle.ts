import type { RotationAction } from '../parse'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/noelle, main as of 2026-11-10. */

/** Each normal hit's poise damage (gcsim), outside and in Sweeping Time */
const attackPoise = [105.8, 98.1, 115.34, 151.68]
const burstPoise = [132.25, 122.82, 143.865, 189.75]

/** Normal attack string N1..N4 (gcsim's attackFrames) */
const noelleNormals: NormalHit[] = [
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 38,
    toCharged: 41,
    toAbil: 27,
    frames: 54,
  },
  {
    hitmarks: [24],
    hitlag: [10],
    toNormal: 46,
    toCharged: 48,
    toAbil: 24,
    frames: 66,
  },
  {
    hitmarks: [19],
    hitlag: [9],
    toNormal: 31,
    toCharged: 40,
    toAbil: 19,
    frames: 72,
  },
  {
    hitmarks: [41],
    hitlag: [13],
    toNormal: 106,
    toCharged: 109,
    toAbil: 41,
    frames: 112,
  },
]

/** Normal hits' hitlag in Sweeping Time (N3's halt is 0.1 s there) */
const burstNormalHitlag = [10, 10, 10, 13]

/**
 * Charged Attack (Cyclic Charged Attack): a spin hit, then the final hit (gcsim adds the final
 * unless another Charged Attack continues the spin). The windup is before the spin hit.
 */
const CA_SPIN_HIT = 23
/** The spin ends this many frames after its windup (the transition to the final) */
const CA_SPIN_END = 36
/** The final hit, after the spin's end */
const CA_FINAL_HIT = 26
/** Spin and final hitlag (0.03 s and 0.15 s halts + defense halt) */
const CA_SPIN_LAG = 6
const CA_FINAL_LAG = 13
/** Sweeping Time: 900 frames from its first frame (+ 80 windup) on Noelle's clock */
const BURST_DUR = 900 + 80

interface NoelleState {
  /** Sweeping Time ends at this frame (Noelle's clock, inclusive) */
  burstEnd: number
  /** The current Charged Attack: token, its final's start (world) and its animation's end */
  caToken: number
  caFinalStart: number
  caEnd: number
  /** The action that started the current Charged Attack (later actions cancel its final) */
  caStart: number
  /** The C4 shield: its token (a recast or expiry explodes it) */
  shieldToken: number
  /** A4: normal and charged hits counted, and the 0.1 s count ICD */
  a4Count: number
  a4Ready: number
  /** Breastplate is up until this frame (its breaking by damage is not modelled) */
  shieldUntil: number
  /** Breastplate's heal: its chance accumulated over the attacks (the expected heals) */
  healChance: number
}

/** Breastplate's heal chance by skill level (1-15) */
const HEAL_CHANCE = [
  0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.59, 0.6, 0.6,
  0.6, 0.6,
]

const inBurst = (ctx: SimContext, s: NoelleState) =>
  ctx.characterFrame('Noelle') <= s.burstEnd

/** The windup before a Charged Attack, by Noelle's state (gcsim's windupFrames) */
function caWindup(
  ctx: SimContext,
  s: NoelleState,
  prev: RotationAction | undefined
): number {
  if (!prev) return 56
  if (prev.kind === 'charged' && ctx.now <= s.caEnd)
    // continuing a spin (its final not started): none; after the final: 41
    return ctx.now < s.caFinalStart ? 0 : 41
  // (after N3, the combo's next is N4)
  if (prev.kind === 'normal') return ctx.normalSequence(4, 0) === 3 ? 45 : 56
  if (prev.kind === 'plunge') return 47
  if (prev.kind === 'dash') return 44
  return 56
}

function hitlag(ctx: SimContext, at: number, frames: number, label: string) {
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: frames,
    label,
  })
}

/** C4: the shield bursts (on expiry or when replaced), 400% ATK Geo */
function explode(ctx: SimContext, delay: number) {
  ctx.hit(delay, {
    characterKey: 'Noelle',
    path: ['constellation4', 'dmg'],
    tag: 'skill',
    element: 'geo',
    applies: true,
    durability: 50,
    icd: 'skill',
    blunt: true,
    poiseDamage: 100,
    label: 'Breastplate (C4)',
  })
  if (ctx.onField === 'Noelle')
    ctx.hit(delay, {
      characterKey: 'Noelle',
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: 13,
      extendsAction: true,
      label: 'Breastplate (C4) hitlag',
    })
}

export const kit: KitModel = {
  characterKey: 'Noelle',
  element: 'geo',
  source: `${GCSIM}/noelle`,
  init: (): NoelleState => ({
    burstEnd: -1,
    caToken: 0,
    caFinalStart: -1,
    caEnd: -1,
    caStart: -1,
    shieldToken: 0,
    a4Count: 0,
    a4Ready: -1,
    shieldUntil: -1,
    healChance: 0,
  }),
  onStart(ctx) {
    if (ctx.constellation('Noelle') >= 6)
      ctx.note(
        'Noelle C6: Sweeping Time is not extended (it needs defeated opponents; gcsim assumes 10 by default).'
      )
  },
  act(ctx, s: NoelleState, action, previous) {
    const burst = inBurst(ctx, s)
    const c = ctx.constellation('Noelle')
    switch (action.kind) {
      case 'normal': {
        // under Sweeping Time the normal attacks are Geo (ctx.infuse) with no ICD, and N3's
        // hitlag differs
        const hits = burst
          ? noelleNormals.map((h, i) => ({
              ...h,
              hitlag: [burstNormalHitlag[i]],
            }))
          : noelleNormals
        return normalString(
          hits,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: burst ? 'none' : 'normal',
              poiseDamage: (burst ? burstPoise : attackPoise)[i],
              label: `N${i + 1}`,
            }),
          ctx
        )
      }
      case 'charged': {
        const windup = caWindup(ctx, s, previous)
        const token = ++s.caToken
        s.caStart = ctx.now
        // the spin hit; the final at the spin's end (Noelle's clock: after the spin's hitlag)
        ctx.hit(windup + CA_SPIN_HIT, {
          path: ['charged', 'spinningDmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: burst ? 'none' : 'normal',
          poiseDamage: 60,
          label: 'Charged Attack (spin)',
        })
        hitlag(ctx, windup + CA_SPIN_HIT, CA_SPIN_LAG, 'Charged Attack hitlag')
        const finalAt = windup + CA_SPIN_END + CA_FINAL_HIT
        s.caFinalStart = ctx.now + windup + CA_SPIN_END + CA_SPIN_LAG
        ctx.atCharacter('Noelle', finalAt, (c2: SimContext) => {
          // a later action (another Charged Attack continuing the spin, or anything else) has
          // replaced this one before its final
          if (s.caToken !== token) return
          c2.hit(0, {
            path: ['charged', 'finalDmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: inBurst(c2, s) ? 'none' : 'normal',
            poiseDamage: 120,
            label: 'Charged Attack (final)',
          })
          hitlag(c2, 0, CA_FINAL_LAG, 'Charged Attack (final) hitlag')
        })
        const result = withHitlag(
          withHitlag(
            {
              frames: windup + CA_SPIN_END + 108,
              framesInto: {
                normal: windup + CA_SPIN_END + 106,
                charged: windup + CA_SPIN_HIT,
                skill: windup + CA_SPIN_END + 63,
                burst: windup + CA_SPIN_END + 63,
                dash: windup + CA_SPIN_HIT,
                jump: windup + CA_SPIN_HIT,
                swap: windup + CA_SPIN_HIT,
                wait: windup + CA_SPIN_HIT,
              },
            },
            { hitmarks: [windup + CA_SPIN_HIT], hitlag: [CA_SPIN_LAG] }
          ),
          // (the final lands after the spin's hitlag)
          { hitmarks: [finalAt + CA_SPIN_LAG], hitlag: [CA_FINAL_LAG] }
        )
        s.caEnd = ctx.now + result.frames
        return result
      }
      case 'plunge':
        // gcsim's low plunge (the rotation has no height)
        ctx.hit(39, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          poiseDamage: 150,
          label: 'Low Plunge',
        })
        return {
          frames: 80,
          framesInto: {
            normal: 51,
            charged: 51,
            skill: 51,
            burst: 50,
            dash: 39,
            swap: 62,
          },
        }
      case 'skill': {
        // Breastplate: the Geo hit at 14 frames (Noelle's clock, defense halt only); the shield
        // lasts 12 s
        ctx.hit(14, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'skill',
          blunt: true,
          poiseDamage: 100,
          label: 'Breastplate',
        })
        hitlag(ctx, 14, 4, 'Breastplate hitlag')
        s.a4Count = 0
        s.shieldUntil = ctx.now + 720
        if (c >= 4) {
          // C4: a shield still up bursts when replaced; this one bursts when it expires
          // (its breaking by damage is not modelled)
          if (s.shieldToken > 0) explode(ctx, 0)
          const token = ++s.shieldToken
          ctx.at(720, (c2) => {
            if (s.shieldToken !== token) return
            s.shieldToken = 0
            explode(c2, 0)
          })
        }
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 24 * 60, delay: 6 },
            frames: 78,
            framesInto: {
              normal: 12,
              charged: 13,
              skill: 14,
              burst: 14,
              dash: 11,
              jump: 11,
            },
          },
          { hitmarks: [14], hitlag: [4] }
        )
      }
      case 'burst': {
        // Sweeping Time: the DEF→ATK and Geo infusion for 980 frames on Noelle's clock (C6's
        // extension needs defeated opponents)
        s.burstEnd = ctx.characterFrame('Noelle') + BURST_DUR
        ctx.infuse('geo', 0, BURST_DUR + 1, 'Noelle')
        ctx.buff('Noelle', ['Noelle', 'SweepingTime'], 'on', 0, BURST_DUR + 1, {
          hitlag: 'recipient',
        })
        // the burst and skill parts at 24 and 65 frames (Noelle's clock), each 0.15 s + defense halt
        ctx.hit(24, {
          path: ['burst', 'burstDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          icd: 'burst',
          blunt: true,
          poiseDamage: 150,
          label: 'Sweeping Time',
        })
        hitlag(ctx, 24, 13, 'Sweeping Time hitlag')
        ctx.atCharacter('Noelle', 65, (c2) => {
          c2.hit(0, {
            path: ['burst', 'skillDmg'],
            tag: 'burst',
            element: 'geo',
            applies: true,
            icd: 'burst',
            blunt: true,
            poiseDamage: 150,
            label: 'Sweeping Time (skill)',
          })
          hitlag(c2, 0, 13, 'Sweeping Time hitlag')
        })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 121,
            framesInto: {
              normal: 83,
              charged: 82,
              skill: 82,
              dash: 81,
              jump: 81,
            },
          },
          { hitmarks: [24, 65], hitlag: [13, 13] }
        )
      }
      case 'dash':
        // the template's dash (girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // the template's jump: longer right after a dash
        return templateJump('girl', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onPartyAction(ctx, s: NoelleState, actor) {
    // any later action of Noelle's replaces the Charged Attack (its final no longer comes)
    if (actor === 'Noelle' && ctx.now > s.caStart) s.caToken++
  },
  onSwapOut(_ctx, s: NoelleState) {
    s.caToken++
  },
  onHit(ctx, s: NoelleState, hit) {
    if (
      hit.characterKey !== 'Noelle' ||
      (hit.tag !== 'normal' && hit.tag !== 'charged') ||
      hit.path[0].startsWith('_')
    )
      return
    // Breastplate: while it is up, her normal and charged attack hits may heal the party
    // (C1: always in Sweeping Time); the expected heals, the chance accumulated over the hits
    if (ctx.now < s.shieldUntil) {
      const level = ctx.calculate('Noelle', ['total', 'skillIndex'])
      const chance =
        ctx.constellation('Noelle') >= 1 && inBurst(ctx, s)
          ? 1
          : HEAL_CHANCE[Math.min(14, Math.max(0, level ?? 8))]
      s.healChance += chance
      if (s.healChance >= 1 - 1e-9) {
        s.healChance -= 1
        ctx.hit(0, {
          path: ['_heal', 'skill', 'heal'],
          tag: 'other',
          element: 'geo',
          healTargets: [...ctx.members],
          label: 'Breastplate (heal)',
        })
      }
    }
    // A4: every 4 normal or charged hits (one per 0.1 s) cut Breastplate's cooldown by 1 s
    if (ctx.now < s.a4Ready) return
    s.a4Ready = ctx.now + 6
    if (++s.a4Count < 4) return
    s.a4Count = 0
    ctx.reduceCooldown('skill', 60)
  },
}
