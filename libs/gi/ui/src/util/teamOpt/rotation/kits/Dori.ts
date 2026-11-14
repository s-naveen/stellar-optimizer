import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/dori, main as of 2026-11-10. */

const doriNormals: NormalHit[] = [
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 44,
    toCharged: 44,
    toAbil: 27,
    frames: 44,
  },
  // the 2-hit: two instances, at 19 and 33 (cancels from the second)
  { hitmarks: [19, 33], toNormal: 46, toCharged: 46, toAbil: 33, frames: 46 },
  {
    hitmarks: [60],
    hitlag: [9],
    toNormal: 108,
    toCharged: 108,
    toAbil: 60,
    frames: 108,
  },
]

/** The Connector's 32 ticks, every 24 frames from frame 28 */
const connectorTicks = Array.from({ length: 32 }, (_, i) => 28 + 24 * i)

interface DoriState {
  /** C6: Electro Infusion of normal attacks and plunges until this frame */
  infusedUntil: number
  /** A1's ICD (until this frame) */
  a1Icd: number
  /** C6's heal ICD (0.1 s on her clock): until this character frame */
  c6HealIcd: number
  /** The Jinni (and its Connector to the active character) lasts until this frame */
  jinniUntil: number
}

/** The reactions that trigger A1 (Electro Crystallize and Hyperbloom are checked apart) */
const A1_REACTIONS = [
  'overloaded',
  'electroCharged',
  'lunarCharged',
  'superconduct',
  'stellarConduct',
  'quicken',
  'aggravate',
  'electroSwirl',
]

export const kit: KitModel = {
  characterKey: 'Dori',
  element: 'electro',
  source: `${GCSIM}/dori`,
  init: (): DoriState => ({
    infusedUntil: -1,
    a1Icd: -1,
    c6HealIcd: -1,
    jinniUntil: -1,
  }),
  // A1 (assumed unlocked): the character connected to the Jinni (the on-field one, while the
  // Jinni is out: game text; gcsim does not check the Jinni) triggering one of those reactions
  // cuts the Skill's cooldown by 1 s (3 s ICD)
  onHit(ctx, s: DoriState, hit) {
    const proc =
      (hit.path[0] === '_reaction' &&
        (A1_REACTIONS.includes(hit.path[1]) ||
          (hit.path[1] === 'crystallize' && hit.element === 'electro'))) ||
      (hit.path[0] === 'reaction' && hit.path[1] === 'hyperbloom')
    if (!proc || hit.characterKey !== hit.onField || hit.t > s.jinniUntil)
      return
    // (the ICD is active on its expiry frame)
    if (hit.t <= s.a1Icd) return
    s.a1Icd = hit.t + 180
    ctx.reduceCooldown('skill', 60, 'Dori')
  },
  act(ctx, s: DoriState, action, previous) {
    const c = ctx.constellation('Dori')
    const infused = (t: number) => t < s.infusedUntil
    switch (action.kind) {
      case 'normal':
        return normalString(
          doriNormals,
          action.count ?? 1,
          (i, d, j) => {
            ctx.hit(d, {
              // the 2-hit's instances are sheet nodes 1 and 2; the 3-hit is node 3
              path: ['normal', i === 0 ? '0' : i === 1 ? `${j + 1}` : '3'],
              tag: 'normal',
              element: infused(ctx.now + d) ? 'electro' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            // C6: an infused normal hit heals the party for 4% of her Max HP (0.1 s ICD, gcsim)
            if (ctx.constellation('Dori') >= 6)
              ctx.at(d, (c) => {
                if (!infused(c.now)) return
                const f = c.characterFrame('Dori')
                if (f < s.c6HealIcd) return
                s.c6HealIcd = f + 6
                c.hit(0, {
                  path: ['_heal', 'constellation6', 'heal'],
                  tag: 'other',
                  element: 'physical',
                  healTargets: [...c.members],
                  label: 'Dori C6: Healing',
                })
              })
          },
          ctx
        )
      case 'skill': {
        // Troubleshooter Shot: released at 16, travels 10
        ctx.hit(26, {
          path: ['skill', 'shotDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'skill',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Troubleshooter Shot',
        })
        // After-Sales Service Rounds: 46 and 59 frames after the Shot lands (a 3rd with C1),
        // snapshotted when the Shot lands
        const rounds = c >= 1 ? [46, 59, 59] : [46, 59]
        for (const r of rounds)
          ctx.hit(26 + r, {
            path: ['skill', 'roundDmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'skill',
            label: 'After-Sales Service Round',
            snapshotDelay: 26,
          })
        // C6: normal attacks and plunges are Electro for 3 s after the skill
        if (c >= 6) {
          s.infusedUntil = ctx.now + 228
          ctx.buff('Dori', ['Dori', 'c6AfterSkill'], 'on', 0, 228)
        }
        return {
          cooldown: { key: 'skill', frames: 540, delay: 16 },
          frames: 44,
          framesInto: { dash: 43, swap: 43 },
        }
      }
      case 'burst': {
        // Connector: 32 ticks on the enemies in its line (gcsim's DoriBurst ICD group: 1 per 3 s),
        // snapshotted at the cast
        s.jinniUntil = ctx.now + connectorTicks[connectorTicks.length - 1]
        connectorTicks.forEach((t) => {
          ctx.hit(t, {
            path: ['burst', 'connectorDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            icd: 'burst',
            icdGroup: 'DoriBurst',
            label: 'Connector',
            snapshotDelay: 0,
          })
          // C4: the connected character below 50% HP gets +50% Incoming Healing until the next
          // tick (tracked HP; its Energy is not tracked, so the Energy Recharge half is not)
          if (c >= 4)
            ctx.at(t, (c2) => {
              if ((c2.hpRatio(c2.onField) ?? 1) < 0.5)
                c2.buff('Dori', ['Dori', 'c4BelowHp'], 'belowHp', 0, 48, {
                  recipient: c2.onField,
                  hitlag: 'recipient',
                })
            })
        })
        // the Connector's 6 heals on the active character (from frame 11, every 120: gcsim's
        // bursthealpp), for the HP model (Furina's Fanfare, Ocean-Hued Clam, …)
        for (let i = 0; i < 6; i++)
          ctx.hit(11 + 120 * i, {
            path: ['_heal', 'burst', 'heal'],
            tag: 'other',
            element: 'physical',
            label: "Alcazarzaray's Exactitude: Healing",
          })
        // C2: each of the 6 Connector heals (from frame 11, every 120) fires a Jinni Toop 10 frames later
        if (c >= 2)
          for (let i = 0; i < 6; i++)
            ctx.hit(11 + 120 * i + 10, {
              path: ['constellation2', 'dmg'],
              tag: 'other',
              element: 'electro',
              applies: true,
              icd: 'doriC2',
              label: 'Jinni Toop (C2)',
            })
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 1 },
          frames: 58,
          framesInto: { normal: 57, skill: 57, jump: 57, swap: 56 },
        }
      }
      case 'plunge':
        // gcsim's Low Plunge (the High Plunge is the other sheet node); it needs an airborne state
        ctx.hit(38, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: infused(ctx.now + 38) ? 'electro' : 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 77,
          framesInto: { normal: 50, skill: 51, burst: 51, dash: 38, swap: 62 },
        }
      case 'charged':
        // gcsim has no charged attack for Dori (its config marks it not implemented)
        ctx.note('Dori: charged attack not modelled (gcsim has none).')
        return { frames: 30 }
      case 'dash':
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('loli', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
