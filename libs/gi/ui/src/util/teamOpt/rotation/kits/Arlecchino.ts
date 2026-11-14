import type { RotationAction } from '../parse'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/arlecchino, main as of 2026-11-10. */

/** Six normal attack steps (the 4th has two instances: both on the sheet's node 3) */
const arleNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 11,
    toCharged: 17,
    toAbil: 11,
    frames: 24,
  },
  {
    hitmarks: [16],
    hitlag: [5],
    toNormal: 21,
    toCharged: 26,
    toAbil: 16,
    frames: 31,
  },
  {
    hitmarks: [17],
    hitlag: [5],
    toNormal: 31,
    toCharged: 33,
    toAbil: 17,
    frames: 39,
  },
  {
    hitmarks: [24, 35],
    hitlag: [4, 0],
    toNormal: 49,
    toCharged: 49,
    toAbil: 35,
    frames: 55,
  },
  { hitmarks: [21], toNormal: 30, toCharged: 33, toAbil: 21, frames: 43 },
  {
    hitmarks: [44],
    hitlag: [5],
    toNormal: 58,
    toCharged: 55,
    toAbil: 44,
    frames: 59,
  },
]

interface ArleState {
  /** The last action of this member (undefined after it swaps out) */
  last?: RotationAction
  /** The Blood-Debt Directive on the enemy: the Skill frame that set it; undefined: none */
  directive?: number
  /** The Skill cooldown's key: Balemoon Rising resets it, so a new key is ready at once */
  skillEpoch: number
  /** C2 Balemoon Bloodfire's ICD (until this frame) */
  c2Icd: number
  /** C6 ICD (until this frame) */
  c6Icd: number
  /** C4 ICD (until this frame) */
  c4Icd: number
  /** Bond of Life: the HP debt, as a fraction of Max HP (0 to 2) */
  debt: number
  /** The Skill's debt limit (1.45 Max HP) holds until this frame */
  limitUntil: number
  /** Debt gained since the Skill that set the limit */
  skillDebt: number
  /** Bond consumption's ICD (until this frame) */
  bondIcd: number
  /** Her last normal attack's animation ends (frame): gcsim's NormalAttackState until then */
  normalAnimEnd?: number
}

/** Masque of the Red Death: Normal Attacks are Pyro from 30% Bond of Life */
const MASQUE = 0.3 - 1e-9
const BOND_PATH = ['Arlecchino', 'bondPercent']
/** The sheet's Bond of Life state: the debt in 5% steps (10% to 200%) */
const bondState = (debt: number) =>
  `${Math.min(200, Math.max(10, Math.round(debt * 20) * 5))}`
/** The Bond of Life level a hit reads (the sheet's conditional, for that frame only) */
function bondWindow(c: SimContext, s: ArleState, minDebt: number) {
  if (s.debt >= minDebt)
    c.buff('Arlecchino', BOND_PATH, bondState(s.debt), 0, 1)
}

/** Blood-Debt Directive debt (of Max HP) by level */
const DIRECTIVE_DEBT = [0, 0.65, 1.3]

/** The previous action, if it was this member's own (undefined: a swap or another member's action came between) */
function ownPrevious(
  s: { last?: RotationAction },
  previous: RotationAction | undefined
): RotationAction | undefined {
  if (previous === undefined) return undefined
  // a wait is not a swap: look through it
  if (previous.kind === 'wait') return s.last
  return previous === s.last ? previous : undefined
}

/**
 * Balemoon Rising and a Charged Attack absorb the nearby directive: its Bond of Life (limited to
 * 1.45 Max HP per Skill), C4's refund and C2's Bloodfire (A1 assumed, as in Illuga's kit).
 */
