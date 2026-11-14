import type { KitModel, SimContext, SimCountedBuff } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kokomi, main as of 2026-11-10. */

// Damage lands at the hitmark + 10 frames of travel; cancels are from the hitmark
const kokomiNormals: NormalHit[] = [
  { hitmarks: [12], toNormal: 14, toCharged: 19, toAbil: 2, frames: 30 },
  { hitmarks: [19], toNormal: 30, toCharged: 34, toAbil: 9, frames: 34 },
  { hitmarks: [36], toNormal: 65, toCharged: 60, toAbil: 26, frames: 65 },
]

/** The Ceremonial Garment lasts 10 s (and ends when she leaves the field: see countedBuffs) */
const garmentFrames = 600
/** Bake-Kurage lasts 12.5 s from the cast */
const kurageFrames = 751

interface KokomiState {
  /** The Ceremonial Garment is up until this frame */
  burstEnd: number
  /** Bake-Kurage is up until this frame */
  kurageEnd: number
  /** The current Bake-Kurage's tick chain: a new cast stops the old chain */
  kurageId: number
  /** Swapped out since the last action */
  away: boolean
}

/**
 * Bake-Kurage snapshots its stats at the cast (gcsim's Snapshot), except its HP-based flat bonus
 * from the Garment, which is read at each tick
 */
const kurageSnapshot = (at: { t: number; onField: SimContext['onField'] }) =>
  (
    [
      'atk',
      'eleMas',
      'critRate_',
      'critDMG_',
      'all_dmg_',
      'hydro_dmg_',
      'skill_dmg_',
    ] as const
  ).map((stat) => ({ stat, path: ['total', stat], ...at }))

/**
 * The Garment's Normal and Charged Attack hits heal the party (once per attack); C6: when a healed
 * member has 80%+ HP (assumed without HP tracking), Hydro DMG +40% for 4 s (the game text; gcsim
 * gives 8 s)
 */
function garmentHeal(c: SimContext, s: KokomiState) {
  if (c.now >= s.burstEnd) return
  c.hit(0, {
    path: ['_heal', 'burst', 'heal'],
    tag: 'other',
    element: 'hydro',
    healTargets: [...c.members],
    label: 'Ceremonial Garment (Heal)',
  })
  if (c.constellation('SangonomiyaKokomi') < 6) return
  if (c.healthTracked && !c.members.some((m) => (c.hpRatio(m) ?? 1) >= 0.8))
    return
  // (after the healing hit: that hit does not get it)
  c.buff('SangonomiyaKokomi', ['SangonomiyaKokomi', 'c6'], 'on', 1, 4 * 60 + 1)
}

