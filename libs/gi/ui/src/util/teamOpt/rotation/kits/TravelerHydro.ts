import type { HpChange, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/hydro/lumine (Lumine's female frames), main as of 2026-11-10. */

/**
 * Lumine's normal attack string (gcsim's common/hydro/attack.go, female table). Each hit pauses
 * the Traveler (hitlag 0.03/0.03/0.06/0.06/0.10 s plus the defense halt, rounded up); the hits
 * themselves stay on world time (gcsim's QueueAttack).
 */
const hydroNormals: NormalHit[] = [
  {
    hitmarks: [16],
    hitlag: [6],
    worldTimeHits: true,
    toNormal: 24,
    toCharged: 32,
    toAbil: 16,
    frames: 32,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    worldTimeHits: true,
    toNormal: 21,
    toCharged: 23,
    toAbil: 10,
    frames: 23,
  },
  {
    hitmarks: [19],
    hitlag: [8],
    worldTimeHits: true,
    toNormal: 27,
    toCharged: 39,
    toAbil: 19,
    frames: 39,
  },
  {
    hitmarks: [23],
    hitlag: [8],
    worldTimeHits: true,
    toNormal: 38,
    toCharged: 45,
    toAbil: 23,
    frames: 45,
  },
  {
    hitmarks: [14],
    hitlag: [10],
    worldTimeHits: true,
    toNormal: 64,
    toCharged: 64,
    toAbil: 14,
    frames: 64,
  },
]

interface HydroState {
  /** Spiritbreath Thorn can fire again from this frame (its 9 s ICD) */
  thornReady: number
  /** Foreign Aqualis: Blade of Many Waters stacks (max 3, one per 4 s) */
  blades: number
  bladeReady: number
  /** Party HP change (fraction of Max HP) since the last stack, by member */
  hpChange: Partial<Record<string, number>>
  /** Charged Attack: Tidebound is next ready at this frame (15 s cooldown) */
  tideboundReady: number
}

/** Suffusion drains 4% of the current HP per Dewdrop (0.9 s ICD) while above half HP */
const SUFFUSION = 0.04
const SUFFUSION_ICD = 54

/**
 * Rising Waters' bubble (gcsim): tick i at 0.5 m right and 0.5 + speed·i m ahead of where the
 * Traveler stood; a 0.15 m hit there reaches the enemy if their circles touch
 */
function bubbleHits(ctx: SimContext, i: number, speed: number) {
  const dx = 0.5
  const dy = 0.5 + speed * i - ctx.target.distance
  return Math.hypot(dx, dy) <= ctx.target.radius + 0.15
}

export const kit: KitModel = {
  characterKey: 'TravelerHydro',
  element: 'hydro',
  source: `${GCSIM}/traveler/hydro`,
  init: (): HydroState => ({
    thornReady: -1,
    blades: 0,
    bladeReady: -1,
    hpChange: {},
    tideboundReady: -1,
  }),
  act(ctx, s: HydroState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          hydroNormals,
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
      case 'charged': {
        // Foreign Aqualis: with 3 Blade of Many Waters stacks (15 s cooldown) the Charged Attack
        // is Charged Attack: Tidebound: Hydro with +150% ATK per hit; at 50%+ HP it consumes 10%
        // Max HP for +100% ATK more per hit, else it heals 25% Max HP. gcsim has no Tidebound:
        // its frames are the Charged Attack's.
        const tide =
          s.blades >= 3 &&
          ctx.now >= s.tideboundReady &&
          ctx.hasBuff('TravelerHydro', ['Traveler', 'lockedPassive'])
        let high = false
        if (tide) {
          s.blades = 0
          s.tideboundReady = ctx.now + 15 * 60
          high = (ctx.hpRatio('TravelerHydro') ?? 1) >= 0.5
          if (high) ctx.drainHp('TravelerHydro', 0.1)
          else ctx.healPercent('TravelerHydro', 0.25, ['TravelerHydro'])
        }
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [tide ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: tide ? 'hydro' : 'physical',
            applies: true,
            icd: 'normal',
            label: tide
              ? `Charged Attack: Tidebound (${i + 1})`
              : `Charged Attack (${i + 1})`,
            ...(tide
              ? {
                  states: [
                    {
                      owner: 'TravelerHydro' as const,
                      path: ['TravelerHydro', 'lockedPassiveHp'],
                      value: high ? 'on' : '',
                    },
                  ],
                }
              : {}),
          })
        )
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        if (action.hold) {
          // Aquacrest Saber (hold): gcsim's hold of 22 ticks (its default for hE). A Dewdrop
          // every 15 frames from frame 61. Suffusion: while the HP is above half, a Dewdrop
          // (0.9 s ICD: one in four) deals bonus DMG by Max HP and drains 4% of the current
          // HP. A4: the Torrent Surge at the end deals 45% of the HP drained (the sheet's
          // multiples of 4% Max HP, nearest).
          const ticks = 22
          const extend = 15 * (ticks - 1)
          let drained = 0
          let icdEnd = -1
          for (let k = 0; k < ticks; k++) {
            const d = 61 + 15 * k
            ctx.at(d, (c2) => {
              const ratio = c2.hpRatio('TravelerHydro') ?? 1 - drained
              const suff = c2.now > icdEnd && ratio > 0.5
              if (suff) {
                icdEnd = c2.now + SUFFUSION_ICD
                drained += SUFFUSION * ratio
                c2.drainHp('TravelerHydro', SUFFUSION * ratio, 0.5)
              }
              c2.hit(0, {
                path: ['skill', 'dewdropDmg'],
                tag: 'skill',
                element: 'hydro',
                applies: true,
                icd: 'dewdrop',
                icdGroup: 'TravelerDewdrop',
                label: 'Dewdrop',
                states: [
                  {
                    owner: 'TravelerHydro',
                    path: ['TravelerHydro', 'suffusion'],
                    value: suff ? 'on' : '',
                  },
                ],
              })
            })
          }
          ctx.at(57 + extend, (c2) => {
            const steps = Math.min(6, Math.round(drained / SUFFUSION))
            c2.hit(0, {
              path: ['skill', 'surgeDmg'],
              tag: 'skill',
              element: 'hydro',
              applies: true,
              icd: 'none',
              label: 'Torrent Surge (hold)',
              states: [
                {
                  owner: 'TravelerHydro',
                  path: ['TravelerHydro', 'a4HpConsumedPercent'],
                  value: steps ? `${steps * SUFFUSION}` : '',
                },
              ],
            })
          })
          if (ctx.now >= s.thornReady) {
            ctx.hit(103 + extend, {
              path: ['skill', 'thornDmg'],
              tag: 'skill',
              element: 'hydro',
              applies: false,
              durability: 0,
              icd: 'none',
              label: 'Spiritbreath Thorn',
            })
            s.thornReady = ctx.now + 9 * 60
          }
          return {
            cooldown: { key: 'skill', frames: 600, delay: 56 + extend },
            frames: 89 + extend,
            framesInto: {
              normal: 81 + extend,
              skill: 81 + extend,
              burst: 81 + extend,
              dash: 74 + extend,
              jump: 73 + extend,
            },
          }
        }
        // Tap: Torrent Surge at 26 frames (Lumine), and the Spiritbreath Thorn at 70 when its
        // 9 s ICD is over
        ctx.hit(26, {
          path: ['skill', 'surgeDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Torrent Surge',
        })
        if (ctx.now >= s.thornReady) {
          ctx.hit(70, {
            path: ['skill', 'thornDmg'],
            tag: 'skill',
            element: 'hydro',
            applies: false,
            durability: 0,
            icd: 'none',
            label: 'Spiritbreath Thorn',
          })
          s.thornReady = ctx.now + 9 * 60
        }
        ctx.note(
          'TravelerHydro: the A1 droplets (pickups, C1 Energy, C6 heal) and the C4 shield are not modelled.'
        )
        return {
          cooldown: { key: 'skill', frames: 600, delay: 24 },
          frames: 44,
          framesInto: { normal: 43, dash: 41, jump: 40, swap: 43 },
        }
      }
      case 'burst': {
        // Rising Waters: a bubble moving away at 1.5 m per 0.5 s tick from frame 36, for 4 s
        // (C2: 7 s at 1.05 m per tick), on the cast's snapshot; a tick hits only while the
        // bubble reaches the enemy (gcsim's positions)
        const c2 = ctx.constellation('TravelerHydro') >= 2
        const ticks = c2 ? 14 : 8
        for (let i = 0; i < ticks; i++)
          if (bubbleHits(ctx, i, c2 ? 1.05 : 1.5))
            ctx.hit(36 + 30 * i, {
              path: ['burst', 'dmg'],
              tag: 'burst',
              element: 'hydro',
              applies: true,
              icd: 'burst',
              icdGroup: 'TravelerBurst',
              snapshotDelay: 0,
              label: 'Rising Waters',
            })
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 78,
          framesInto: { normal: 77, skill: 77, dash: 77, jump: 77, swap: 76 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Hydro: the Cryo Lumine's low plunge (the same body animation)
        ctx.note(
          "TravelerHydro: plunge frames are the Cryo Lumine's low plunge (gcsim has none for Hydro)."
        )
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 74,
          framesInto: { normal: 58, skill: 58, burst: 58, dash: 47, swap: 61 },
        }
      case 'dash':
        // Lumine's dash (gcsim's template for a Girl body): 20 frames, 4 to the jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // gcsim's template: 31 frames, 34 right after a dash; a sword's plunge after 5
        return {
          frames: previous?.kind === 'dash' ? 34 : 31,
          framesInto: { plunge: 5 },
        }
      default:
        return { frames: 30 }
    }
  },
  onHpChange(ctx, s: HydroState, change: HpChange) {
    // Foreign Aqualis: a party member's HP changing by 5% (of Max HP, summed) gives a Blade of
    // Many Waters, once every 4 s
    const sum = (s.hpChange[change.characterKey] ?? 0) + change.ratio
    s.hpChange[change.characterKey] = sum
    if (sum < 0.05 || ctx.now < s.bladeReady) return
    s.hpChange = {}
    s.bladeReady = ctx.now + 240
    s.blades = Math.min(3, s.blades + 1)
  },
}
