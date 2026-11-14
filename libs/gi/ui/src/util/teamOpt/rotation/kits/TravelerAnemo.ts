import type { HitElement, KitModel, SimContext, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/anemo/lumine (Lumine's female frames), main as of 2026-11-10. */

/**
 * Lumine's normal attack string (gcsim's common/anemo/attack.go, female table). Each hit pauses
 * the Traveler (hitlag 0.03/0.03/0.06/0.06/0.10 s plus the defense halt, rounded up); the hits
 * themselves stay on world time (gcsim's QueueAttack).
 */
const anemoNormals: NormalHit[] = [
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

/** Elements the vortex and the tornado absorb, in gcsim's AbsorbCheck order */
const ABSORB: readonly HitElement[] = ['cryo', 'pyro', 'hydro', 'electro']
type Absorbed = 'cryo' | 'pyro' | 'hydro' | 'electro'

interface AnemoState {
  /** Palm Vortex (hold) / Gust Surge: the element absorbed by the current cast */
  eAbsorb?: Absorbed
  qAbsorb?: Absorbed
  /** Cast counters: a newer cast stops the older one's absorption checks */
  eCast: number
  qCast: number
  /** Foreign Windwrath: Blade of the Dawn Breeze stacks (one per element) */
  blades: Absorbed[]
  /** Charged Attack: Whirlwind is next ready at this frame (15 s cooldown) */
  whirlwindReady: number
  /** No stacks are gained while Whirlwind lasts (until this frame) */
  whirlwindUntil: number
}

/**
 * gcsim's absorbCheck: from `from` frames on, every 18 frames, up to `count` checks, until an
 * element is absorbed (Cryo > Pyro > Hydro > Electro)
 */
function absorbChecks(
  ctx: SimContext,
  from: number,
  count: number,
  set: (ele: Absorbed) => void,
  live: () => boolean
) {
  const check = (c: SimContext, n: number) => {
    if (!live() || n >= count) return
    const ele = c.absorb(ABSORB) as Absorbed | undefined
    if (ele && ABSORB.includes(ele)) set(ele)
    else c.at(18, (c2) => check(c2, n + 1))
  }
  ctx.at(from, (c) => check(c, 0))
}

const C6_RES = ['TravelerAnemo', 'anemoC6Hit']
const BURST_ABSORB = ['TravelerAnemo', 'anemoBurstAbsorption']
const SKILL_ABSORB = ['TravelerAnemo', 'skillAbsorption']

export const kit: KitModel = {
  characterKey: 'TravelerAnemo',
  element: 'anemo',
  source: `${GCSIM}/traveler/anemo`,
  init: (): AnemoState => ({
    eCast: 0,
    qCast: 0,
    blades: [],
    whirlwindReady: -1,
    whirlwindUntil: -1,
  }),
  act(ctx, s: AnemoState, action, previous) {
    const c = ctx.constellation('TravelerAnemo')
    switch (action.kind) {
      case 'normal':
        return normalString(
          anemoNormals,
          action.count ?? 1,
          (i, d, j) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            // A1 Slitting Wind: a character task 21 frames into the last hit of the string
            // (gcsim's a1Hitmark), so after that hit's own hitlag (10 frames): 7 + 10 frames
            // after the hit
            if (i === 4 && j === 0)
              ctx.hit(d + 7 + 10, {
                path: ['passive1', 'dmg'],
                tag: 'normal',
                element: 'anemo',
                applies: true,
                icd: 'none',
                label: 'Slitting Wind (A1)',
              })
          },
          ctx
        )
      case 'charged': {
        // Foreign Windwrath: with 2+ Blade of the Dawn Breeze stacks (15 s cooldown) the Charged
        // Attack is Charged Attack: Whirlwind: its hits are Anemo with +60% ATK, and each
        // consumed stack summons a Blade Wind of its element (50% ATK, Charged Attack DMG).
        // gcsim has no Whirlwind: its frames are the Charged Attack's; the Blade Winds land
        // with the second hit (ESTIMATE).
        const whirl =
          s.blades.length >= 2 &&
          ctx.now >= s.whirlwindReady &&
          // (the simulation turns the story/resonance condition on for every Traveler)
          ctx.hasBuff('TravelerAnemo', ['Traveler', 'lockedPassive'])
        const winds = whirl ? s.blades : []
        if (whirl) {
          s.blades = []
          s.whirlwindReady = ctx.now + 15 * 60
          s.whirlwindUntil = ctx.now + 58
        }
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [whirl ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: whirl ? 'anemo' : 'physical',
            applies: true,
            icd: 'normal',
            label: whirl
              ? `Charged Attack: Whirlwind (${i + 1})`
              : `Charged Attack (${i + 1})`,
          })
        )
        for (const ele of winds)
          ctx.hit(25, {
            path: ['lockedPassive', ele],
            tag: 'charged',
            element: ele,
            applies: true,
            icd: 'none',
            label: 'Blade Wind',
          })
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        const cast = ++s.eCast
        s.eAbsorb = undefined
        if (action.hold) {
          // Hold (gcsim's hold=1): 6 cutting ticks, the first two Initial, then Max; the Max Storm
          // at 116. Elemental Absorption: checked every 18 frames from frame 32 (6 checks);
          // each tick and the Storm after it adds the absorbed element's hit (25% of it, the
          // element's own Elemental Art ICD).
          absorbChecks(
            ctx,
            32,
            Math.trunc(116 / 18),
            (ele) => (s.eAbsorb = ele),
            () => s.eCast === cast
          )
          const absorbed = (c2: SimContext, path: string[], label: string) => {
            const ele = s.eCast === cast ? s.eAbsorb : undefined
            if (!ele) return
            c2.hit(0, {
              path: ['skill', path[1]],
              tag: 'skill',
              element: ele,
              applies: true,
              icd: `skill-${ele}`,
              label,
              states: [
                { owner: 'TravelerAnemo', path: SKILL_ABSORB, value: ele },
              ],
            })
          }
          const cuts = [31, 46, 66, 81, 96, 111]
          cuts.forEach((d, i) => {
            ctx.hit(d, {
              path: ['skill', i < 2 ? 'initial_dmg' : 'initial_max'],
              tag: 'skill',
              element: 'anemo',
              applies: true,
              icd: 'skill',
              label: 'Palm Vortex cutting (hold)',
            })
            ctx.at(d, (c2) =>
              absorbed(
                c2,
                ['skill', i < 2 ? 'initial_ele_dmg' : 'max_ele_dmg'],
                'Palm Vortex cutting (absorbed)'
              )
            )
          })
          ctx.hit(116, {
            path: ['skill', 'storm_max'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            icd: 'skill',
            label: 'Palm Vortex storm (hold)',
          })
          ctx.at(116, (c2) =>
            absorbed(
              c2,
              ['skill', 'storm_ele_max'],
              'Palm Vortex storm (absorbed)'
            )
          )
          return {
            cooldown: { key: 'skill', frames: 480, delay: 111 },
            frames: 146,
            framesInto: { normal: 145, dash: 116, jump: 116, swap: 145 },
          }
        }
        // Tap: one Storm hit at 34 frames (gcsim's press absorbs nothing)
        ctx.hit(34, {
          path: ['skill', 'storm_dmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          icd: 'skill',
          label: 'Palm Vortex (Tap)',
        })
        return {
          cooldown: { key: 'skill', frames: 300, delay: 29 },
          frames: 62,
          framesInto: { normal: 61, dash: 31, jump: 31, swap: 60 },
        }
      }
      case 'burst': {
        // Gust Surge: 9 Anemo hits from frame 94, 30 frames apart, on the cast's snapshot.
        // Elemental Absorption: checked every 18 frames from frame 39 (18 checks); every tick
        // after it adds the element's hit (50 durability, no ICD).
        const cast = ++s.qCast
        s.qAbsorb = undefined
        const last = 94 + 30 * 8
        absorbChecks(
          ctx,
          39,
          Math.trunc(last / 18),
          (ele) => (s.qAbsorb = ele),
          () => s.qCast === cast
        )
        let absorbedFrom: number | undefined
        for (let i = 0; i < 9; i++) {
          ctx.hit(94 + 30 * i, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            icd: 'burst',
            snapshotDelay: 0,
            label: `Gust Surge (${i + 1})`,
          })
          ctx.at(94 + 30 * i, (c2) => {
            const ele = s.qCast === cast ? s.qAbsorb : undefined
            if (!ele) return
            c2.hit(0, {
              path: ['burst', 'absorb'],
              tag: 'burst',
              element: ele,
              applies: true,
              durability: 50,
              icd: 'none',
              label: 'Gust Surge (absorbed)',
              states: [
                { owner: 'TravelerAnemo', path: BURST_ABSORB, value: ele },
              ],
            })
            // C6: the absorbed element's RES -20% for 10 s after the last absorbed hit
            if (c >= 6) {
              if (absorbedFrom === undefined) {
                absorbedFrom = c2.now
                c2.buff(
                  'TravelerAnemo',
                  BURST_ABSORB,
                  ele,
                  1,
                  last - c2.now + 600
                )
              }
            }
          })
        }
        // C6: each hit cuts the enemy's Anemo RES by 20% for 10 s (after the first hit, to the
        // last plus 10 s)
        if (c >= 6) ctx.buff('TravelerAnemo', C6_RES, 'on', 95, last - 95 + 600)
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 105,
          framesInto: { skill: 104, dash: 90, jump: 90, swap: 95 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Anemo: the Cryo Lumine's low plunge (the same body animation)
        ctx.note(
          "TravelerAnemo: plunge frames are the Cryo Lumine's low plunge (gcsim has none for Anemo)."
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
  onHit(ctx, s: AnemoState, hit: SimHit) {
    // Foreign Windwrath: a Pyro, Hydro, Cryo or Electro attack by a party member hitting the
    // enemy gives a Blade of the Dawn Breeze of that element (one per element), not while
    // Whirlwind lasts
    if (
      hit.path[0].startsWith('_') ||
      hit.path[0] === 'reaction' ||
      !ABSORB.includes(hit.element) ||
      ctx.now < s.whirlwindUntil ||
      s.blades.includes(hit.element as Absorbed)
    )
      return
    s.blades.push(hit.element as Absorbed)
  },
}