function absorbDirective(c: SimContext, s: ArleState) {
  const src = s.directive
  if (src === undefined) return
  s.directive = undefined
  // the directive lasts 30 s
  if (c.now - src >= 1800) return
  const cons = c.constellation('Arlecchino')
  // A1 upgrades it after 5 s (C2: it starts upgraded)
  const level = cons >= 2 || c.now - src >= 300 ? 2 : 1
  let add = DIRECTIVE_DEBT[level]
  if (c.now < s.limitUntil) add = Math.min(1.45 - s.skillDebt, add)
  if (add > 0) {
    s.skillDebt += add
    s.debt = Math.min(2, s.debt + add)
    bondChanged(c)
  }
  if (cons >= 4 && c.now >= s.c4Icd) {
    s.c4Icd = c.now + 600
    c.reduceCooldown('burst', 120)
  }
  if (cons >= 2 && level >= 2 && c.now >= s.c2Icd) {
    s.c2Icd = c.now + 600
    c.hit(50, {
      path: ['constellation2', 'bloodfireDmg'],
      tag: 'other',
      element: 'pyro',
      applies: true,
      icd: 'none',
      label: 'Balemoon Bloodfire (C2)',
    })
  }
}

/** One Blood-Debt Directive tick (every 5 s, `count` left) while the directive from `src` stands */
function directiveTick(
  c: SimContext,
  s: ArleState,
  src: number,
  count: number
) {
  if (s.directive !== src) return
  c.hit(0, {
    path: ['skill', 'sigilDmg'],
    tag: 'skill',
    element: 'pyro',
    applies: true,
    icd: 'arlecchinoElementalArt',
    label: 'Blood-Debt Directive',
  })
  if (count > 1) c.at(300, (c2) => directiveTick(c2, s, src, count - 1))
}

/** Bond of Life changed (for Fragment of Harmonic Whimsy and the like) */
const bondChanged = (c: SimContext, delay = 0) =>
  c.hit(delay, {
    path: ['_marker', 'bondOfLife'],
    tag: 'other',
    element: 'physical',
    label: 'Bond of Life changed',
  })

