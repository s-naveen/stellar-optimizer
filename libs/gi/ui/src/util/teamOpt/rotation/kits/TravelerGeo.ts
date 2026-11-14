import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/geo/lumine (Lumine's female frames), main as of 2026-11-10. */

/**
 * Lumine's normal attack string (gcsim's common/geo/attack.go, female table). Each hit pauses
 * the Traveler (hitlag 0.03/0.03/0.06/0.06/0.10 s plus the defense halt, rounded up); the hits
 * themselves stay on world time (gcsim's QueueAttack).
 */
const geoNormals: NormalHit[] = [
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

/** A Starfell Sword meteorite: up from `from` until `end` (its natural expiry) */
interface Stone {
  end: number
  /** Destroyed (exploded) before its expiry */
  gone: boolean
}
interface GeoState {
  stones: Stone[]
  /** Frames until which the walls registered as a Geo construct stand (not the stones' limit) */
  wallsEnd: number
  /** Foreign Adamantine: Blade of Archaic Petra stacks (max 3, one per second at most) */
  blades: number
  bladeReady: number
  /** Charged Attack: Rockfell is next ready at this frame (15 s cooldown) */
  rockfellReady: number
}

/** C2 Rockcore Meltdown: a destroyed meteorite explodes (the Starfell Sword's DMG again) */
function explode(ctx: SimContext, stone: Stone) {
  if (stone.gone) return
  stone.gone = true
  if (ctx.constellation('TravelerGeo') < 2) return
  ctx.hit(0, {
    path: ['constellation2', 'dmg'],
    tag: 'skill',
    element: 'geo',
    applies: true,
    durability: 50,
    icd: 'skill',
    label: 'Rockcore Meltdown (C2)',
  })
}

/** Foreign Adamantine: a Geo construct (or a shield) appears: one stack, once per second */
function blade(ctx: SimContext, s: GeoState) {
  if (ctx.now < s.bladeReady) return
  s.bladeReady = ctx.now + 60
  s.blades = Math.min(3, s.blades + 1)
}

export const kit: KitModel = {
  characterKey: 'TravelerGeo',
  element: 'geo',
  source: `${GCSIM}/traveler/geo`,
  init: (): GeoState => ({
    stones: [],
    wallsEnd: -1,
    blades: 0,
    bladeReady: -1,
    rockfellReady: -1,
  }),
  act(ctx, s: GeoState, action, previous) {
    const c = ctx.constellation('TravelerGeo')
    switch (action.kind) {
      case 'normal':
        return normalString(
          geoNormals,
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
            // A4 Frenzied Rockslide: a character task 20 frames into the last hit of the string
            // (gcsim's a4Hitmark), so after that hit's own hitlag (10 frames): 6 + 10 frames
            // after the hit
            if (i === 4 && j === 0)
              ctx.hit(d + 6 + 10, {
                path: ['passive2', 'dmg'],
                tag: 'normal',
                element: 'geo',
                applies: true,
                icd: 'none',
                label: 'Frenzied Rockslide (A4)',
              })
          },
          ctx
        )
      case 'charged': {
        // Foreign Adamantine: with 3 Blade of Archaic Petra stacks (15 s cooldown) the Charged
        // Attack is Charged Attack: Rockfell, Geo with +120% ATK per hit. gcsim has no Rockfell:
        // its frames are the Charged Attack's.
        const rockfell =
          s.blades >= 3 &&
          ctx.now >= s.rockfellReady &&
          ctx.hasBuff('TravelerGeo', ['Traveler', 'lockedPassive'])
        if (rockfell) {
          s.blades = 0
          s.rockfellReady = ctx.now + 15 * 60
        }
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [rockfell ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: rockfell ? 'geo' : 'physical',
            applies: true,
            icd: 'normal',
            label: rockfell
              ? `Charged Attack: Rockfell (${i + 1})`
              : `Charged Attack (${i + 1})`,
          })
        )
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        // Starfell Sword: tap hits at 62 frames, hold (gcsim's short hold) at 29, on the stats
        // 24 frames in. Its meteorite appears with the hit and lasts 30 s (+10 s at C6).
        const hold = !!action.hold
        const hitmark = hold ? 29 : 62
        ctx.hit(hitmark, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'skill',
          snapshotDelay: 24,
          label: hold ? 'Starfell Sword (hold)' : 'Starfell Sword',
        })
        const life = 30 * 60 + (c >= 6 ? 600 : 0)
        ctx.at(hitmark, (c2) => {
          // At most 3 limited Geo constructs stand at once (gcsim's construct handler): a new
          // meteorite destroys the oldest one (this Traveler's own oldest meteorite here), which
          // explodes at C2
          const live = s.stones.filter((st) => !st.gone && st.end > c2.now)
          const ownRegistered = s.stones.filter((st) => st.end > c2.now).length
          const others = Math.max(
            0,
            c2.constructs - ownRegistered - (s.wallsEnd > c2.now ? 1 : 0)
          )
          if (others + live.length >= 3 && live.length) explode(c2, live[0])
          const stone: Stone = { end: c2.now + life, gone: false }
          s.stones = [...s.stones.filter((st) => st.end > c2.now), stone]
          c2.construct(life)
          blade(c2, s)
          c2.at(life, (c3) => explode(c3, stone))
        })
        // A1: Starfell Sword's cooldown is 2 s shorter, so 6 s
        return hold
          ? {
              cooldown: { key: 'skill', frames: 360, delay: 25 },
              frames: 54,
              framesInto: { dash: 31, jump: 32, swap: 40 },
            }
          : {
              cooldown: { key: 'skill', frames: 360, delay: 23 },
              frames: 80,
              framesInto: { normal: 79, dash: 23, jump: 24, swap: 65 },
            }
      }
      case 'burst': {
        // Wake of Earth: four shockwave hits (gcsim's frames 66, 81, 96 and 111) on the cast's
        // snapshot. The walls (Geo constructs) rise at 35 and stand 15 s (+5 s at C6); they do
        // no damage.
        for (let i = 0; i < 4; i++)
          ctx.hit(51 + 15 * (i + 1), {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'geo',
            applies: true,
            durability: 50,
            icd: 'burst',
            snapshotDelay: 0,
            label: `Wake of Earth (${i + 1})`,
          })
        const wall = c >= 6 ? 1200 : 900
        ctx.at(35, (c2) => {
          s.wallsEnd = c2.now + wall
          c2.construct(wall)
          blade(c2, s)
        })
        // C1: a tick every second from 1 s after the walls rise gives the active character +10%
        // CRIT Rate for 2 s, while the walls stand (15 ticks, 20 at C6; gcsim's c1)
        if (c >= 1) {
          const lastTick = 35 + 60 * (wall / 60 - 1)
          ctx.buff(
            'TravelerGeo',
            ['TravelerGeo', 'geoC1BurstArea'],
            'on',
            95,
            lastTick + 120 - 95
          )
        }
        ctx.note(
          'TravelerGeo: C4 Energy from the shockwaves and the Rockfell shield bonus are not modelled; Blade of Archaic Petra stacks come from its own meteorites and walls only.'
        )
        return {
          cooldown: { key: 'burst', frames: 900, delay: 35 },
          frames: 64,
          framesInto: { normal: 62, dash: 42, jump: 42, swap: 49 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Geo: the Cryo Lumine's low plunge (the same body animation)
        ctx.note(
          "TravelerGeo: plunge frames are the Cryo Lumine's low plunge (gcsim has none for Geo)."
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
}
