import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/baizhu, main as of 2026-11-10. */

const baizhuNormals: NormalHit[] = [
  { hitmarks: [17], toNormal: 22, toCharged: 19, toAbil: 17, frames: 33 },
  { hitmarks: [25], toNormal: 33, toCharged: 31, toAbil: 25, frames: 39 },
  { hitmarks: [23, 35], toNormal: 40, toCharged: 39, toAbil: 35, frames: 46 },
  { hitmarks: [30], toNormal: 67, toCharged: 57, toAbil: 30, frames: 62 },
]

/** Universal Diagnosis: 10 s per charge; the cooldown starts 23 frames after the cast */
const SKILL_CD = 600
const SKILL_CD_DELAY = 23
const BURST_CD = 1200
/** Seamless Shield lasts 152 frames; a refresh replaces the shield */
const SHIELD_DURATION = 152
/** Spiritvein: snapshot 21 frames after its shield event, lands 8 frames later */
const SPIRITVEIN_DELAY = 29
/** A4 (Year of Verdant Favor): 6 s after a Seamless Shield heal */
const A4_DURATION = 360
/** C2 (Gossamer Sprite: Splice): once every 5 s */
const C2_ICD = 300

interface BaizhuState {
  /** Universal Diagnosis charges (undefined until the first use) */
  charges?: number
  /** Frame the next charge comes back (undefined: all charges are back) */
  restoreAt?: number
  /** Seamless Shield: a replaced shield does not expire (its version no longer matches) */
  shieldVersion: number
  shieldExpiry?: number
  /** C2's 5 s ICD runs until this frame */
  c2Until: number
}

const maxCharges = (ctx: SimContext) =>
  ctx.constellation('Baizhu') >= 1 ? 2 : 1

/** Brings the skill's charges up to now; returns the charges before the next use */
function settleCharges(ctx: SimContext, s: BaizhuState): number {
  const max = maxCharges(ctx)
  if (s.charges === undefined) s.charges = max
  let charges = s.charges
  let restoreAt = s.restoreAt
  while (charges < max && restoreAt !== undefined && restoreAt <= ctx.now) {
    charges++
    restoreAt = charges < max ? restoreAt + SKILL_CD : undefined
  }
  s.charges = charges
  s.restoreAt = restoreAt
  return charges
}

/** Spiritvein: the Dendro DMG of a Seamless Shield's summon or expiry */
function spiritvein(ctx: SimContext) {
  ctx.hit(SPIRITVEIN_DELAY, {
    path: ['burst', 'dmg'],
    tag: 'burst',
    element: 'dendro',
    applies: true,
    icd: 'none',
    label: 'Spiritvein',
  })
}

/** Seamless Shield heal: starts A4's 6 s buff (the heal goes to the active member) */
function shieldHeal(ctx: SimContext) {
  ctx.buff('Baizhu', ['Baizhu', 'a4AfterHeal'], 'on', 0, A4_DURATION)
  ctx.hit(0, {
    path: ['_heal', 'burst', 'heal'],
    tag: 'other',
    element: 'dendro',
    label: 'Holistic Revivification healing',
  })
}

/**
 * summonSeamlessShield: an existing shield gives a Spiritvein and is replaced; a shield that runs
 * out heals and gives a Spiritvein
 */
function seamlessShield(ctx: SimContext, s: BaizhuState) {
  if (s.shieldExpiry !== undefined && s.shieldExpiry > ctx.now) spiritvein(ctx)
  const version = ++s.shieldVersion
  s.shieldExpiry = ctx.now + SHIELD_DURATION
  ctx.at(SHIELD_DURATION, (c2) => {
    if (s.shieldVersion !== version) return
    s.shieldExpiry = undefined
    shieldHeal(c2)
    spiritvein(c2)
  })
}

