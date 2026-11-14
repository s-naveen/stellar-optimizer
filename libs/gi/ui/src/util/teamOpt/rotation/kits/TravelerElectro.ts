import type { KitModel, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/electro/lumine (Lumine's female frames), main as of 2026-11-10. */

/**
 * Lumine's normal attack string (gcsim's common/electro/attack.go, female table). Each hit pauses
 * the Traveler (hitlag 0.03/0.03/0.06/0.06/0.10 s plus the defense halt, rounded up); the hits
 * themselves stay on world time (gcsim's QueueAttack).
 */
const electroNormals: NormalHit[] = [
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

interface ElectroState {
  /** Bellowing Thunder's 12 s: its Falling Thunder procs while it lasts (until this frame) */
  burstUntil: number
  /** The next Falling Thunder proc is allowed from this frame (0.5 s ICD) */
  nextProc: number
  /** C6 World-Shaker: procs since the last 200% one */
  c6Procs: number
  /** Foreign Thundertrail: Blade of Resounding Thunder stacks (party Elemental Bursts, max 3) */
  blades: number
  /** Charged Attack: Detonate is next ready at this frame (15 s cooldown) */
  detonateReady: number
}

export const kit: KitModel = {
  characterKey: 'TravelerElectro',
  element: 'electro',
  source: `${GCSIM}/traveler/electro`,
  init: (): ElectroState => ({
    burstUntil: -1,
    nextProc: -1,
    c6Procs: 0,
    blades: 0,
    detonateReady: -1,
  }),
  act(ctx, s: ElectroState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          electroNormals,
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
        // Foreign Thundertrail: with 3 Blade of Resounding Thunder stacks (15 s cooldown) the
        // Charged Attack is Charged Attack: Detonate: Electro with +100% ATK per hit, and 3 s
        // after it hits a lightning strike (200% ATK, Charged Attack DMG) that also leaves an
        // Abundance Amulet. gcsim has no Detonate: its frames are the Charged Attack's.
        const detonate =
          s.blades >= 3 &&
          ctx.now >= s.detonateReady &&
          ctx.hasBuff('TravelerElectro', ['Traveler', 'lockedPassive'])
        if (detonate) {
          s.blades = 0
          s.detonateReady = ctx.now + 15 * 60
        }
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [detonate ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: detonate ? 'electro' : 'physical',
            applies: true,
            icd: 'normal',
            label: detonate
              ? `Charged Attack: Detonate (${i + 1})`
              : `Charged Attack (${i + 1})`,
          })
        )
        if (detonate)
          ctx.hit(14 + 180, {
            path: ['lockedPassive', 'lightningDmg'],
            tag: 'charged',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Detonate lightning strike',
          })
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        // Lightning Blade: one blade hits (gcsim's default against one target; the rotation text
        // has no blade count)
        ctx.hit(21, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'skill',
          label: 'Lightning Blade',
        })
        // Its Abundance Amulet (one per blade that hits) is picked up by the active character
        // 107 frames in (KQM's average, gcsim's amulet_delay): Energy Recharge +20% (A4: plus
        // 10% of the Traveler's) for 6 s, and A1: Lightning Blade's cooldown -1.5 s when someone
        // else picks it up. (The flat Energy is not simulated.)
        ctx.at(107, (c2) => {
          c2.buff(
            'TravelerElectro',
            ['TravelerElectro', 'electroSkillAmulet'],
            'on',
            0,
            360,
            { recipient: c2.onField }
          )
          if (c2.onField !== 'TravelerElectro')
            c2.reduceCooldown('skill', 90, 'TravelerElectro')
        })
        return {
          cooldown: { key: 'skill', frames: 810, delay: 20 },
          frames: 57,
          framesInto: { dash: 42, jump: 42, swap: 55 },
        }
      }
      case 'burst':
        // Bellowing Thunder: one Electro hit at 37 frames, then 12 s of Falling Thunder procs
        ctx.hit(37, {
          path: ['burst', 'pressDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Bellowing Thunder',
        })
        s.burstUntil = ctx.now + 12 * 60
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 35 },
          frames: 62,
          framesInto: { normal: 61, jump: 61, swap: 61 },
        }
      case 'plunge':
        // gcsim has no plunge for Electro: the Cryo Lumine's low plunge (the same body animation)
        ctx.note(
          "TravelerElectro: plunge frames are the Cryo Lumine's low plunge (gcsim has none for Electro)."
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
  onPartyAction(_ctx, s: ElectroState, _actor, action) {
    // Foreign Thundertrail: a party member's Elemental Burst gives a Blade of Resounding Thunder
    if (action.kind === 'burst') s.blades = Math.min(3, s.blades + 1)
  },
  onHit(ctx, s: ElectroState, hit: SimHit) {
    // Lightning Shroud: the active character's normal and charged hits call a Falling Thunder
    // (1 frame later), one every 0.5 s, while Bellowing Thunder lasts
    if (hit.characterKey !== hit.onField) return
    if (hit.tag !== 'normal' && hit.tag !== 'charged') return
    if (hit.t >= s.burstUntil || hit.t < s.nextProc) return
    s.nextProc = hit.t + 30
    // C6 World-Shaker: every 3rd proc is the 200% one
    let third = false
    if (ctx.constellation('TravelerElectro') >= 6) {
      s.c6Procs++
      if (s.c6Procs >= 3) {
        third = true
        s.c6Procs = 0
      }
    }
    ctx.hit(1, {
      characterKey: 'TravelerElectro',
      path: ['burst', third ? 'thirdThunderDmg' : 'thunderDmg'],
      tag: 'burst',
      element: 'electro',
      applies: true,
      icd: 'burst',
      label: third ? 'Falling Thunder (C6)' : 'Falling Thunder',
    })
    // C2 Violet Vehemence: the enemy's Electro RES -15% for 8 s after a Falling Thunder hit
    if (ctx.constellation('TravelerElectro') >= 2)
      ctx.buff(
        'TravelerElectro',
        ['TravelerElectro', 'electroC2Thunder'],
        'on',
        // (after the Falling Thunder's own damage: gcsim's callback)
        2,
        480
      )
  },
}
