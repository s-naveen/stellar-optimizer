import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kuki, main as of 2026-11-10. */

const kukiNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 19,
    toCharged: 23,
    toAbil: 12,
    frames: 23,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 17,
    toCharged: 27,
    toAbil: 13,
    frames: 27,
  },
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 42,
    toCharged: 50,
    toAbil: 13,
    frames: 50,
  },
  {
    hitmarks: [23],
    hitlag: [10],
    toNormal: 57,
    toCharged: 57,
    toAbil: 23,
    frames: 57,
  },
]

interface KukiState {
  /** The newest Grass Ring of Sanctification (its tick chain stops when a newer ring starts) */
  ringSrc: number
  ringStart: number
  ringEnd: number
  /** C4 Thundergrass Mark's ICD (5 s) */
  c4Until: number
  /** C6's ICD (60 s) */
  c6Until: number
  plungeNoted: boolean
}

export const kit: KitModel = {
  characterKey: 'KukiShinobu',
  element: 'electro',
  source: `${GCSIM}/kuki`,
  init: (): KukiState => ({
    ringSrc: -1,
    ringStart: -1,
    ringEnd: -1,
    c4Until: -1,
    c6Until: -1,
    plungeNoted: false,
  }),
  onHpChange(ctx, s: KukiState, change) {
    const ratio = ctx.hpRatio('KukiShinobu')
    if (ratio === undefined) return
    if (change.characterKey === 'KukiShinobu')
      // A1: +15% Healing Bonus at 50% HP or less
      ctx.state(
        'KukiShinobu',
        ['KukiShinobu', 'underHP'],
        ratio <= 0.5 ? 'on' : ''
      )
    // C6: an HP drain that leaves her at 25% or less: 150 EM for 15 s, once per 60 s
    if (
      change.kind === 'drain' &&
      ctx.constellation('KukiShinobu') >= 6 &&
      ratio <= 0.25 &&
      ctx.now >= s.c6Until
    ) {
      s.c6Until = ctx.now + 3600
      ctx.buff('KukiShinobu', ['KukiShinobu', 'c6Trigger'], 'on', 0, 900, {
        hitlag: 'recipient',
      })
    }
  },
  act(ctx, s: KukiState, action, previous) {
    const c = ctx.constellation('KukiShinobu')
    switch (action.kind) {
      case 'normal':
        return normalString(
          kukiNormals,
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
        ctx.hit(14, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(25, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        return {
          frames: 35,
          framesInto: { dash: 31, jump: 31, swap: 29 },
        }
      case 'skill': {
        // Sanctifying Ring drains 30% of her current HP, never below 20% (tracked HP only)
        const hp = ctx.hpRatio('KukiShinobu')
        if (hp !== undefined && hp > 0.2)
          ctx.drainHp('KukiShinobu', Math.min(0.3 * hp, hp - 0.2))
        ctx.hit(11, {
          path: ['skill', 'pressDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'skill',
          label: 'Sanctifying Ring',
        })
        // Grass Ring of Sanctification: starts 23 frames in, lasts 12 s (15 s at C2). Each tick
        // is 90 frames apart from the start, and lands 2 frames after its tick
        // (the new ring replaces the old one when it starts, 23 frames in)
        const src = ctx.now
        const end = ctx.now + 23 + (c >= 2 ? 900 : 720)
        ctx.at(23, () => {
          s.ringSrc = src
          s.ringStart = src + 23
          s.ringEnd = end
        })
        const tick = (t: SimContext) => {
          if (s.ringSrc !== src) return
          // it heals the active character (A4's EM bonus is in the sheet's node)
          if (t.healthTracked)
            t.hit(0, {
              path: ['_heal', 'skill', 'ringHeal'],
              tag: 'other',
              element: 'physical',
              label: 'Grass Ring of Sanctification (Heal)',
            })
          t.hit(2, {
            path: ['skill', 'ringDmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'skill',
            label: 'Grass Ring of Sanctification',
          })
          if (t.now + 90 <= end) t.at(90, tick)
        }
        ctx.at(113, tick)
        return {
          cooldown: { key: 'skill', frames: 900, delay: 7 },
          frames: 52,
          framesInto: { normal: 50, dash: 12, jump: 11, swap: 50 },
        }
      }
      case 'burst': {
        // 7 hits, or 12 at 50% HP or less at the cast (tracked HP; otherwise above 50% is
        // assumed), all snapshotted at the cast
        const count = (ctx.hpRatio('KukiShinobu') ?? 1) <= 0.5 ? 12 : 7
        for (let i = 0; i < count; i++)
          ctx.hit(50 + i * 17, {
            path: ['burst', 'singleDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'burst',
            label: 'Gyoei Narukami Kariyama Rite',
            snapshotDelay: 0,
          })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 63,
          framesInto: { normal: 62, skill: 62, swap: 62 },
        }
      }
      case 'plunge':
        // gcsim has no plunging attack for Kuki: not modelled
        if (!s.plungeNoted) {
          s.plungeNoted = true
          ctx.note(
            'KukiShinobu: plunging attack not modelled (gcsim has none for Kuki).'
          )
        }
        return { frames: 30 }
      case 'dash':
        // a Girl's dash (gcsim's template by body type)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: KukiState, hit) {
    // C4: a Normal, Charged or Plunging Attack of the active character, while her ring is up,
    // makes a Thundergrass Mark 5 frames later (once per 5 s)
    if (ctx.constellation('KukiShinobu') < 4) return
    if (hit.characterKey !== hit.onField) return
    if (hit.t < s.ringStart || hit.t >= s.ringEnd) return
    if (!['normal', 'charged', 'plunge'].includes(hit.tag)) return
    if (hit.t <= s.c4Until) return
    s.c4Until = hit.t + 300
    ctx.hit(5, {
      characterKey: 'KukiShinobu',
      path: ['constellation4', 'markDmg'],
      tag: 'skill',
      element: 'electro',
      applies: true,
      icd: 'none',
      label: 'Thundergrass Mark (C4)',
    })
  },
}