export const kit: KitModel = {
  characterKey: 'Arlecchino',
  element: 'pyro',
  source: `${GCSIM}/arlecchino`,
  init: (): ArleState => ({
    skillEpoch: 0,
    c2Icd: -1e9,
    c6Icd: -1e9,
    c4Icd: -1e9,
    debt: 0,
    limitUntil: -1e9,
    skillDebt: 0,
    bondIcd: -1e9,
  }),
  act(ctx, s: ArleState, action, previous) {
    const own = ownPrevious(s, previous)
    s.last = action
    switch (action.kind) {
      case 'normal': {
        ctx.note(
          'Arlecchino: Bond of Life starts at 0% and is gained from the Blood-Debt Directive (absorbed by Charged Attacks and the burst); at 30%+ (Masque of the Red Death) Normal Attacks are Pyro with the bonus, each hit consuming 7.5% of the debt and cutting the Skill cooldown by 0.8 s.'
        )
        const result = normalString(
          arleNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.at(d, (c) => {
              const masque = s.debt >= MASQUE
              if (masque) bondWindow(c, s, MASQUE)
              c.hit(0, {
                path: ['normal', `${i}`],
                tag: 'normal',
                element: masque ? 'pyro' : 'physical',
                applies: true,
                icd: 'normal',
                label: `N${i + 1}`,
              })
              // Bond consumption (2-frame ICD): -7.5% of the debt, Skill cooldown -0.8 s
              if (masque && c.now >= s.bondIcd) {
                s.bondIcd = c.now + 2
                s.debt *= 0.925
                bondChanged(c)
                c.reduceCooldown(`skill${s.skillEpoch}`, 48)
              }
            }),
          ctx
        )
        s.normalAnimEnd = ctx.now + result.frames
        return result
      }
      case 'charged': {
        // Cancelled out of a Normal Attack (still in its animation: gcsim's NormalAttackState),
        // the windup is 12 frames shorter
        const w =
          own?.kind === 'normal' && ctx.now < (s.normalAnimEnd ?? -1) ? 12 : 0
        ctx.at(12 - w, (c2) => absorbDirective(c2, s))
        ctx.at(37 - w, (c2) => {
          // the sheet's Pyro infusion follows the Bond of Life state (Masque of the Red Death)
          const masque = s.debt >= MASQUE
          if (masque) bondWindow(c2, s, MASQUE)
          c2.hit(0, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: masque ? 'pyro' : 'physical',
            applies: true,
            icd: 'charged',
            icdGroup: 'PoleExtraAttack',
            label: 'Charged Attack',
          })
        })
        return withHitlag(
          {
            frames: 60 - w,
            framesInto: {
              normal: 42 - w,
              charged: 53 - w,
              skill: 42 - w,
              burst: 42 - w,
              dash: 37 - w,
              jump: 37 - w,
              swap: 58 - w,
              // (a written wait starts at CanQueueAfter: the hitmark)
              wait: 37 - w,
            },
          },
          { hitmarks: [37 - w], hitlag: [4] }
        )
      }
      case 'skill': {
        // All Is Ash: Spike (17), Cleave (38); the Cleave puts a Blood-Debt Directive on the enemy
        ctx.hit(17, {
          path: ['skill', 'spikeDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'arlecchinoElementalArt',
          label: 'All Is Ash (Spike)',
        })
        ctx.hit(38, {
          path: ['skill', 'finalDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          label: 'All Is Ash (Cleave)',
        })
        // the directive's 2 sigil ticks, 5 s apart from the Cleave; a new Skill replaces them
        ctx.at(38, (c2) => {
          const src = c2.now
          s.directive = src
          c2.at(300, (c3) => directiveTick(c3, s, src, 2))
        })
        // the Skill's debt limit (1.45 Max HP, 35 s) starts at 39
        ctx.at(39, (c2) => {
          s.limitUntil = c2.now + 2100
          s.skillDebt = 0
        })
        // C6: Normal and Burst CRIT +10% / +70% for 20 s after the Skill (15 s ICD); both are
        // hitlag-affected on her (her clock; the ICD is active on its expiry frame)
        if (ctx.constellation('Arlecchino') >= 6)
          ctx.at(38, (c2) => {
            const clock = c2.characterFrame('Arlecchino')
            if (clock < s.c6Icd) return
            s.c6Icd = clock + 901
            c2.buff(
              'Arlecchino',
              ['Arlecchino', 'c6AfterSkill'],
              'on',
              0,
              1201,
              {
                hitlag: 'recipient',
              }
            )
          })
        return withHitlag(
          {
            cooldown: { key: `skill${s.skillEpoch}`, frames: 1800, delay: 16 },
            frames: 77,
            framesInto: {
              normal: 70,
              charged: 65,
              burst: 70,
              dash: 72,
              jump: 73,
              swap: 60,
            },
          },
          { hitmarks: [38], hitlag: [4] }
        )
      }
      case 'burst':
        // Balemoon Rising (110); absorbs the directives at 22 (their sigil ticks stop)
        ctx.at(110, (c2) => {
          // C6's bonus reads the Bond of Life at the hit
          bondWindow(c2, s, 0.05)
          c2.hit(0, {
            path: ['burst', 'burstDmg'],
            tag: 'burst',
            element: 'pyro',
            applies: true,
            icd: 'none',
            label: 'Balemoon Rising',
          })
        })
        ctx.at(22, (c2) => absorbDirective(c2, s))
        // the burst's heal (1.5x the debt + 1.5x ATK) repays all of it
        ctx.at(123, (c2) => {
          if (s.debt > 0) bondChanged(c2)
          s.debt = 0
        })
        // it also resets the Skill's cooldown (at frame 107; the Skill can't come before frame 146 anyway)
        s.skillEpoch++
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 146,
          framesInto: {
            normal: 113,
            charged: 124,
            dash: 111,
            jump: 113,
            swap: 145,
          },
        }
      case 'plunge':
        // gcsim's low plunge (no collision); a plain "P" has no height in the rotation text
        ctx.at(47, (c2) => {
          const masque = s.debt >= MASQUE
          if (masque) bondWindow(c2, s, MASQUE)
          c2.hit(0, {
            path: ['plunging', 'low'],
            tag: 'plunge',
            element: masque ? 'pyro' : 'physical',
            applies: true,
            icd: 'none',
            label: 'Low Plunge',
          })
        })
        return {
          frames: 79,
          framesInto: {
            normal: 62,
            charged: 69,
            skill: 60,
            burst: 61,
            jump: 78,
            swap: 63,
          },
        }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // the jump is longer after a dash
        return templateJump('lady', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: ArleState, action) =>
    action.kind === 'skill'
      ? `skill${s.skillEpoch}`
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(_ctx, s: ArleState) {
    s.last = undefined
  },
}
