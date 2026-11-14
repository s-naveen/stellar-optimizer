import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, withHitlag } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/cryo/lumine (Lumine's female frames), main as of 2026-11-10. */

/** Lumine's normal attack string (gcsim's common/cryo/attack.go, female table) */
const cryoNormals: NormalHit[] = [
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 24,
    toCharged: 32,
    toAbil: 16,
    frames: 32,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 21,
    toCharged: 23,
    toAbil: 10,
    frames: 23,
  },
  {
    hitmarks: [19],
    hitlag: [8],
    toNormal: 27,
    toCharged: 39,
    toAbil: 19,
    frames: 39,
  },
  {
    hitmarks: [23],
    hitlag: [8],
    toNormal: 38,
    toCharged: 45,
    toAbil: 23,
    frames: 45,
  },
  {
    hitmarks: [14],
    hitlag: [10],
    toNormal: 64,
    toCharged: 64,
    toAbil: 14,
    frames: 64,
  },
]

/** Frostglow stacks (max 8) build from the ice crystals; the Frostbound Javelin consumes them */
interface CryoState {
  frostglow: number
  coordReady: number
  icepoint: number
  icepointReady: number
  freezingReady: number
  /** The Frostpierce Star cast that is firing crystals (its frame), and until when */
  skillSrc: number
  skillUntil: number
  /** C2: each recipient's +60 EM lasts until this world frame */
  c2End: Partial<Record<CharacterKey, number>>
}

/** Stellar Glimmer damage or reaction (direct hits, shared Stellar Swirl, Stellar-Conduct) */
const stellarGlimmer = (hit: SimHit) =>
  hit.tag === 'directStellarConduct' ||
  hit.tag === 'directStellarSwirl' ||
  (hit.path[0] === 'reaction' && hit.path[1].startsWith('stellar')) ||
  (hit.path[0] === '_reaction' && hit.path[1] === 'stellarConduct')

