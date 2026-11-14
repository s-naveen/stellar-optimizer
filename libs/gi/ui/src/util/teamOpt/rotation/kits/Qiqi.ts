import type { KitModel, SimContext } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/qiqi, main as of 2026-11-10. */

const qiqiNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 14,
    toCharged: 21,
    toAbil: 11,
    frames: 21,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 21,
    toCharged: 22,
    toAbil: 10,
    frames: 22,
  },
  {
    hitmarks: [9, 20],
    hitlag: [6, 6],
    toNormal: 33,
    toCharged: 33,
    toAbil: 20,
    frames: 33,
  },
  {
    hitmarks: [8, 18],
    hitlag: [6, 6],
    toNormal: 28,
    toCharged: 26,
    toAbil: 18,
    frames: 28,
  },
  {
    hitmarks: [16],
    hitlag: [11],
    toNormal: 53,
    toCharged: 53,
    toAbil: 16,
    frames: 53,
  },
]

interface QiqiState {
  /** The newest Herald of Frost (its tick chain stops when a newer one is cast) */
  heraldSrc: number
  heraldStart: number
  heraldEnd: number
  /** Coordinated Attack's 2.2 s ICD, on each triggering character's own clock. */
  coordIcd: Record<string, number>
}

export const kit: KitModel = {
  characterKey: 'Qiqi',
  element: 'cryo',
  source: `${KQMSIM}/qiqi`,
  init: (): QiqiState => ({
    heraldSrc: -1,
    heraldStart: -1,
    heraldEnd: -1,
    coordIcd: {},
  }),
  onStart(ctx) {
    ctx.state('Qiqi', ['Qiqi', 'lockRevelation'], 'on')
  },
  act(ctx, s: QiqiState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          qiqiNormals,
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
        ctx.hit(15, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(29, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        return {
          frames: 76,
          framesInto: { skill: 67, burst: 67, dash: 32, jump: 30, swap: 29 },
        }
      case 'skill': {
        // Herald of Frost lasts 15 s (a 1-frame margin). Its initial hit lands 32 frames in, and
        // its ticks start 64 frames later (gcsim's code: alternating gaps of 60 and 135 frames)
        const src = ctx.now
        s.heraldSrc = src
        s.heraldStart = ctx.now
        s.heraldEnd = ctx.now + 901
        ctx.at(32, (c2) => {
          // Native captures both instances before the initial hit can grant Tenacity.
          const snapshot = c2.snapshot('Qiqi')
          const statSnapshots = (
            [
              'atk',
              'hp',
              'def',
              'eleMas',
              'critRate_',
              'critDMG_',
              'all_dmg_',
              'cryo_dmg_',
              'skill_dmg_',
            ] as const
          ).map((stat) => ({ stat, path: ['total', stat], ...snapshot }))
          const tick = (t: SimContext, last: number): void => {
            if (s.heraldSrc !== src || t.now >= s.heraldEnd) return
            t.hit(0, {
              path: ['skill', 'tickDmg'],
              tag: 'skill',
              element: 'cryo',
              applies: true,
              icd: 'QiqiElementalArt',
              label: 'Herald of Frost (tick)',
              statSnapshots,
            })
            // Deployable swipes freeze the target without pausing Qiqi's clock.
            t.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 0,
              enemyAnimationPause: 7,
              label: 'Qiqi Herald tick hitlag',
            })
            const next = last === 60 ? 135 : 60
            if (t.now + next < s.heraldEnd) t.at(next, (t2) => tick(t2, next))
          }
          c2.hit(0, {
            path: ['skill', 'castDmg'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'QiqiElementalArt',
            label: 'Herald of Frost',
            statSnapshots,
          })
          c2.hit(0, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 7,
            label: 'Qiqi Herald initial hitlag',
          })
          c2.at(64, (c3) => tick(c3, 60))
        })
        // Revelation (gcsim's default): her E cooldown is 15 s
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 900, delay: 3 },
            frames: 58,
            framesInto: { normal: 57, dash: 6, jump: 5, swap: 57 },
          },
          { hitmarks: [32], hitlag: [7] }
        )
      }
      case 'burst': {
        // Revelation adds a second, direct Stellar hit when cast in Conduct radiance.
        ctx.hit(82, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'burst',
          label: 'Fortune-Preserving Talisman',
        })
        // C6 (Revelation): Glimpse of Mystery, 4 stacks for 12 s from the cast (countedBuffs)
        if (ctx.constellation('Qiqi') >= 6)
          ctx.hit(0, {
            path: ['_marker', 'qiqiGlimpse'],
            tag: 'other',
            element: 'physical',
            label: 'Qiqi C6: Glimpse of Mystery',
          })
        if (ctx.radiance === 'conduct')
          ctx.hit(82, {
            path: ['burst', 'stellarDmg'],
            tag: 'directStellarConduct',
            element: 'cryo',
            applies: false,
            label: 'Fortune-Preserving Talisman (Stellar-Conduct)',
            states: [
              {
                owner: 'Qiqi',
                path: ['Qiqi', 'lockStellarRadianceSc'],
                value: 'on',
              },
            ],
          })
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 115,
          framesInto: { normal: 113, skill: 113, jump: 114, swap: 112 },
        }
      }
      case 'plunge':
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 76,
          framesInto: { normal: 58, skill: 59, burst: 59, dash: 46, swap: 61 },
        }
      case 'dash':
        // a Loli's dash (gcsim's template by body type)
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('loli', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // C2: her Normal and Charged Attacks deal +15% to opponents affected by Cryo (or Frozen)
  onBeforeHit(ctx, _s: QiqiState, hit) {
    if (
      ctx.constellation('Qiqi') < 2 ||
      hit.characterKey !== 'Qiqi' ||
      (hit.tag !== 'normal' && hit.tag !== 'charged')
    )
      return
    ctx.state(
      'Qiqi',
      ['Qiqi', 'QiqiC2'],
      ctx.absorb(['cryo']) === 'cryo' ? 'on' : ''
    )
  },
  // C6 (Revelation): each Glimpse of Mystery stack adds 600% of Qiqi's ATK to the next direct
  // Stellar-Conduct / Stellar Swirl hit of the active character (not Qiqi), within 12 s
  countedBuffs(hits, c) {
    if (c < 6) return { buffs: [], extraHits: [] }
    const covered = new Set<number>()
    let stacks = 0
    let end = -1
    hits.forEach((h, i) => {
      if (
        h.characterKey === 'Qiqi' &&
        h.path[0] === '_marker' &&
        h.path[1] === 'qiqiGlimpse'
      ) {
        stacks = 4
        end = h.t + 721
        return
      }
      if (
        stacks > 0 &&
        h.t < end &&
        h.characterKey !== 'Qiqi' &&
        h.onField === h.characterKey &&
        (h.tag === 'directStellarConduct' || h.tag === 'directStellarSwirl')
      ) {
        covered.add(i)
        stacks--
      }
    })
    return {
      buffs: [
        { owner: 'Qiqi', path: ['Qiqi', 'QiqiC6'], value: 'on', hits: covered },
      ],
      extraHits: [],
    }
  },
  onHit(ctx, s: QiqiState, hit) {
    ctx.state(
      'Qiqi',
      ['Qiqi', 'lockStellarRadianceSc'],
      ctx.radiance === 'conduct' ? 'on' : ctx.radiance === 'swirl' ? 'ss' : ''
    )
    ctx.state('Qiqi', ['Qiqi', 'QiqiLk'], ctx.now < s.heraldEnd ? 'on' : '')
    if (
      hit.path[0].startsWith('_') ||
      (hit.path[0] === 'reaction' &&
        ['electrocharged', 'burning', 'hydroSwirl'].includes(hit.path[1]))
    )
      return

    // Coordinated Attack: while Herald of Frost is up, a hit by the active character (2.2 s ICD
    // per character) makes a Cryo hit 1 frame later
    if (hit.characterKey !== hit.onField) return
    if (hit.t < s.heraldStart || hit.t >= s.heraldEnd) return
    const frame = ctx.characterFrame(hit.characterKey)
    if ((s.coordIcd[hit.characterKey] ?? -1) > frame) return
    s.coordIcd[hit.characterKey] = frame + 132
    ctx.hit(1, {
      characterKey: 'Qiqi',
      path: ['skill', 'frostCoordDmg'],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      icd: 'QiqiElementalArt',
      label: 'Herald of Frost (coordinated attack)',
    })
    ctx.hit(1, {
      characterKey: 'Qiqi',
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: 0,
      enemyAnimationPause: 7,
      label: 'Qiqi Herald coordinated hitlag',
    })
  },
}
