import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/dendro/lumine (Lumine's female frames), main as of 2026-11-10. */

/**
 * Lumine's normal attack string (gcsim's common/dendro/attack.go, female table). Each hit pauses
 * the Traveler (hitlag 0.03/0.03/0.06/0.06/0.10 s plus the defense halt, rounded up); the hits
 * themselves stay on world time (gcsim's QueueAttack).
 */
const dendroNormals: NormalHit[] = [
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

interface Lamp {
  /** Its stats snapshot: the frame before it appears, and who was on the field */
  snapshot: { t: number; onField: CharacterKey }
  end: number
  transfig?: 'hydro' | 'pyro' | 'electro'
  stacks: number
}
interface TravelerState {
  lamp?: Lamp
  /** Foreign Verdalume: Blade of Verdant Viridis stacks (max 3) and each source's 4 s ICD */
  blades: number
  coreReady: number
  dewReady: number
  lastDew: number
  /** Charged Attack: Verdessence is next ready at this frame (15 s cooldown) */
  verdessenceReady: number
}

/**
 * The Lamp attacks on the stats it took when it appeared (gcsim's snapshot in newLeaLotusLamp,
 * before that frame's A1/C6 buffs); A4's Elemental Mastery bonus stays live (an attack mod)
 */
const lampSnapshot = (lamp: Lamp) =>
  (
    [
      'atk',
      'critRate_',
      'critDMG_',
      'all_dmg_',
      'dendro_dmg_',
      'burst_dmg_',
    ] as const
  ).map((stat) => ({ stat, path: ['total', stat], ...lamp.snapshot }))
function lampHit(ctx: SimContext, lamp: Lamp) {
  ctx.hit(0, {
    path: ['burst', 'lampDmg'],
    tag: 'burst',
    element: 'dendro',
    applies: true,
    icd: 'burst',
    label: 'Lea Lotus Lamp',
    statSnapshots: lampSnapshot(lamp),
  })
}
function closeLamp(ctx: SimContext, s: TravelerState, lamp: Lamp) {
  if (s.lamp !== lamp) return
  s.lamp = undefined
  ctx.state('TravelerDendro', ['TravelerDendro', 'a1Stacks'], '')
  ctx.state('TravelerDendro', ['TravelerDendro', 'c6BurstEffect'], '')
  ctx.state('TravelerDendro', ['TravelerDendro', 'c6BurstEle'], '')
}

export const kit: KitModel = {
  characterKey: 'TravelerDendro',
  element: 'dendro',
  source: `${GCSIM}/traveler/dendro`,
  init: (): TravelerState => ({
    blades: 0,
    coreReady: -1,
    dewReady: -1,
    lastDew: 0,
    verdessenceReady: -1,
  }),
  act(ctx, s: TravelerState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          dendroNormals,
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
        // Foreign Verdalume: with 3 Blade of Verdant Viridis stacks (15 s cooldown) the Charged
        // Attack is Charged Attack: Verdessence: Dendro with +80% ATK per hit, and two Vinecores
        // that explode 4 s and 8 s later (120% ATK, Charged Attack DMG). gcsim has no
        // Verdessence: its frames are the Charged Attack's; the Vinecores count from the second
        // hit (ESTIMATE).
        const verd =
          s.blades >= 3 &&
          ctx.now >= s.verdessenceReady &&
          ctx.hasBuff('TravelerDendro', ['Traveler', 'lockedPassive'])
        if (verd) {
          s.blades = 0
          s.verdessenceReady = ctx.now + 15 * 60
        }
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [verd ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: verd ? 'dendro' : 'physical',
            applies: true,
            icd: 'normal',
            label: verd
              ? `Charged Attack: Verdessence (${i + 1})`
              : `Charged Attack (${i + 1})`,
          })
        )
        if (verd)
          for (const d of [25 + 240, 25 + 480])
            ctx.hit(d, {
              path: ['lockedPassive', 'vinecoreDmg'],
              tag: 'charged',
              element: 'dendro',
              applies: true,
              icd: 'none',
              label: 'Vinecore',
            })
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        // Razorgrass Blade: one Dendro hit at 28 frames, no ICD
        ctx.hit(28, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Razorgrass Blade',
        })
        return {
          cooldown: { key: 'skill', frames: 480, delay: 25 },
          frames: 37,
          framesInto: { dash: 28, jump: 28, swap: 35 },
        }
      }
      case 'burst': {
        const life = ctx.constellation('TravelerDendro') >= 2 ? 900 : 720
        ctx.at(54, (c) => {
          // only one Lamp at a time: a new one replaces the old
          if (s.lamp) closeLamp(c, s, s.lamp)
          const lamp: Lamp = {
            snapshot: { t: c.now - 1, onField: c.onField },
            end: c.now + life,
            stacks: 0,
          }
          s.lamp = lamp
          const stack = (c2: SimContext) => {
            if (s.lamp !== lamp || c2.now >= lamp.end) return
            lamp.stacks = Math.min(10, lamp.stacks + 1)
            c2.state(
              'TravelerDendro',
              ['TravelerDendro', 'a1Stacks'],
              `${lamp.stacks}`
            )
            c2.at(60, stack)
          }
          stack(c)
          if (c.constellation('TravelerDendro') >= 6)
            c.state('TravelerDendro', ['TravelerDendro', 'c6BurstEffect'], 'on')
          const tick = (c2: SimContext) => {
            if (s.lamp !== lamp || lamp.transfig || c2.now >= lamp.end) return
            lampHit(c2, lamp)
            c2.at(90, tick)
          }
          c.at(37, tick)
          c.at(life, (c2) => closeLamp(c2, s, lamp))
        })
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 58,
          framesInto: { swap: 57 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Dendro: the Cryo Lumine's low plunge (the same body animation)
        ctx.note(
          "TravelerDendro: plunge frames are the Cryo Lumine's low plunge (gcsim has none for Dendro)."
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
  onHit(ctx, s: TravelerState, hit) {
    // Foreign Verdalume: a Dendro Core appearing, or the party gaining Verdant Dew, gives a
    // Blade of Verdant Viridis (each source once every 4 s)
    if (hit.path[0] === '_reaction' && hit.path[1] === 'bloom') {
      if (ctx.now >= s.coreReady) {
        s.coreReady = ctx.now + 240
        s.blades = Math.min(3, s.blades + 1)
      }
    }
    const dew = ctx.dew
    if (dew > s.lastDew && ctx.now >= s.dewReady) {
      s.dewReady = ctx.now + 240
      s.blades = Math.min(3, s.blades + 1)
    }
    s.lastDew = dew
    const lamp = s.lamp
    if (
      !lamp ||
      lamp.transfig ||
      ctx.now >= lamp.end ||
      !hit.applies ||
      (hit.durability ?? 25) <= 0 ||
      !['hydro', 'pyro', 'electro'].includes(hit.element) ||
      hit.path[0].startsWith('_')
    )
      return
    // The single-target model assumes these attacks also reach the nearby lamp.
    lamp.transfig = hit.element as Lamp['transfig']
    if (ctx.constellation('TravelerDendro') >= 4) {
      lamp.stacks = Math.min(10, lamp.stacks + 5)
      ctx.state(
        'TravelerDendro',
        ['TravelerDendro', 'a1Stacks'],
        `${lamp.stacks}`
      )
    }
    ctx.state(
      'TravelerDendro',
      ['TravelerDendro', 'c6BurstEle'],
      lamp.transfig!
    )
    if (lamp.transfig === 'pyro') {
      lamp.end = ctx.now + 60
      ctx.at(60, (c) => {
        if (s.lamp !== lamp) return
        c.hit(0, {
          path: ['burst', 'explosionDmg'],
          tag: 'burst',
          element: 'dendro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Lea Lotus Lamp (Explosion)',
          statSnapshots: lampSnapshot(lamp),
        })
        closeLamp(c, s, lamp)
      })
    } else {
      const interval = lamp.transfig === 'electro' ? 54 : 90
      const tick = (c: SimContext) => {
        if (s.lamp !== lamp || c.now >= lamp.end) return
        lampHit(c, lamp)
        c.at(interval, tick)
      }
      ctx.at(15, tick)
    }
  },
}
