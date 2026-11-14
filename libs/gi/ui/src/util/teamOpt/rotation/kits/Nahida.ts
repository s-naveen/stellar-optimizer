import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/nahida, main as of 2026-11-10. */

const nahidaNormals: NormalHit[] = [
  // (the skill / burst cancel frames of each hit: dash and jump differ by 1-2 frames in gcsim)
  { hitmarks: [23], toNormal: 30, toCharged: 26, toAbil: 21, frames: 35 },
  { hitmarks: [15], toNormal: 22, toCharged: 23, toAbil: 13, frames: 31 },
  { hitmarks: [26], toNormal: 38, toCharged: 37, toAbil: 24, frames: 45 },
  { hitmarks: [40], toNormal: 71, toCharged: 69, toAbil: 40, frames: 71 },
]

/** gcsim's dash / jump / swap cancels where they are not the skill's (toAbil) */
const nahidaCancels: Partial<
  Record<number, Partial<Record<'dash' | 'jump' | 'swap', number>>>
> = {
  0: { jump: 23 },
  2: { dash: 26, jump: 25 },
  3: { dash: 39, jump: 39, swap: 39 },
}

/**
 * Illusory Heart's Hydro (duration extension) and Electro (Tri-Karma interval decrease) numbers,
 * in seconds, for one and two characters, at talent level 10. gcsim's tables are per talent level
 * and the level is not known to the simulation, so level 10 is used throughout
 */
const HYDRO_EXTEND = [6.0192, 9.0288]
const ELECTRO_CD = [0.4464, 0.6696]

/** Seeds of Skandha last 25 s, from the last Elemental Skill that marked the enemy */
const MARK_DURATION = 1500

interface NahidaState {
  /** The enemy is marked from `markedSince` until `markedUntil` (the last Seed) */
  markedSince: number
  markedUntil: number
  /** Tri-Karma Purification is ready again from this frame */
  karmaIcd: number
  /** Illusory Heart (the burst field) lasts from `fieldStart` to `fieldEnd` */
  fieldStart: number
  fieldEnd: number
  /** The party is within Illusory Heart (for the Electro interval reduction) */
  withinFrom: number
  withinTo: number
  /** C6: Karmic Oblivion until this frame, its hits left, and its ICD */
  c6Until: number
  c6Count: number
  c6Icd: number
}

/** The enemy carries a Seed of Skandha at `t` */
const marked = (s: NahidaState, t: number) =>
  t >= s.markedSince && t < s.markedUntil

/**
 * Tri-Karma Purification's interval (gcsim's updateTriKarmaInterval): 2.5 s, less the Electro
 * characters' while the party is within Illusory Heart. gcsim re-evaluates it once a second (at
 * frames that are multiples of 60) and uses the value current at the trigger
 */
function karmaInterval(ctx: SimContext, s: NahidaState, t: number): number {
  const electro = Math.min(
    2,
    ctx.partyCount('electro') + (ctx.constellation('Nahida') >= 1 ? 1 : 0)
  )
  let cd = Math.trunc(2.5 * 60)
  const sampled = Math.floor(t / 60) * 60
  if (electro > 0 && sampled >= s.withinFrom && sampled < s.withinTo)
    cd -= Math.trunc(ELECTRO_CD[electro - 1] * 60)
  return cd
}

/**
 * Tri-Karma Purification (gcsim's triggerTriKarmaDamageIfAvail): any reaction on a marked enemy,
 * or Bloom / Hyperbloom / Burgeon damage on it, once per interval, 3 frames later
 */
function karmaTrigger(ctx: SimContext, s: NahidaState, t: number) {
  if (t < s.karmaIcd || !marked(s, t)) return
  // gcsim's ICD status is active through its expiry frame: the next one comes a frame later
  s.karmaIcd = t + karmaInterval(ctx, s, t) + 1
  ctx.hit(3, {
    characterKey: 'Nahida',
    path: ['skill', 'karmaDmg'],
    tag: 'skill',
    element: 'dendro',
    applies: true,
    durability: 25,
    icd: 'NahidaSkill',
    label: 'Tri-Karma Purification',
  })
}

