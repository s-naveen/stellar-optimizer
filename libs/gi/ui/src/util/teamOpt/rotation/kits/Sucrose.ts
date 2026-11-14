import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/sucrose, main as of 2026-11-10. */

const sucroseNormals: NormalHit[] = [
  { hitmarks: [17], toNormal: 17, toCharged: 20, toAbil: 17, frames: 28 },
  { hitmarks: [18], toNormal: 26, toCharged: 18, toAbil: 18, frames: 38 },
  { hitmarks: [28], toNormal: 33, toCharged: 28, toAbil: 28, frames: 46 },
  { hitmarks: [28], toNormal: 51, toCharged: 54, toAbil: 28, frames: 65 },
]

interface SucroseState {
  absorption?: import('../types').HitElement
  c4Count: number
}

export const kit: KitModel = {
  characterKey: 'Sucrose',
  element: 'anemo',
  source: `${GCSIM}/sucrose`,
  init: (): SucroseState => ({ c4Count: 0 }),
  charges: (cons) => ({ skill: cons >= 1 ? 2 : 1 }),
  onStart(ctx) {
    if (ctx.constellation('Sucrose') >= 4)
      ctx.note(
        'Sucrose: C4 cooldown reduction uses the native 1–6 s distribution’s 3.5 s mean; random timing is not exact.'
      )
  },
  // A1 (Catalyst Conversion): after Sucrose triggers a Swirl, the party members of the swirled
  // element gain 50 EM for 8 s (the sheet's swirl<element> conditional)
  onHit(ctx, s: SucroseState, hit) {
    if (
      hit.characterKey === 'Sucrose' &&
      ['normal', 'charged'].includes(hit.tag) &&
      ctx.constellation('Sucrose') >= 4
    ) {
      if (++s.c4Count >= 7) {
        s.c4Count = 0
        ctx.reduceCooldown('skill', 210, 'Sucrose')
      }
    }
    if (hit.path[0] !== '_reaction' || hit.characterKey !== 'Sucrose') return
    const e =
      hit.path[1] === 'stellarSwirl'
        ? 'cryo'
        : hit.path[1].endsWith('Swirl')
          ? hit.path[1].slice(0, -5)
          : ''
    if (['pyro', 'hydro', 'electro', 'cryo'].includes(e))
      ctx.buff('Sucrose', ['Sucrose', `swirl${e}`], e, 0, 480)
  },
  act(ctx, s: SucroseState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        const count = Math.min(action.count ?? 1, sucroseNormals.length)
        const r = normalString(
          sucroseNormals,
          count,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
        return r
      }
      case 'charged': {
        // windup (15 frames) when it follows a normal or charged attack; the hit is at 54
        const w =
          previous?.kind === 'normal' || previous?.kind === 'charged' ? 15 : 0
        ctx.hit(54 - w, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: 'Charged Attack',
        })
        const r: ActionResult = {
          frames: 71 - w,
          framesInto: {
            normal: 69 - w,
            charged: 66 - w,
            skill: 60 - w,
            burst: 61 - w,
            dash: 54 - w,
            jump: 54 - w,
            swap: 54 - w,
          },
        }
        return r
      }
      case 'skill': {
        ctx.hit(42, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Astable Anemohypostasis Creation-6308',
        })
        // A4: the party's EM for 8 s after a skill hit (the sheet's skillHit cond)
        ctx.buff('Sucrose', ['Sucrose', 'skillHit'], 'hit', 42, 8 * 60)
        // Hexerei: the party's DMG for 15 s after the Skill (the sheet's lockAfterSkill cond)
        ctx.buff('Sucrose', ['Sucrose', 'lockAfterSkill'], 'on', 0, 15 * 60)
        return {
          cooldown: { key: 'skill', frames: 900, delay: 9 },
          frames: 68,
          framesInto: {
            normal: 57,
            charged: 56,
            skill: 56,
            burst: 57,
            dash: 11,
            jump: 11,
            swap: 56,
          },
        }
      }
      case 'burst': {
        // Forbidden Creation: a DoT every 113 frames from 137 (C2: 480 s, not 360 s)
        const duration = ctx.constellation('Sucrose') >= 2 ? 480 : 360
        s.absorption = undefined
        const check = (c: SimContext, count: number) => {
          const element = c.absorb()
          if (element) {
            s.absorption = element
            if (c.constellation('Sucrose') >= 6)
              c.buff('Sucrose', ['Sucrose', 'absorption'], element, 0, 600, {
                hitlag: 'recipient',
              })
          } else if (count + 1 < duration / 18)
            c.at(18, (next) => check(next, count + 1))
        }
        ctx.at(136, (c) => check(c, 0))
        // gcsim snapshots both the DoT and the absorbed DoT's stats at the cast (the absorbed
        // one before its element is known, so C6's later Elemental DMG Bonus is not in it);
        // DMG bonuses that are attack mods (Hexerei, Venti's Secret Rite) still apply at impact
        const cast = { t: ctx.now, onField: ctx.onField }
        const statSnapshots = (
          [
            'atk',
            'critRate_',
            'critDMG_',
            'eleMas',
            'anemo_dmg_',
            'pyro_dmg_',
            'hydro_dmg_',
            'electro_dmg_',
            'cryo_dmg_',
          ] as const
        ).map((stat) => ({ stat, path: ['total', stat], ...cast }))
        for (let t = 137; t <= duration + 5; t += 113) {
          ctx.hit(t, {
            path: ['burst', 'dot'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            label: 'Forbidden Creation (DoT)',
            statSnapshots,
          })
          ctx.buff('Sucrose', ['Sucrose', 'skillHit'], 'hit', t, 8 * 60)
          ctx.at(t, (c) => {
            if (!s.absorption) return
            c.hit(0, {
              path: ['burst', s.absorption],
              tag: 'burst',
              element: s.absorption,
              applies: true,
              icd: 'none',
              label: 'Forbidden Creation (Absorbed)',
              statSnapshots,
              states: [
                {
                  owner: 'Sucrose',
                  path: ['Sucrose', 'absorption'],
                  value: s.absorption,
                },
              ],
            })
          })
        }
        // Hexerei: the Hexerei members' DMG for 20 s after the burst (sheet's lockAfterBurst cond)
        ctx.buff('Sucrose', ['Sucrose', 'lockAfterBurst'], 'on', 0, 20 * 60)
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 18 },
          frames: 65,
          framesInto: {
            normal: 49,
            charged: 48,
            skill: 48,
            dash: 47,
            jump: 47,
            swap: 47,
          },
        }
      }
      case 'dash':
        // (gcsim's Sucrose dash: 24 frames, cancellable into her Skill and Burst at 1 frame)
        return { frames: 24, framesInto: { skill: 1, burst: 1 } }
      case 'jump':
        // template jump (Girl body): 31 frames, 34 after a dash
        return templateJump('girl', 'catalyst', previous, ctx)
      case 'plunge':
        // low plunge (gcsim's low_plunge, which needs an airborne state in gcsim); the collision
        // hit is optional in gcsim and not modelled
        ctx.hit(45, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'anemo',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 66,
          framesInto: {
            normal: 56,
            charged: 47,
            skill: 45,
            burst: 45,
            dash: 45,
            swap: 49,
          },
        }
      default:
        return { frames: 30 }
    }
  },
  // Shared sequential charge recovery also handles C4 and Sacrificial resets.
  cooldownKey: (_s, action) =>
    action.kind === 'skill'
      ? 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
}
