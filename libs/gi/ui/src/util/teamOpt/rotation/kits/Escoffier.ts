import type { KitModel, SimContext, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/escoffier, main as of 2026-11-10. */

/** Normal attack string: N3's two instances are the sheet's normal '2' and '3' */
const escoffierNormals: NormalHit[] = [
  {
    hitmarks: [7],
    hitlag: [8],
    toNormal: 17,
    toCharged: 20,
    toAbil: 7,
    frames: 22,
  },
  {
    hitmarks: [16],
    hitlag: [8],
    toNormal: 29,
    toCharged: 21,
    toAbil: 16,
    frames: 30,
  },
  {
    hitmarks: [27, 40],
    hitlag: [8, 8],
    toNormal: 62,
    toCharged: 62,
    toAbil: 40,
    frames: 62,
  },
]

/** Low-Temperature Cooking: the initial hit, then Cold Storage Mode's Frosty Parfait ticks */
const SKILL_HIT = 23
const TICK_FIRST = 148
const TICK_INTERVAL = 58.5
const TICKS = 21
/** Cold Storage Mode lasts from the first tick to the last one */
const COLD_DUR = TICK_FIRST + Math.ceil((TICKS - 1) * TICK_INTERVAL)
/** A Parfait hits this many frames after its tick (the travel time) */
const TRAVEL = 5
/** Surging Blade: at this frame, once per 10 s */
const BLADE_HIT = 83
const BLADE_ICD = 10 * 60
/** A4: a Skill or Burst hit shreds the enemy's Cryo and Hydro RES for 12 s */
const A4_DUR = 12 * 60

interface EscoffierState {
  /** The last cast (frame): older casts' ticks stop */
  healToken: number
  cast: number
  /** Cold Storage Mode ends (undefined: not in it) */
  coldEnd?: number
  /** The Surging Blade's ICD ends (frame) */
  bladeIcdEnd: number
  /** C6: Special-Grade Frozen Parfait triggers left, and its ICD ends (frame) */
  c6Count: number
  c6IcdEnd: number
}

/** A4: the shred from a Skill or Burst hit, `delay` frames from now */
const a4 = (ctx: SimContext, delay: number) =>
  ctx.buff('Escoffier', ['Escoffier', 'a4SkillBurstHit'], 'on', delay, A4_DUR)

export const kit: KitModel = {
  characterKey: 'Escoffier',
  element: 'cryo',
  source: `${GCSIM}/escoffier`,
  init: (): EscoffierState => ({
    cast: -1,
    healToken: 0,
    bladeIcdEnd: 0,
    c6Count: 0,
    c6IcdEnd: 0,
  }),
  act(ctx, s: EscoffierState, action, previous) {
    const c = ctx.constellation('Escoffier')
    switch (action.kind) {
      case 'normal':
        return normalString(
          escoffierNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${i + j}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(20, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          label: 'Charged Attack',
        })
        return {
          frames: 65,
          framesInto: {
            normal: 53,
            skill: 52,
            burst: 52,
            dash: 20,
            jump: 20,
            swap: 52,
          },
        }
      case 'plunge':
        // gcsim has low and high plunges (the rotation has no height): modelled as a low plunge
        ctx.hit(41, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 76,
          framesInto: { normal: 59, skill: 58, burst: 58, dash: 75, swap: 61 },
        }
      case 'skill': {
        ctx.hit(SKILL_HIT, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'skill',
          icdGroup: 'EscoffierSkill',
          label: 'Low-Temperature Cooking',
        })
        a4(ctx, SKILL_HIT)
        // Cold Storage Mode: a Parfait every 58.5 frames (21 ticks); a new cast stops the old ones
        const cast = ctx.now
        s.cast = cast
        s.coldEnd = cast + COLD_DUR
        for (let k = 0; k < TICKS; k++)
          ctx.at(TICK_FIRST + Math.ceil(TICK_INTERVAL * k), (c2) => {
            if (s.cast !== cast) return
            c2.hit(TRAVEL, {
              path: ['skill', 'parfaitDmg'],
              tag: 'skill',
              element: 'cryo',
              applies: true,
              icd: 'skill',
              icdGroup: 'EscoffierSkill',
              label: 'Frosty Parfait',
            })
            a4(c2, TRAVEL)
          })
        // Surging Blade (Arkhe is not modelled: gcsim has it as a TODO)
        ctx.at(BLADE_HIT, (c2) => {
          if (s.bladeIcdEnd > c2.now) return
          s.bladeIcdEnd = c2.now + BLADE_ICD
          c2.hit(0, {
            path: ['skill', 'bladeDmg'],
            tag: 'skill',
            element: 'cryo',
            applies: false,
            label: 'Surging Blade',
          })
          a4(c2, 0)
        })
        if (c >= 1)
          ctx.buff(
            'Escoffier',
            ['Escoffier', 'c1AfterSkillBurst'],
            'on',
            0,
            15 * 60
          )
        if (c >= 6) s.c6Count = 6
        return {
          cooldown: { key: 'skill', frames: 15 * 60, delay: 22 },
          frames: 35,
          framesInto: { normal: 32, burst: 32, swap: 31 },
        }
      }
      case 'burst': {
        const healToken = ++s.healToken
        ctx.hit(97, {
          path: ['_heal', 'burst', 'heal'],
          tag: 'other',
          element: 'physical',
          weight: ctx.members.length,
          label: 'Scoring Cuts (Heal)',
        })
        for (let i = 0; i < 9 + (c >= 4 ? 6 : 0); i++)
          ctx.at(157 + Math.ceil(58.5 * i), (c2) => {
            if (healToken !== s.healToken) return
            c2.hit(0, {
              path: ['_heal', 'passive1', 'heal'],
              tag: 'other',
              element: 'physical',
              label: 'Rehab Diet',
            })
          })
        ctx.hit(92, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          label: 'Scoring Cuts',
        })
        a4(ctx, 92)
        if (c >= 1)
          ctx.buff(
            'Escoffier',
            ['Escoffier', 'c1AfterSkillBurst'],
            'on',
            0,
            15 * 60
          )
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 110,
          framesInto: { skill: 109, swap: 108 },
        }
      }
      case 'dash':
        // the template's dash (girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // the template's jump: longer right after a dash
        return templateJump('girl', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: EscoffierState, hit: SimHit) {
    // C6: the active member's Normal, Charged and Plunging hits during Cold Storage Mode add a
    // Special-Grade Frozen Parfait (up to 6 per cast, 0.5 s ICD), 5 frames after the hit
    if (ctx.constellation('Escoffier') < 6) return
    if (s.coldEnd === undefined || hit.t >= s.coldEnd) return
    if (hit.characterKey !== hit.onField) return
    if (!['normal', 'charged', 'plunge'].includes(hit.tag)) return
    if (s.c6Count <= 0 || hit.t < s.c6IcdEnd) return
    s.c6Count--
    s.c6IcdEnd = hit.t + 30
    ctx.hit(TRAVEL, {
      characterKey: 'Escoffier',
      path: ['constellation6', 'dmg'],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      icd: 'skill',
      icdGroup: 'EscoffierSkill',
      label: 'Special-Grade Frozen Parfait (C6)',
    })
    a4(ctx, TRAVEL)
  },
  countedBuffs(hits, c) {
    // C2 Cold Dishes: the first 5 Cryo hits of the member on the field (not Escoffier's own),
    // Normal, Charged, Plunging, Skill or Burst, within 15 s of each cast; +240% ATK flat each
    if (c < 2) return { buffs: [], extraHits: [] }
    const covered = new Set<number>()
    hits.forEach((cast) => {
      if (
        cast.characterKey !== 'Escoffier' ||
        cast.path[0] !== 'skill' ||
        cast.path[1] !== 'skillDmg'
      )
        return
      // the cast's initial hit lands SKILL_HIT frames into it
      const start = cast.t - SKILL_HIT
      const end = start + 15 * 60
      let left = 5
      hits.forEach((h, i) => {
        if (left <= 0 || h.t < start || h.t >= end) return
        if (h.characterKey === 'Escoffier' || h.characterKey !== h.onField)
          return
        if (h.element !== 'cryo') return
        if (!['normal', 'charged', 'plunge', 'skill', 'burst'].includes(h.tag))
          return
        covered.add(i)
        left--
      })
    })
    return {
      buffs: [
        {
          owner: 'Escoffier',
          path: ['Escoffier', 'c2Stacks'],
          value: 'on',
          hits: covered,
        },
      ],
      extraHits: [],
    }
  },
}