export const kit: KitModel = {
  characterKey: 'Baizhu',
  element: 'dendro',
  source: `${GCSIM}/baizhu`,
  init: (): BaizhuState => ({ shieldVersion: 0, c2Until: -1 }),
  act(ctx, s: BaizhuState, action, previous) {
    // A1 (Five Fortunes Forever): Dendro DMG +25% while the active member's HP is at 50% or more,
    // Healing Bonus +20% below (gcsim; full HP unless the HP model says otherwise)
    const ratio = ctx.healthTracked ? (ctx.hpRatio(ctx.onField) ?? 1) : 1
    ctx.state(
      'Baizhu',
      ['Baizhu', 'a1HpStatus'],
      ratio >= 0.5 ? 'above' : 'below'
    )
    const c = ctx.constellation('Baizhu')
    switch (action.kind) {
      case 'normal':
        return normalString(
          baizhuNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'dendro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // gcsim: the charge's hitmark and frames come 14 frames earlier after a normal attack
        const windup = previous?.kind === 'normal' ? 14 : 0
        ctx.hit(59 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return {
          frames: 75 - windup,
          framesInto: {
            normal: 70 - windup,
            charged: 70 - windup,
            skill: 69 - windup,
            burst: 70 - windup,
            dash: 53 - windup,
            jump: 53 - windup,
            swap: 68 - windup,
          },
        }
      }
      case 'skill': {
        const charges = settleCharges(ctx, s)
        if (charges === 0)
          return {
            frames: 0,
            failed: 'Baizhu: no Universal Diagnosis charge',
          }
        s.charges = charges - 1
        // gcsim's chain: 3 hits, 48 frames apart (a hop to another target adds 6 frames: not
        // modelled, the hits stay on the target)
        ctx.hit(13, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'skill',
          label: 'Universal Diagnosis (1st)',
        })
        ctx.hit(61, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'skill',
          label: 'Universal Diagnosis (2nd)',
        })
        ctx.hit(109, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'skill',
          label: 'Universal Diagnosis (3rd)',
        })
        // Returns 51 frames after the third hit, healing the whole party. Overhealing
        // counts for Clam; the damage formula reads the healing node with the optimized stats.
        ctx.hit(160, {
          path: ['_heal', 'skill', 'heal'],
          tag: 'other',
          element: 'dendro',
          weight: (
            [
              'anemo',
              'geo',
              'electro',
              'dendro',
              'hydro',
              'pyro',
              'cryo',
            ] as const
          ).reduce((count, element) => count + ctx.partyCount(element), 0),
          label: 'Universal Diagnosis healing',
        })
        // C6: the first hit makes a Seamless Shield
        if (c >= 6) ctx.at(13, (c2) => seamlessShield(c2, s))
        const restoreAt = s.restoreAt ?? ctx.now + SKILL_CD_DELAY + SKILL_CD
        s.restoreAt = restoreAt
        const result: ActionResult = {
          frames: 47,
          framesInto: {
            normal: 49,
            charged: 48,
            skill: 40,
            burst: 30,
            dash: 29,
            jump: 29,
            swap: 28,
          },
        }
        // no charge left: the next cast waits for the first one back (cooldownKey)
        if (s.charges === 0)
          result.cooldown = { key: 'skill', frames: restoreAt - ctx.now }
        return result
      }
      case 'burst':
        // no damage of its own (gcsim's Q-Start is not implemented): the Seamless Shield's
        // Spiritveins and heals. Its first shield lands at 81 frames, refreshed 5 times, 146 apart
        ctx.at(81, (c2) => seamlessShield(c2, s))
        for (let i = 0; i < 5; i++)
          ctx.at(81 + 142 + 146 * i, (c2) => {
            seamlessShield(c2, s)
            shieldHeal(c2)
          })
        // C4: +80 Elemental Mastery to the party for 15 s
        if (c >= 4) ctx.buff('Baizhu', ['Baizhu', 'c4AfterBurst'], 'on', 0, 900)
        return {
          cooldown: { key: 'burst', frames: BURST_CD },
          frames: 104,
          framesInto: {
            normal: 104,
            charged: 105,
            skill: 104,
            burst: 105,
            dash: 105,
            jump: 104,
            swap: 102,
          },
        }
      case 'dash':
        // Male body (gcsim's template): 19 frames, 3 to a jump
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // Male body: 28 frames, 37 after a dash
        return templateJump('male', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Universal Diagnosis waits for a charge; the burst for its cooldown
  cooldownKey: (s: BaizhuState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.charges === 0
        ? 'skill'
        : undefined,
  onHit(ctx, s: BaizhuState, hit) {
    if (ctx.constellation('Baizhu') < 2) return
    // C2: a hit by the active character (Baizhu included) makes a Gossamer Sprite: Splice
    if (hit.characterKey !== hit.onField || hit.t < s.c2Until) return
    s.c2Until = hit.t + C2_ICD
    ctx.hit(13, {
      characterKey: 'Baizhu',
      path: ['constellation2', 'dmg'],
      tag: 'skill',
      element: 'dendro',
      applies: true,
      // gcsim's ICDGroupBaizhuC2 (its own group)
      icd: 'baizhuC2',
      label: 'Gossamer Sprite: Splice (C2)',
    })
    // C6: the Splice's hit makes a Seamless Shield
    if (ctx.constellation('Baizhu') >= 6)
      ctx.at(13, (c2) => seamlessShield(c2, s))
  },
}
