import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/beidou, main as of 2026-11-10. */

// Hitmarks are damage frames (no travel). Cancels: into a skill, burst, dash, jump or swap at the
// hitmark, into a normal or charged attack at the end of the animation.
const beidouNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [9],
    toNormal: 31,
    toCharged: 31,
    toAbil: 23,
    frames: 31,
  },
  {
    hitmarks: [22],
    hitlag: [11],
    toNormal: 36,
    toCharged: 36,
    toAbil: 22,
    frames: 36,
  },
  {
    hitmarks: [45],
    hitlag: [9],
    toNormal: 54,
    toCharged: 54,
    toAbil: 45,
    frames: 54,
  },
  {
    hitmarks: [25],
    hitlag: [9],
    toNormal: 36,
    toCharged: 36,
    toAbil: 25,
    frames: 36,
  },
  {
    hitmarks: [43],
    hitlag: [11],
    toNormal: 96,
    toCharged: 96,
    toAbil: 43,
    frames: 96,
  },
]

/** Stormbreaker lasts 15 s from the burst */
const stormbreakerFrames = 900

/**
 * Polaris (Revelation): a held Tidecaller gains a stack every 0.8 s even when not attacked; the
 * rotation's hold is held for 2 stacks (the maximum DMG Bonus). Neither gcsim nor the pinned
 * kqmsim models it (their hold is the tap), so the 96-frame hold before the tap's release
 * timeline is an estimate from the game text.
 */
const POLARIS_HOLD = 96

interface BeidouState {
  /** Stormbreaker is up until this frame */
  burstEnd: number
  /** The bounce chain's 60-frame ICD: no new chain before this frame */
  icdEnd: number
  /** Polaris' CD reduction (once per 15 s) is ready again at this frame */
  polarisReady: number
  /** The burst's cast (its discharges' snapshot) */
  castSnapshot?: { t: number; onField: SimContext['onField'] }
}

export const kit: KitModel = {
  characterKey: 'Beidou',
  element: 'electro',
  source: `${GCSIM}/beidou`,
  init: (): BeidouState => ({
    burstEnd: -1,
    icdEnd: -1e9,
    polarisReady: -1e9,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default): Polaris and C6's Stellar-Conduct radiance
    ctx.state('Beidou', ['Beidou', 'lockRevelation'], 'on')
  },
  act(ctx, s: BeidouState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          beidouNormals,
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
        // gcsim has no Beidou charged attack (its template errors): no damage, no frames
        ctx.note('Beidou: the charged attack is not in gcsim; not modelled')
        return { frames: 30 }
      case 'skill': {
        // Tap: the base hit. Hold (Polaris): 2 stacks after 1.6 s, then the same release
        const hold = action.hold ? POLARIS_HOLD : 0
        const hitmark = hold + 23
        ctx.hit(hitmark, {
          path: ['skill', hold ? 'dmgTwoHits' : 'baseDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: hold ? 'Tidecaller (2 stacks)' : 'Tidecaller',
        })
        // The blunt hit's pause: 0.09 s (0.15 s at the maximum bonus) plus the defense halt
        const pause = hold ? 13 : 9
        ctx.hit(hitmark, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: pause,
          label: 'Tidecaller hitlag',
        })
        if (hold) {
          // A4 (Lightning Storm): the maximum DMG Bonus gives Normal and Charged Attacks +15%
          // DMG and ATK SPD for 10 s
          ctx.buff('Beidou', ['Beidou', 'Ascension4'], 'on', hitmark, 600, {
            hitlag: 'recipient',
          })
          ctx.at(hitmark, (c) => c.modifyAttackSpeed('BeidouA4', 0.15, 600))
          // Polaris: on hit, each stack cuts the skill CD by 4 s (once per 15 s)
          ctx.at(hitmark, (c) => {
            if (c.now < s.polarisReady) return
            s.polarisReady = c.now + 900
            c.reduceCooldown('skill', 2 * 240)
          })
        }
        ctx.note(
          'Beidou: A1 (perfect counter) and C4 (being hit) need enemy attacks; not modelled'
        )
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 450, delay: hold + 4 },
            frames: hold + 45,
            framesInto: {
              normal: hold + 44,
              dash: hold + 24,
              jump: hold + 24,
              swap: hold + 44,
            },
          },
          { hitmarks: [hitmark], hitlag: [pause] }
        )
      }
      case 'burst':
        ctx.hit(28, {
          path: ['burst', 'burstDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 100,
          label: 'Stormbreaker',
        })
        // the initial hit's pause (0.1 s, no defense halt)
        ctx.hit(28, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 6,
          label: 'Stormbreaker hitlag',
        })
        s.burstEnd = ctx.now + stormbreakerFrames
        // The discharges use the stats at the cast (gcsim snapshots them then)
        s.castSnapshot = { t: ctx.now, onField: ctx.onField }
        // the sheet's burst condition (C6's RES shred): gcsim applies it every 0.5 s from 30
        // frames, each for 1.5 s, so from 30 frames to 1.5 s past the last
        ctx.buff(
          'Beidou',
          ['Beidou', 'burst'],
          'on',
          30,
          stormbreakerFrames + 60
        )
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 1200 },
            frames: 58,
            framesInto: { normal: 55, dash: 48, jump: 48, swap: 46 },
          },
          { hitmarks: [28], hitlag: [6] }
        )
      case 'plunge':
        // not in gcsim (no plunge frames): not modelled
        ctx.note('Beidou: the plunge is not in gcsim; not modelled')
        return { frames: 30 }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: BeidouState, hit) {
    // C6 (Revelation): Stellar-Conduct radiance inside a Polestar Field
    ctx.state(
      'Beidou',
      ['Beidou', 'lockStellarRadianceSc'],
      ctx.radiance === 'conduct' ? 'on' : ''
    )
    // Stormbreaker: a Normal or Charged Attack hit by the character on the field starts a chain
    if (hit.characterKey !== hit.onField) return
    if (hit.tag !== 'normal' && hit.tag !== 'charged') return
    if (hit.t >= s.burstEnd || hit.t < s.icdEnd) return
    s.icdEnd = hit.t + 60
    // This simulator has one enemy. The chain needs a DIFFERENT enemy for each bounce
    // (kqmsim burst.go); C2 does not multiply damage against a lone target.
    ctx.hit(1, {
      characterKey: 'Beidou',
      path: ['burst', 'lightningDmg'],
      tag: 'burst',
      element: 'electro',
      applies: true,
      durability: 25,
      icd: 'burst',
      label: 'Stormbreaker (single target)',
      statSnapshots: s.castSnapshot
        ? (
            [
              'atk',
              'critRate_',
              'critDMG_',
              'all_dmg_',
              'burst_dmg_',
              'electro_dmg_',
            ] as const
          ).map((stat) => ({
            stat,
            path: ['total', stat],
            ...s.castSnapshot!,
          }))
        : undefined,
    })
  },
}
