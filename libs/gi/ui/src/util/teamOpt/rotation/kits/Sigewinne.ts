import type { KitModel, SimContext, SimCountedBuff, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/sigewinne, main as of 2026-11-10. */

/**
 * Normal attacks: the hit is the hitmark + the travel (10f); the cancels are from the hitmark. Her
 * Charged Attack is gcsim's aim, which a normal attack allows at its hitmark (InitNormalCancelSlice)
 */
const TRAVEL = 10
const sigewinneNormals: NormalHit[] = [
  {
    hitmarks: [12 + TRAVEL],
    toNormal: 20,
    toCharged: 12,
    toAbil: 12,
    frames: 33,
  },
  {
    hitmarks: [14 + TRAVEL],
    toNormal: 36,
    toCharged: 14,
    toAbil: 14,
    frames: 40,
  },
  {
    hitmarks: [38 + TRAVEL],
    toNormal: 82,
    toCharged: 38,
    toAbil: 38,
    frames: 82,
  },
]

/**
 * Bolstering Bubblebalm: a bubble every 107f (world time); its thorn 40f after a bubble, once per
 * 10 s (a hitlag-affected status on Sigewinne, active on its expiry frame)
 */
const BUBBLE_INTERVAL = 107
const THORN_DELAY = 40
const THORN_ICD = 601
/** Super Saturated Syringing: a wave at 99f, then every 25f while it lasts (142f; 326f at C4) */
const BURST_WAVES_START = 99

interface SigewinneState {
  /** The thorn's ICD runs until this frame */
  thornIcdUntil: number
  /** The skill cast (a newer cast stops the previous bubble) */
  skillSrc: number
}

/** C2: the enemy's Hydro RES -35% for 8 s after a bubble or a burst wave hits */
const c2Shred = (ctx: SimContext, delay: number) =>
  ctx.buff('Sigewinne', ['Sigewinne', 'c2AfterHit'], 'on', delay, 8 * 60 + 1, {
    hitlag: 'enemy',
  })

/** C6: when she heals, her burst's CRIT for 15 s (a hitlag-affected modifier on her) */
const c6Heal = (ctx: SimContext, delay: number) =>
  ctx.buff(
    'Sigewinne',
    ['Sigewinne', 'c6AfterHeal'],
    'on',
    delay,
    15 * 60 + 1,
    {
      hitlag: 'recipient',
    }
  )

export const kit: KitModel = {
  characterKey: 'Sigewinne',
  element: 'hydro',
  source: `${GCSIM}/sigewinne`,
  init: (): SigewinneState => ({ thornIcdUntil: -1, skillSrc: 0 }),
  act(ctx, s: SigewinneState, action, previous) {
    const c = ctx.constellation('Sigewinne')
    switch (action.kind) {
      case 'normal':
        return normalString(
          sigewinneNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // The Fully-Charged Aimed Shot (gcsim's default hold): hitmark 86f + travel
        ctx.hit(86 + TRAVEL, {
          path: ['charged', 'fullyAimed'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          // (its own ICD tag, ExtraAttack, in the Sigewinne group)
          icd: 'Sigewinne_ExtraAttack',
          icdGroup: 'Sigewinne',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 94, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        // tap: the first bubble at 35f (CD from 16f); hold: gcsim's skill[hold=1], the short hold
        // (66f, CD from 40f, Bubble tier 1). (The full hold, hold=2: 90f, tier 2, is not written.)
        const hold = !!action.hold
        const first = hold ? 66 : 35
        let tier = hold ? 1 : 0
        const bubbles = c >= 1 ? 8 : 5
        const src = ++s.skillSrc
        const healsOthers = ctx.members.length > 1
        // a marker: A1's Convalescence starts with the skill (for `countedBuffs`)
        ctx.hit(0, {
          path: ['_marker', 'sigewinneSkill'],
          tag: 'other',
          element: 'hydro',
          label: 'Sigewinne skill',
        })
        for (let k = 0; k < bubbles; k++) {
          const t = first + BUBBLE_INTERVAL * k
          // (a newer cast ends this bubble)
          ctx.at(t, (c2) => {
            if (src !== s.skillSrc) return
            c2.hit(0, {
              path: ['skill', 'dmg'],
              tag: 'skill',
              element: 'hydro',
              applies: true,
              icd: 'Sigewinne_ElementalArt',
              icdGroup: 'Sigewinne',
              label: 'Rebound Hydrotherapy',
            })
            // the thorn: on a bubble, if the ICD is over
            if (c2.now >= s.thornIcdUntil) {
              s.thornIcdUntil = c2.now + THORN_ICD
              c2.hit(THORN_DELAY, {
                path: ['skill', 'bladeDmg'],
                tag: 'skill',
                element: 'hydro',
                label: 'Spiritbreath Thorn',
              })
            }
            if (c >= 2) c2Shred(c2, 0)
            // it heals the others; the last bounce heals Sigewinne herself (C6: her burst's CRIT)
            if (healsOthers)
              c2.hit(0, {
                path: ['_heal', 'skill', 'teammateHeal'],
                tag: 'other',
                element: 'hydro',
                healTargets: c2.members.filter((m) => m !== 'Sigewinne'),
                label: 'Bolstering Bubblebalm (Heal)',
              })
            if (k === bubbles - 1)
              c2.hit(0, {
                path: ['_heal', 'skill', 'selfHeal'],
                tag: 'other',
                element: 'hydro',
                healTargets: ['Sigewinne'],
                label: 'Bolstering Bubblebalm (Final Heal)',
              })
            if (c >= 6 && (healsOthers || k === bubbles - 1)) c6Heal(c2, 0)
          })
          // the tier (+5% per tier to this bubble), lost one per bounce (C1: not the first 3)
          if (tier > 0)
            ctx.buff('Sigewinne', ['Sigewinne', 'skillTier'], `${tier}`, t, 1)
          if (c < 1 || k > 2) tier = Math.max(0, tier - 1)
        }
        // A1: Hydro DMG +8% for 18 s (a hitlag-affected modifier; the sheet gates it on A1)
        ctx.buff(
          'Sigewinne',
          ['Sigewinne', 'a1BedRest'],
          'on',
          0,
          18 * 60 + 1,
          {
            hitlag: 'recipient',
          }
        )
        ctx.note(
          'Sigewinne: A4 (Bond of Life healing), the shields and the Sourcewater Droplets are not modelled.'
        )
        if (hold)
          return {
            cooldown: { key: 'skill', frames: 18 * 60, delay: 40 },
            frames: 56,
          }
        return {
          cooldown: { key: 'skill', frames: 18 * 60, delay: 16 },
          frames: 41,
          framesInto: { normal: 39 },
        }
      }
      case 'burst': {
        // waves: 6 (142f), or 14 (326f) at C4; the animation follows the last wave
        const maxDuration = c >= 4 ? 326 : 142
        const waves = Math.floor(maxDuration / 25) + 1
        for (let k = 0; k < waves; k++) {
          ctx.hit(BURST_WAVES_START + 25 * k, {
            path: ['burst', 'spoutDmg'],
            tag: 'burst',
            element: 'hydro',
            applies: true,
            icd: 'Sigewinne_ElementalBurst',
            icdGroup: 'SigewinneBurst',
            label: 'Super Saturated Syringing',
          })
          if (c >= 2) c2Shred(ctx, BURST_WAVES_START + 25 * k)
        }
        // gcsim: the animation ends after its length (the last wave's end); an action queued
        // behind it can start on the next frame (Frames is the end + its end lag, but the
        // animation is over by then); dash and jump end it at once, swap after 4 frames. A
        // written wait starts at the charge's end (CanQueueAfter: 99).
        const total = BURST_WAVES_START + maxDuration
        return {
          cooldown: { key: 'burst', frames: 18 * 60, delay: 1 },
          frames: total + 1,
          framesInto: {
            dash: total,
            jump: total,
            swap: total + 4,
            wait: BURST_WAVES_START,
          },
        }
      }
      case 'dash':
        // template dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Girl body): 34f after a dash, 31f otherwise
        return templateJump('loli', 'bow', previous, ctx)
      case 'plunge':
        // gcsim has no plunging attack for Sigewinne
        ctx.note('Sigewinne: plunging attacks are not in gcsim; not modelled.')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  // A1 Convalescence: 10 stacks for 18 s from the skill (inclusive of its expiry frame); a skill hit
  // by an off-field member (not the active one) uses one for a flat bonus (the sheet's a1Conva).
  // C1: each bubble bounce adds a stack.
  countedBuffs(hits, constellation) {
    const covered = new Set<number>()
    let active: { end: number; left: number } | undefined
    hits.forEach((h: SimHit, i) => {
      if (
        h.characterKey === 'Sigewinne' &&
        h.path[0] === '_marker' &&
        h.path[1] === 'sigewinneSkill'
      ) {
        active = { end: h.t + 18 * 60 + 1, left: 10 }
        return
      }
      if (!active || h.t >= active.end) return
      if (
        constellation >= 1 &&
        h.characterKey === 'Sigewinne' &&
        h.path[0] === 'skill' &&
        h.path[1] === 'dmg'
      ) {
        active.left++
        return
      }
      if (active.left <= 0) return
      if (h.tag !== 'skill' || h.characterKey === 'Sigewinne') return
      if (h.characterKey === h.onField) return
      covered.add(i)
      active.left--
    })
    const buffs: SimCountedBuff[] = [
      {
        owner: 'Sigewinne',
        path: ['Sigewinne', 'a1Conva'],
        value: 'on',
        hits: covered,
      },
    ]
    return { buffs, extraHits: [] }
  },
}