export const kit: KitModel = {
  characterKey: 'Nahida',
  element: 'dendro',
  source: `${GCSIM}/nahida`,
  init: (): NahidaState => ({
    markedSince: -1,
    markedUntil: -1,
    karmaIcd: -1,
    fieldStart: -1,
    fieldEnd: -1,
    withinFrom: -1,
    withinTo: -1,
    c6Until: -1,
    c6Count: 0,
    c6Icd: -1,
  }),
  act(ctx, s: NahidaState, action, previous) {
    const c = ctx.constellation('Nahida')
    switch (action.kind) {
      case 'normal': {
        const r = normalString(
          nahidaNormals,
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
        // gcsim's per-hit dash / jump / swap cancels that differ from the skill's
        const last = r.normalStarts?.at(-1)
        const own = last && nahidaCancels[last.index]
        if (last && own)
          r.framesInto = {
            ...r.framesInto,
            ...Object.fromEntries(
              Object.entries(own).map(([k, v]) => [k, last.offset + v])
            ),
          }
        return r
      }
      case 'charged': {
        // a Charged Attack straight after a Normal Attack has a 10-frame windup less
        const windup = previous?.kind === 'normal' ? 10 : 0
        ctx.hit(65 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return {
          frames: 69 - windup,
          framesInto: {
            normal: 65 - windup,
            charged: 65 - windup,
            skill: 65 - windup,
            burst: 64 - windup,
            dash: 21 - windup,
            jump: 21 - windup,
            swap: 21 - windup,
          },
        }
      }
      case 'skill': {
        // a Tap marks the enemy at frame 13; a hold (hE, as the shortest hold: gcsim's hold 1)
        // at frame 33. The mark lasts 25 s from each one
        const hold = !!action.hold
        const hitmark = hold ? 33 : 13
        ctx.hit(hitmark, {
          path: ['skill', hold ? 'holdDmg' : 'pressDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: hold ? 'All Schemes to Know (hold)' : 'All Schemes to Know',
        })
        const at = ctx.now + hitmark
        if (s.markedUntil <= at) s.markedSince = at
        s.markedUntil = at + MARK_DURATION
        // C2 (crit on the marked enemy's reactions) and C4 (EM by marked enemies: one here)
        if (c >= 2)
          ctx.buff(
            'Nahida',
            ['Nahida', 'c2Bloom'],
            'on',
            hitmark,
            MARK_DURATION
          )
        if (c >= 4)
          ctx.buff('Nahida', ['Nahida', 'c4Count'], '1', hitmark, MARK_DURATION)
        if (hold)
          return {
            cooldown: { key: 'skill', frames: 360, delay: 30 },
            frames: 63,
            framesInto: {
              normal: 57,
              charged: 58,
              skill: 62,
              burst: 62,
              dash: 59,
              jump: 62,
              swap: 57,
            },
          }
        return {
          cooldown: { key: 'skill', frames: 300, delay: 11 },
          frames: 32,
          framesInto: {
            normal: 28,
            charged: 28,
            skill: 32,
            burst: 32,
            dash: 27,
            jump: 26,
            swap: 25,
          },
        }
      }
      case 'burst': {
        // Illusory Heart: the field goes up 66 frames in, for 15 s (+ the Hydro extension)
        const hydro = Math.min(2, ctx.partyCount('hydro') + (c >= 1 ? 1 : 0))
        const seconds = 15 + (hydro > 0 ? HYDRO_EXTEND[hydro - 1] : 0)
        const f = Math.trunc(seconds * 60)
        s.fieldStart = ctx.now + 66
        s.fieldEnd = s.fieldStart + f
        // partyInBurst: 60 frames from each 30 frames of the field (refreshed while in it)
        // (and A1: the active character's EM, from the same ticks)
        for (let i = 30; i <= f; i += 30) {
          ctx.buff('Nahida', ['Nahida', 'partyInBurst'], 'on', 66 + i, 60)
          ctx.buff(
            'Nahida',
            ['Nahida', 'condA1ActiveInBurst'],
            'on',
            66 + i,
            60
          )
        }
        s.withinFrom = s.fieldStart + 30
        s.withinTo = s.fieldStart + Math.floor(f / 30) * 30 + 60
        // C6: Karmic Oblivion for 10 s from the field, 6 at most
        s.c6Until = s.fieldStart + 600
        s.c6Count = 0
        s.c6Icd = -1
        return {
          cooldown: { key: 'burst', frames: 810 },
          frames: 112,
          framesInto: { swap: 111 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Nahida
        ctx.note(
          'Nahida: the plunging attack is not modelled (gcsim has none).'
        )
        return { frames: 30 }
      case 'dash':
        // (the default length for a body type not known here)
        return { frames: 20, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('loli', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: NahidaState, hit) {
    // C6: a Normal or Charged Attack hit on a marked enemy, during the 10 s, makes Karmic Oblivion
    // (a 0.2 s ICD, 6 at most)
    if (
      ctx.constellation('Nahida') >= 6 &&
      hit.characterKey === 'Nahida' &&
      (hit.tag === 'normal' || hit.tag === 'charged') &&
      hit.t < s.c6Until &&
      s.c6Count < 6 &&
      hit.t >= s.c6Icd &&
      marked(s, hit.t)
    ) {
      s.c6Count++
      s.c6Icd = hit.t + 13
      ctx.hit(1, {
        characterKey: 'Nahida',
        path: ['constellation6', 'dmg'],
        tag: 'skill',
        element: 'dendro',
        applies: true,
        icd: 'NahidaC6',
        label: 'Tri-Karma Purification: Karmic Oblivion',
      })
    }
    const t = hit.t
    if (hit.path[0] === '_reaction') {
      // every reaction counts for Tri-Karma Purification, except the Moondrift ones
      const reaction = hit.path[1]
      if (reaction === 'moondriftHarmony' || reaction === 'moondrift') return
      // C2: Quicken, Aggravate or Spread on a marked enemy: its DEF down for 8 s
      if (
        ctx.constellation('Nahida') >= 2 &&
        marked(s, t) &&
        (reaction === 'quicken' ||
          reaction === 'aggravate' ||
          reaction === 'spread')
      )
        ctx.buff('Nahida', ['Nahida', 'c2QSA'], 'on', 0, 480)
      karmaTrigger(ctx, s, t)
      return
    }
    // Bloom, Hyperbloom and Burgeon damage on a marked enemy
    if (
      hit.path[0] === 'reaction' &&
      (hit.path[1] === 'bloom' ||
        hit.path[1] === 'hyperbloom' ||
        hit.path[1] === 'burgeon')
    )
      karmaTrigger(ctx, s, t)
  },
}
