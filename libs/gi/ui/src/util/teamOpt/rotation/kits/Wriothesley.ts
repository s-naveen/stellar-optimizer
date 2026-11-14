import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/wriothesley, main as of 2026-11-10. */

/*
 * The Revelation (There Shall Be an Unveiling for Injustice) follows upstream gcsim b107b5d (the
 * pinned kqmsim has none of it): in a Polestar Field (Stellar-Conduct radiance) Chilling
 * Penalty's N3 / N5 become Stellar-Conduct DMG (60% / 80%; C2 at 5 Edict stacks: 90% / 120%),
 * and below 60% HP the charged attack is Luster: Vaulting Fist (Stellar-Conduct DMG, heals 30%
 * Max HP, 2 s ICD), with C1's 5 s cross bonuses and C6's extra 60% hits. Outside radiance, C2 at
 * 5 Edict stacks makes Chilling Penalty's normals deal 125% and charged attacks 130% (the sheet).
 * HP thresholds need health tracking (A1's Rebuke and Luster are skipped without it).
 */

// Hitlag per hit: gcsim's halt frames plus its default defense halt (defhalt=true: +3.6 frames on
// normals, which can be defense-halted), rounded up as gcsim applies it
const wrioNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [4],
    toNormal: 14,
    toCharged: 23,
    toAbil: 12,
    frames: 27,
  },
  {
    hitmarks: [10],
    hitlag: [4],
    toNormal: 13,
    toCharged: 20,
    toAbil: 10,
    frames: 25,
  },
  {
    hitmarks: [18],
    hitlag: [6],
    toNormal: 24,
    toCharged: 19,
    toAbil: 18,
    frames: 41,
  },
  {
    hitmarks: [25, 35],
    hitlag: [4, 4],
    toNormal: 41,
    toCharged: 41,
    toAbil: 35,
    frames: 56,
  },
  {
    hitmarks: [39],
    hitlag: [8],
    toNormal: 59,
    toCharged: 39,
    toAbil: 39,
    frames: 57,
  },
]

/** Icefang Rush: 10 s (C1 extends it by 4 s, once per cast); its cooldown is 16 s */
const SKILL_DURATION = 601
const SKILL_CD = 960
const C1_EXTENSION = 240
/** Chilling Penalty: a drain at most every 6 frames, and each drain is a Prosecution Edict stack */
const DRAIN_ICD = 6
const EDICT_MAX = 5
/** C1: Gracious Rebuke's 2.5 s ICD (from its hit) */
const C1_ICD = 150

interface WriothesleyState {
  /** Icefang Rush runs until this frame (the enhanced normal attacks) */
  skillEnd: number
  /** The Prosecution Edict stacks' ATK runs until this frame (it is not cut short by a swap) */
  edictEnd: number
  edictStacks: number
  /** Chilling Penalty's drain ICD runs until this frame */
  drainIcd: number
  /** C1's extension of Icefang Rush has been used this cast */
  c1Extended: boolean
  /** C1: the next Charged Attack is a Rebuke (the fifth Repelling Fist made it) */
  c1Rebuke: boolean
  /** C1: the Rebuke's ICD runs until this frame */
  c1IcdUntil: number
  /** A1: Gracious Rebuke's 5 s ICD (without C1) runs until this frame */
  a1IcdUntil: number
  /** Revelation: Luster's 2 s heal ICD runs until this frame */
  lusterHealIcd: number
  /** C1 (Revelation): the next Stellar N5 within 5 s of a Luster hit deals +50% */
  c1LusterUntil: number
  /** C1 (Revelation): Lusters within 5 s of a Stellar N5 hit deal +50% */
  c15HitUntil: number
}

/**
 * C1: Chilling Penalty is extended by 4 s (once per cast), and its Prosecution Edict stacks
 * (the ATK and C2's burst bonus) with it
 */
function extendPenalty(ctx: SimContext, s: WriothesleyState) {
  s.c1Extended = true
  s.skillEnd += C1_EXTENSION
  s.edictEnd += C1_EXTENSION
  // (a lone '1' window would be counted as a second stack by the engine's stack rule)
  if (s.edictStacks > 1)
    ctx.buff(
      'Wriothesley',
      ['Wriothesley', 'a4EdictStacks'],
      String(s.edictStacks),
      0,
      Math.max(0, s.edictEnd - ctx.now),
      { hitlag: 'recipient' }
    )
}