export const kit: KitModel = {
  characterKey: 'SangonomiyaKokomi',
  element: 'hydro',
  source: `${GCSIM}/kokomi`,
  // C4: Normal Attack SPD +10% while she wears the Garment
  normalAttackSpeed: (ctx, s: KokomiState, attacker) =>
    attacker === 'SangonomiyaKokomi' &&
    ctx.constellation('SangonomiyaKokomi') >= 4 &&
    ctx.now < s.burstEnd
      ? 0.1
      : 0,
  init: (): KokomiState => ({
    burstEnd: -1,
    kurageEnd: -1,
    kurageId: 0,
    away: false,
  }),
  act(ctx, s: KokomiState, action, previous) {
    const swapped = s.away
    s.away = false
    const garment = ctx.now < s.burstEnd
    switch (action.kind) {
      case 'normal':
        return normalString(
          kokomiNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'hydro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            ctx.at(d, (c2) => garmentHeal(c2, s))
            // C1: during the Garment, the 3rd hit also hits (same frame)
            if (
              i === 2 &&
              garment &&
              ctx.constellation('SangonomiyaKokomi') >= 1
            )
              ctx.hit(d, {
                path: ['constellation1', 'dmg'],
                tag: 'other',
                element: 'hydro',
                applies: true,
                durability: 25,
                label: "At Water's Edge (C1)",
              })
          },
          ctx
        )
      case 'charged': {
        // a Charged Attack straight after a normal attack has 14 frames of windup (not after a swap)
        const windup = previous?.kind === 'normal' && !swapped ? 14 : 0
        ctx.hit(48 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          label: 'Charged Attack',
        })
        ctx.at(48 - windup, (c2) => garmentHeal(c2, s))
        // not in our sheet: A4 (the Garment's flat DMG from her Healing Bonus on Normal/Charged)
        return {
          frames: 76 - windup,
          framesInto: {
            normal: 62 - windup,
            charged: 62 - windup,
            skill: 62 - windup,
            burst: 62 - windup,
            dash: 48 - windup,
            jump: 48 - windup,
            swap: 62 - windup,
          },
        }
      }
      case 'skill': {
        // Bake-Kurage: a tick at 24 frames, then one every 2 s from 150 (7 ticks in all)
        const id = ++s.kurageId
        const snapshot = { t: ctx.now, onField: ctx.onField }
        s.kurageEnd = ctx.now + kurageFrames
        ctx.hit(24, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          label: 'Bake-Kurage',
          statSnapshots: kurageSnapshot(snapshot),
        })
        const tick = (c: SimContext) => {
          if (id !== s.kurageId || c.now >= s.kurageEnd) return
          c.hit(0, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'hydro',
            applies: true,
            label: 'Bake-Kurage',
            statSnapshots: kurageSnapshot(snapshot),
          })
          // each tick heals the active character
          c.hit(0, {
            path: ['_heal', 'skill', 'heal'],
            tag: 'other',
            element: 'hydro',
            healTargets: [c.onField],
            label: 'Bake-Kurage (Heal)',
          })
          c.at(120, tick)
        }
        ctx.at(24, (c) =>
          c.hit(0, {
            path: ['_heal', 'skill', 'heal'],
            tag: 'other',
            element: 'hydro',
            healTargets: [c.onField],
            label: 'Bake-Kurage (Heal)',
          })
        )
        ctx.at(150, tick)
        return {
          cooldown: { key: 'skill', frames: 1200, delay: 20 },
          frames: 61,
          // (a written wait starts at CanQueueAfter: the hitmark, 24)
          framesInto: { dash: 29, jump: 29, wait: 24 },
        }
      }
      case 'burst': {
        ctx.hit(49, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 50,
          icd: 'burst',
          label: "Nereid's Ascension",
        })
        // marks the Garment's start (countedBuffs covers the hits it changes)
        ctx.hit(0, {
          path: ['_marker', 'kokomiBurst'],
          tag: 'other',
          element: 'hydro',
          label: 'Ceremonial Garment (start)',
        })
        s.burstEnd = ctx.now + garmentFrames
        // A1: Bake-Kurage on the field at frame 46 is refreshed (ascension 1 is assumed)
        ctx.at(46, (c) => {
          if (s.kurageEnd > c.now) s.kurageEnd = c.now + 721
        })
        return {
          cooldown: { key: 'burst', frames: 1080, delay: 46 },
          frames: 78,
          framesInto: { normal: 77, charged: 77, skill: 77, swap: 76 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'catalyst', previous, ctx)
      case 'plunge':
        // not in gcsim (no plunge frames): not modelled
        ctx.note('Kokomi: the plunge is not in gcsim; not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  // the Garment is cleared when she leaves the field
  onSwapOut(ctx, s: KokomiState) {
    s.away = true
    if (ctx.now < s.burstEnd) {
      s.burstEnd = ctx.now
      ctx.hit(0, {
        path: ['_marker', 'kokomiBurstEnd'],
        tag: 'other',
        element: 'hydro',
        label: 'Ceremonial Garment (end)',
      })
    }
  },
  countedBuffs(hits) {
    // The Garment's Normal, Charged and Bake-Kurage DMG bonus: her own hits while she is on the
    // field, within 10 s of the burst (it is cleared when she leaves the field)
    const starts = hits
      .filter(
        (h) =>
          h.path[0] === '_marker' &&
          h.path[1] === 'kokomiBurst' &&
          h.characterKey === 'SangonomiyaKokomi'
      )
      .map((h) => h.t)
    const ends = hits
      .filter(
        (h) =>
          h.path[0] === '_marker' &&
          h.path[1] === 'kokomiBurstEnd' &&
          h.characterKey === 'SangonomiyaKokomi'
      )
      .map((h) => h.t)
    // (each Garment ends after 10 s, or earlier when she leaves the field)
    const windows = starts.map((t) => {
      const end = ends.find((e) => e >= t)
      return [
        t,
        Math.min(t + garmentFrames, end ?? Number.POSITIVE_INFINITY),
      ] as const
    })
    const covered = new Set<number>()
    hits.forEach((h, i) => {
      if (h.characterKey !== 'SangonomiyaKokomi') return
      if (h.onField !== 'SangonomiyaKokomi') return
      if (h.tag !== 'normal' && h.tag !== 'charged' && h.tag !== 'skill') return
      if (windows.some(([t, end]) => h.t >= t && h.t < end)) covered.add(i)
    })
    const buffs: SimCountedBuff[] = [
      {
        owner: 'SangonomiyaKokomi',
        path: ['SangonomiyaKokomi', 'burst'],
        value: 'on',
        hits: covered,
      },
    ]
    return { buffs, extraHits: [] }
  },
}