export const kit: KitModel = {
  characterKey: 'TravelerCryo',
  element: 'cryo',
  source: `${KQMSIM}/traveler/common/cryo`,
  init: (): CryoState => ({
    frostglow: 0,
    skillSrc: -1,
    skillUntil: -1,
    coordReady: -1,
    icepoint: 0,
    icepointReady: -1,
    freezingReady: -1,
    c2End: {},
  }),
  onStart(ctx) {
    ctx.state('TravelerCryo', ['TravelerCryo', 'a1ScStar'], '')
    ctx.note(
      'Cryo Traveler: story passives enabled; native Icepoint does not implement the described 30-second expiry. Plunges and energy refunds (C1) are not validated.'
    )
  },
  act(ctx, s: CryoState, action, previous) {
    const star = ctx.characterFrame('TravelerCryo') < s.skillUntil
    const conversion = star && ctx.radiance === 'conduct'
    const radianceState = {
      owner: 'TravelerCryo' as const,
      path: ['TravelerCryo', 'a0StellarRadiance'],
      value:
        ctx.radiance === 'conduct'
          ? 'sc'
          : ctx.radiance === 'swirl'
            ? 'ss'
            : '',
    }
    const a1State = {
      owner: 'TravelerCryo' as const,
      path: ['TravelerCryo', 'a1ScStar'],
      value: conversion ? 'on' : '',
    }

    ctx.state(
      'TravelerCryo',
      ['TravelerCryo', 'a0StellarRadiance'],
      ctx.radiance === 'conduct' ? 'sc' : ctx.radiance === 'swirl' ? 'ss' : ''
    )
    switch (action.kind) {
      case 'normal':
        return normalString(
          cryoNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: conversion ? 'cryo' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
              states: [radianceState, a1State],
            }),
          ctx
        )
      case 'charged': {
        const freezing =
          star &&
          s.icepoint >= 3 &&
          ctx.characterFrame('TravelerCryo') >= s.freezingReady
        if (freezing) {
          s.icepoint = 0
          s.freezingReady = ctx.characterFrame('TravelerCryo') + 914
          s.frostglow = Math.min(8, s.frostglow + 2)
        }
        for (const [i, delay] of [14, 25].entries()) {
          const direct = freezing && ctx.radiance
          const node = direct
            ? `${direct === 'conduct' ? 'stellarconduct' : 'stellarswirl'}Dmg${i + 1}`
            : `dmg${i + 1}`
          ctx.hit(delay, {
            path: [freezing ? 'lockedPassive' : 'charged', node],
            tag:
              direct === 'conduct'
                ? 'directStellarConduct'
                : direct === 'swirl'
                  ? 'directStellarSwirl'
                  : 'charged',
            element: freezing || conversion ? 'cryo' : 'physical',
            applies: !direct,
            icd: freezing ? 'freezingIce' : 'normal',
            label: freezing ? 'Freezing Ice' : `Charged Attack (${i + 1})`,
            states: [
              radianceState,
              a1State,
              ...(freezing
                ? [
                    {
                      owner: 'TravelerCryo' as const,
                      path: ['Traveler', 'lockedPassive'],
                      value: 'on',
                    },
                  ]
                : []),
            ],
          })
          if (freezing)
            ctx.hit(delay, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 7,
              label: 'Freezing Ice hitlag',
            })
        }
        const result = {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
        return freezing
          ? withHitlag(result, {
              hitmarks: [14, 25],
              hitlag: [7, 7],
              worldTimeHits: true,
            })
          : result
      }
      case 'skill': {
        if (action.hold)
          ctx.note('TravelerCryo: the Skill has no hold: hE is modelled as E.')
        // Ice Fog Piercer: Cryo DMG at 19 frames
        ctx.hit(19, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'skill',
          label: 'Ice Fog Piercer',
        })
        // Frostpierce Star: 12 s (+3 s at C4). Its first tick is 178 frames in, then every 176
        // frames; each tick fires two crystals (13 frames apart), landing 9 frames after the tick
        const src = ctx.now
        s.skillSrc = src
        const c4 = ctx.constellation('TravelerCryo') >= 4 ? 180 : 0
        s.skillUntil = ctx.characterFrame('TravelerCryo') + 19 + 12 * 60 + c4
        ctx.state('TravelerCryo', ['TravelerCryo', 'a1ScStar'], 'on')
        ctx.atCharacter('TravelerCryo', 739 + c4, (at) => {
          if (s.skillSrc === src)
            at.state('TravelerCryo', ['TravelerCryo', 'a1ScStar'], '')
        })
        const tick = (c2: SimContext) => {
          if (
            s.skillSrc !== src ||
            c2.characterFrame('TravelerCryo') >= s.skillUntil
          )
            return
          if (c2.radiance !== 'conduct')
            for (const d of [9, 22])
              c2.hit(d, {
                path: ['skill', 'crystalDmg'],
                tag: 'skill',
                element: 'cryo',
                applies: true,
                icd: 'icicle',
                icdGroup: 'TravelerCryoIcicle',
                label: 'Frostpierce Star',
              })
          c2.atCharacter('TravelerCryo', 176, tick)
        }
        ctx.atCharacter('TravelerCryo', 178, tick)
        return {
          cooldown: { key: 'skill', frames: 900, delay: 17 },
          frames: 66,
          framesInto: {
            normal: 32,
            skill: 33,
            burst: 33,
            dash: 33,
            jump: 33,
            swap: 32,
          },
        }
      }
      case 'burst':
        // Frostbound Javelin: the javelins spawn 36 frames in and consume the Frostglow stacks
        // then (8 stacks: two more hits); the damage lands 6 frames after its spawn
        ctx.atCharacter('TravelerCryo', 36, (c2) => {
          const n = s.frostglow
          s.frostglow = 0
          // C6: each consumed Frostglow gives the other members +5% Stellar Glimmer DMG for 15 s
          // (the sheet reads the stack count; the Traveler's own javelins carry their own count).
          if (n && c2.constellation('TravelerCryo') >= 6)
            c2.buff(
              'TravelerCryo',
              ['TravelerCryo', 'burstFrostglow'],
              String(n),
              0,
              900,
              { hitlag: 'recipient' }
            )
          const delays = [0, 33, 38, 35, 42].slice(0, n === 8 ? 5 : 3)
          const radiance = c2.radiance
          const node =
            radiance === 'conduct'
              ? 'javelinStellarconductDmg'
              : radiance === 'swirl'
                ? 'javelinStellarswirlDmg'
                : 'javelinDmg'
          for (const d of delays)
            c2.hit(6 + d, {
              path: ['burst', node],
              tag:
                radiance === 'conduct'
                  ? 'directStellarConduct'
                  : radiance === 'swirl'
                    ? 'directStellarSwirl'
                    : 'burst',
              element: 'cryo',
              applies: !radiance,
              icd: 'burst',
              label: `Frostbound Javelin${radiance ? ` (Stellar-${radiance === 'conduct' ? 'Conduct' : 'Swirl'})` : ''}`,
              states: [
                {
                  owner: 'TravelerCryo',
                  path: ['TravelerCryo', 'a0StellarRadiance'],
                  value:
                    radiance === 'conduct'
                      ? 'sc'
                      : radiance === 'swirl'
                        ? 'ss'
                        : '',
                },
                {
                  owner: 'TravelerCryo',
                  path: ['TravelerCryo', 'burstFrostglow'],
                  value: n ? String(n) : '',
                },
              ],
              statSnapshots: [
                {
                  stat: 'atk',
                  path: ['total', 'atk'],
                  t: c2.now,
                  onField: c2.onField,
                },
                {
                  stat: 'eleMas',
                  path: ['premod', 'eleMas'],
                  t: c2.now,
                  onField: c2.onField,
                },
                {
                  stat: 'critRate_',
                  path: ['premod', 'critRate_'],
                  t: c2.now,
                  onField: c2.onField,
                },
                {
                  stat: 'critDMG_',
                  path: ['premod', 'critDMG_'],
                  t: c2.now,
                  onField: c2.onField,
                },
              ],
            })
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 75,
          framesInto: { skill: 74, jump: 74, swap: 73 },
        }
      case 'plunge':
        // gcsim's low plunge (Lumine): the impact at 47 frames
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: conversion ? 'cryo' : 'physical',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 100,
          states: [radianceState, a1State],
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
  onHit(ctx, s: CryoState, hit) {
    ctx.state(
      'TravelerCryo',
      ['TravelerCryo', 'a0StellarRadiance'],
      ctx.radiance === 'conduct' ? 'sc' : ctx.radiance === 'swirl' ? 'ss' : ''
    )
    const frame = ctx.characterFrame('TravelerCryo')
    const stellarDamage =
      hit.tag === 'directStellarConduct' ||
      hit.tag === 'directStellarSwirl' ||
      (hit.path[0] === 'reaction' && hit.path[1].startsWith('stellar'))
    if (stellarDamage && frame >= s.icepointReady) {
      s.icepointReady = frame + 120
      s.icepoint = Math.min(3, s.icepoint + 1)
    }
    if (
      hit.characterKey === 'TravelerCryo' &&
      (['normal', 'charged', 'plunge'].includes(hit.tag) ||
        hit.label === 'Freezing Ice') &&
      ctx.radiance === 'conduct' &&
      frame < s.skillUntil &&
      frame >= s.coordReady
    ) {
      s.coordReady = frame + 12
      ctx.hit(12, {
        path: ['skill', 'crystalDmg'],
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'icicle',
        icdGroup: 'TravelerCryoIcicle',
        label: 'Frostpierce Star',
      })
    }

    // each ice crystal that hits an opponent adds a Frostglow stack (max 8)
    if (hit.characterKey === 'TravelerCryo' && hit.path[1] === 'crystalDmg') {
      s.frostglow = Math.min(8, s.frostglow + 1)
      // C2: the active character gains 60 EM for 5 s when an ice crystal hits
      if (ctx.constellation('TravelerCryo') >= 2) {
        const recipient = ctx.onField
        s.c2End[recipient] = ctx.now + 300
        ctx.buff('TravelerCryo', ['TravelerCryo', 'c2Crystal'], 'on', 0, 300, {
          recipient,
        })
      }
    }
    // C2: a buffed character triggering or dealing Stellar Glimmer damage raises it to 120 EM for
    // the rest of its duration (from the next frame: the triggering hit is already calculated).
    const c2End = s.c2End[hit.characterKey] ?? -1
    if (
      ctx.constellation('TravelerCryo') >= 2 &&
      ctx.now < c2End &&
      stellarGlimmer(hit)
    )
      ctx.buff(
        'TravelerCryo',
        ['TravelerCryo', 'c2ActiveStellar'],
        'on',
        1,
        c2End - ctx.now - 1,
        { recipient: hit.characterKey }
      )
  },
}