/** Radiance: Stellar-Conduct (in a Polestar Field) */
const stellar = (ctx: { radiance?: string }) => ctx.radiance === 'conduct'
const RADIANCE = {
  owner: 'Wriothesley' as const,
  path: ['Wriothesley', 'lockStellarRadianceSc'],
  value: 'on',
}

export const kit: KitModel = {
  characterKey: 'Wriothesley',
  element: 'cryo',
  source: `${GCSIM}/wriothesley`,
  init: (): WriothesleyState => ({
    skillEnd: -1,
    edictEnd: -1,
    edictStacks: 0,
    drainIcd: -1,
    c1Extended: false,
    c1Rebuke: false,
    c1IcdUntil: -1,
    a1IcdUntil: -1,
    lusterHealIcd: -1,
    c1LusterUntil: -1,
    c15HitUntil: -1,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default)
    ctx.state('Wriothesley', ['Wriothesley', 'lockRevelation'], 'on')
  },
  onHit(ctx, s: WriothesleyState, hit) {
    ctx.state(
      'Wriothesley',
      ['Wriothesley', 'lockStellarRadianceSc'],
      stellar(ctx) ? 'on' : ''
    )
    // Chilling Penalty: Repelling Fists (their Stellar N3 / N5 too) drain HP
    const repelling =
      hit.path[0] === 'skill'
        ? hit.path[1]?.startsWith('enhanced_')
        : hit.path[0] === 'passive1' &&
          (hit.path[1] === 'hit3' || hit.path[1] === 'hit5')
    if (
      hit.characterKey !== 'Wriothesley' ||
      !repelling ||
      ctx.now >= s.skillEnd ||
      ctx.now < s.drainIcd
    )
      return
    s.drainIcd = ctx.now + DRAIN_ICD
    // Damage is resolved before Chilling Penalty drains HP and grants its next Edict.
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Wriothesley',
        path: ['Wriothesley', 'a4EdictStacks'],
        value: String(s.edictStacks),
      },
    ]
    s.edictStacks = Math.min(EDICT_MAX, s.edictStacks + 1)
    ctx.buff(
      'Wriothesley',
      ['Wriothesley', 'a4EdictStacks'],
      String(s.edictStacks),
      0,
      Math.max(0, s.edictEnd - ctx.now),
      { hitlag: 'recipient' }
    )
    if (ctx.healthTracked) ctx.drainHp('Wriothesley', 0.045)
    else
      ctx.hit(1, {
        path: ['_marker', 'hpChange'],
        tag: 'other',
        element: 'physical',
        label: 'Chilling Penalty',
      })
  },
  onHpChange(ctx, s: WriothesleyState, change) {
    if (
      change.characterKey !== 'Wriothesley' ||
      ctx.onField !== 'Wriothesley' ||
      change.amount <= 0 ||
      ctx.now >= s.skillEnd
    )
      return
    if (change.kind === 'drain' && change.source === 'Wriothesley') return
    s.edictStacks = Math.min(EDICT_MAX, s.edictStacks + 1)
    ctx.buff(
      'Wriothesley',
      ['Wriothesley', 'a4EdictStacks'],
      String(s.edictStacks),
      0,
      Math.max(0, s.edictEnd - ctx.now),
      { hitlag: 'recipient' }
    )
  },
  act(ctx, s: WriothesleyState, action, previous) {
    const c = ctx.constellation('Wriothesley')
    switch (action.kind) {
      case 'normal':
        return normalString(
          wrioNormals,
          action.count ?? 1,
          (i, d) => {
            const t = ctx.now + d
            // Icefang Rush enhances the normal attacks (its HP > 50% condition is not tracked)
            const enhanced =
              t < s.skillEnd && (ctx.hpRatio('Wriothesley') ?? 1) > 0.5
            // Revelation: in Stellar-Conduct radiance, N3 / N5 become Stellar-Conduct DMG
            if (enhanced && stellar(ctx) && (i === 2 || i === 4)) {
              const n5 = i === 4
              const c1Luster = n5 && c >= 1 && t < s.c1LusterUntil
              if (c1Luster) s.c1LusterUntil = -1
              ctx.hit(d, {
                path: ['passive1', n5 ? 'hit5' : 'hit3'],
                tag: 'directStellarConduct',
                element: 'cryo',
                applies: false,
                label: `Repelling Fist ${i + 1} (Stellar-Conduct)`,
                states: [
                  RADIANCE,
                  {
                    owner: 'Wriothesley',
                    path: ['Wriothesley', 'c1Luster'],
                    value: c1Luster ? 'on' : '',
                  },
                ],
              })
              if (n5) {
                // C6: an extra 60% hit (deployable)
                if (c >= 6)
                  ctx.hit(d, {
                    path: ['constellation6', 'hit5'],
                    tag: 'directStellarConduct',
                    element: 'cryo',
                    applies: false,
                    label: 'Repelling Fist 5 (C6, Stellar-Conduct)',
                    states: [RADIANCE],
                  })
                // C1 (Revelation): Lusters within 5 s deal +50% (instead of a Rebuke)
                if (c >= 1) s.c15HitUntil = t + 301
              }
              return
            }
            // C1: the fifth hit of a Repelling Fist during Icefang Rush makes a Gracious Rebuke
            if (i === 4 && enhanced && c >= 1 && t >= s.c1IcdUntil)
              s.c1Rebuke = true
            ctx.hit(d, {
              path: enhanced ? ['skill', `enhanced_${i}`] : ['normal', `${i}`],
              tag: 'normal',
              element: 'cryo',
              applies: true,
              icd: 'normal',
              label: enhanced ? `Repelling Fist ${i + 1}` : `N${i + 1}`,
            })
          },
          ctx
        )
      case 'charged': {
        ctx.hit(19, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 7,
          label: 'Charged attack hitlag',
        })
        const hp = ctx.hpRatio('Wriothesley')
        // Revelation (A1, radiance): below 60% HP, Luster: Vaulting Fist (Stellar-Conduct DMG)
        if (stellar(ctx) && hp !== undefined && hp < 0.6) {
          const c15 = c >= 1 && ctx.now + 19 < s.c15HitUntil
          if (c15) s.c15HitUntil = -1
          ctx.hit(19, {
            path: ['passive1', 'lusterDmg'],
            tag: 'directStellarConduct',
            blunt: true,
            poiseDamage: 110,
            element: 'cryo',
            applies: false,
            label: 'Luster: Vaulting Fist (Stellar-Conduct)',
            states: [
              RADIANCE,
              {
                owner: 'Wriothesley',
                path: ['Wriothesley', 'c15Hit'],
                value: c15 ? 'on' : '',
              },
            ],
          })
          // C6: an extra 60% hit while in Chilling Penalty
          if (c >= 6 && ctx.now + 19 < s.skillEnd)
            ctx.hit(19, {
              path: ['constellation6', 'lusterDmg'],
              tag: 'directStellarConduct',
              element: 'cryo',
              applies: false,
              label: 'Luster: Vaulting Fist (C6, Stellar-Conduct)',
              states: [RADIANCE],
            })
          ctx.at(19, (c2) => {
            // the heal (30% Max HP, 2 s ICD)
            if (c2.now >= s.lusterHealIcd) {
              s.lusterHealIcd = c2.now + 121
              c2.healPercent('Wriothesley', 0.3, ['Wriothesley'])
            }
            // C1 (Revelation): the next Stellar N5 within 5 s deals +50%; once per Chilling
            // Penalty, it is extended by 4 s
            if (c >= 1) {
              s.c1LusterUntil = c2.now + 301
              if (!s.c1Extended && c2.now < s.skillEnd) {
                s.c1Extended = true
                extendPenalty(c2, s)
              }
            }
          })
          return withHitlag(
            {
              frames: 51,
              framesInto: {
                normal: 52,
                charged: 52,
                skill: 52,
                burst: 52,
                dash: 19,
                jump: 19,
                swap: 49,
              },
            },
            { hitmarks: [19], hitlag: [8] }
          )
        }
        // A1 (without C1): below 60% HP, the next charged attack is Rebuke: Vaulting Fist (+50%
        // DMG, heals 30% Max HP; once per 5 s)
        if (c < 1 && hp !== undefined && hp < 0.6 && ctx.now >= s.a1IcdUntil) {
          ctx.hit(19, {
            path: ['charged', 'rebukeDmg'],
            tag: 'charged',
            blunt: true,
            poiseDamage: 110,
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Rebuke: Vaulting Fist',
          })
          ctx.at(19, (c2) => {
            s.a1IcdUntil = c2.now + 301
            c2.healPercent('Wriothesley', 0.3, ['Wriothesley'])
          })
        } else if (s.c1Rebuke && c >= 1) {
          // Rebuke: Vaulting Fist (C1: +200% DMG, from the sheet's rebukeDmg)
          s.c1Rebuke = false
          ctx.hit(19, {
            path: ['charged', 'rebukeDmg'],
            tag: 'charged',
            blunt: true,
            poiseDamage: 110,
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Rebuke: Vaulting Fist (C1)',
          })
          // C6: an extra icicle of the Rebuke's base DMG
          if (c >= 6)
            ctx.hit(19, {
              path: ['constellation6', 'icicleDmg'],
              tag: 'charged',
              blunt: true,
              poiseDamage: 110,
              element: 'cryo',
              applies: true,
              icd: 'none',
              label: 'Rebuke icicle (C6)',
            })
          // its hit starts the 2.5 s ICD and, once per Icefang Rush, extends it by 4 s
          ctx.at(19, (c2) => {
            s.c1IcdUntil = c2.now + C1_ICD
            if (!s.c1Extended && c2.now < s.skillEnd) {
              s.c1Extended = true
              extendPenalty(c2, s)
            }
          })
        } else
          ctx.hit(19, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            blunt: true,
            poiseDamage: 110,
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Charged Attack',
          })
        return withHitlag(
          {
            frames: 51,
            framesInto: {
              normal: 52,
              charged: 52,
              skill: 52,
              burst: 52,
              dash: 19,
              jump: 19,
              swap: 49,
            },
          },
          { hitmarks: [19], hitlag: [7] }
        )
      }
      case 'skill': {
        // Icefang Rush: no damage of its own; it enhances the normal attacks, and the Prosecution
        // Edict stacks start over
        s.skillEnd = ctx.now + SKILL_DURATION
        s.edictEnd = ctx.now + SKILL_DURATION
        s.edictStacks = 0
        ctx.state('Wriothesley', ['Wriothesley', 'a4EdictStacks'], '')
        s.c1Extended = false
        const result: ActionResult = {
          frames: 29,
          framesInto: {
            normal: 15,
            charged: 29,
            skill: 29,
            burst: 5,
            dash: 21,
            jump: 20,
            swap: 19,
          },
          cooldown: { key: 'skill', frames: SKILL_CD, delay: 1 },
        }
        return result
      }
      case 'burst': {
        // Darkgold Wolfbite: 5 hits, then the Surging Blade (no Durability)
        for (const d of [99, 104, 109, 114, 119])
          ctx.hit(d, {
            path: ['burst', 'skillDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Darkgold Wolfbite',
          })
        ctx.hit(160, {
          path: ['burst', 'bladeDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: false,
          icd: 'none',
          label: 'Surging Blade',
        })
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 133,
          framesInto: {
            normal: 133,
            charged: 133,
            skill: 133,
            burst: 133,
            dash: 133,
            jump: 133,
            swap: 94,
          },
        }
      }
      case 'plunge':
        // gcsim's Low Plunge (collision off, its default); the High Plunge needs Xianyun's
        // airborne state, which the rotation text can't give
        ctx.hit(44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 75,
          framesInto: {
            normal: 62,
            charged: 75,
            skill: 63,
            burst: 64,
            dash: 44,
            jump: 75,
            swap: 49,
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
  onSwapOut(ctx, s: WriothesleyState) {
    // leaving the field ends Icefang Rush (its enhancement; the Edict ATK stays)
    s.skillEnd = ctx.now
  },
}
