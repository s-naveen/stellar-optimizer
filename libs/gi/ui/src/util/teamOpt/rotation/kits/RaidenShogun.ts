import { allStats, getCharEle } from '@genshin-optimizer/gi/stats'
import { energyCalcData } from '../../energyCalc'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/raiden, main as of 2026-11-10. */

const raidenNormals: NormalHit[] = [
  {
    hitmarks: [14],
    hitlag: [5],
    toNormal: 18,
    toCharged: 24,
    toAbil: 14,
    frames: 24,
  },
  {
    hitmarks: [9],
    hitlag: [5],
    toNormal: 13,
    toCharged: 26,
    toAbil: 9,
    frames: 26,
  },
  {
    hitmarks: [14],
    hitlag: [5],
    toNormal: 26,
    toCharged: 36,
    toAbil: 14,
    frames: 36,
  },
  {
    hitmarks: [14, 27],
    hitlag: [0, 0],
    toNormal: 41,
    toCharged: 57,
    toAbil: 27,
    frames: 57,
  },
  {
    hitmarks: [34],
    hitlag: [5],
    toNormal: 50,
    toCharged: 50,
    toAbil: 34,
    frames: 50,
  },
]

/** Our sheet's node for each hit of each string step (N4 is 4.1 and 4.2) */
const raidenNodes = [[0], [1], [2], [3, 4], [5]]

/** Musou Isshin's normal attacks (during the burst's state); N4 is two hits */
const musouNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [5],
    toNormal: 19,
    toCharged: 21,
    toAbil: 12,
    frames: 21,
  },
  {
    hitmarks: [13],
    hitlag: [5],
    toNormal: 16,
    toCharged: 26,
    toAbil: 13,
    frames: 26,
  },
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 16,
    toCharged: 34,
    toAbil: 11,
    frames: 34,
  },
  {
    hitmarks: [22, 33],
    hitlag: [0, 0],
    toNormal: 44,
    toCharged: 67,
    toAbil: 33,
    frames: 67,
  },
  {
    hitmarks: [33],
    hitlag: [5],
    toNormal: 59,
    toCharged: 59,
    toAbil: 33,
    frames: 59,
  },
]

const musouNodes = [['hit1'], ['hit2'], ['hit3'], ['hit41', 'hit42'], ['hit5']]

/** Musou Shinsetsu's state: 420 frames after its hitmark (98) */
const musouFrames = 420 + 98

interface RaidenState {
  /** Musou Isshin ends at this frame of her clock; leaving the field ends it */
  musouEnd?: number
  musouGen: number
  /** The Eye of Stormy Judgment's 25 s window on the party, and the Eye's 0.9 s ICD */
  eyeStart?: number
  eyeEnd?: number
  eyeIcd: number
  resolve: number
  particleReady: number
  /** Her Eye strikes' particles: their 0.8 s ICD and the expected count (a 50% chance each) */
  eyeParticleIcd: number
  eyeParticles: number
  /** C6: its 1 s ICD and the count in this Musou Isshin (5 at most) */
  c6Icd: number
  c6Count: number
}

/** Musou Isshin is on (its end is on her clock: her hitlag extends it, as in gcsim) */
const inMusou = (s: RaidenState, ctx: SimContext) =>
  s.musouEnd !== undefined && ctx.characterFrame('RaidenShogun') < s.musouEnd

/** C4: party members (not Raiden) gain ATK +30% for 10 s when the Musou state ends */
const c4Buff = (ctx: SimContext) =>
  ctx.buff('RaidenShogun', ['RaidenShogun', 'c4'], 'c4', 0, 10 * 60)

/** Musou Isshin ends (by time or by leaving the field): C2's DEF ignore stops, C4 starts */
function endMusou(ctx: SimContext, s: RaidenState) {
  s.musouEnd = undefined
  s.musouGen++
  ctx.state('RaidenShogun', ['RaidenShogun', 'InBurst'], '')
  if (ctx.constellation('RaidenShogun') >= 4) c4Buff(ctx)
}

/** Resolve per Energy of a teammate's burst, by her burst talent level */
const resolveGained = allStats.char.skillParam.RaidenShogun.burst[3]

/**
 * C6: a Musou Isshin attack's hit cuts the other members' burst cooldowns by 1 s (1 s ICD, 5 per
 * Musou Isshin)
 */
function c6(ctx: SimContext, s: RaidenState) {
  if (ctx.constellation('RaidenShogun') < 6 || !inMusou(s, ctx)) return
  if (ctx.now < s.c6Icd || s.c6Count >= 5) return
  s.c6Icd = ctx.now + 60
  s.c6Count++
  for (const m of ctx.members)
    if (m !== 'RaidenShogun') ctx.reduceCooldown('burst', 60, m)
}

export const kit: KitModel = {
  characterKey: 'RaidenShogun',
  element: 'electro',
  source: `${GCSIM}/raiden`,
  init: (): RaidenState => ({
    musouGen: 0,
    eyeIcd: -1,
    resolve: 0,
    particleReady: -1,
    eyeParticleIcd: -1,
    eyeParticles: 0,
    c6Icd: -1,
    c6Count: 0,
  }),
  // In Musou Isshin her normal, charged and plunging attacks are the tachi's (their own frames)
  variant(ctx, s: RaidenState, action) {
    if (!inMusou(s, ctx)) return undefined
    const mode = 'Musou Isshin'
    switch (action.kind) {
      case 'normal':
        return { key: 'musou', label: 'Musou Isshin Normal Attack', mode }
      case 'charged':
        return { key: 'musou', label: 'Musou Isshin Charged Attack', mode }
      case 'plunge':
        return { key: 'musou', label: 'Musou Isshin Plunging Attack', mode }
      default:
        return undefined
    }
  },
  act(ctx, s: RaidenState, action, previous) {
    switch (action.kind) {
      case 'normal':
        if (inMusou(s, ctx))
          return normalString(
            musouNormals,
            action.count ?? 1,
            (i, d, j) =>
              ctx.hit(d, {
                path: ['burst', musouNodes[i][j]],
                tag: 'burst',
                element: 'electro',
                applies: true,
                durability: 25,
                icd: 'normal',
                label: `Musou Isshin N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
              }),
            ctx
          )
        return normalString(
          raidenNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${raidenNodes[i][j]}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              durability: 25,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        if (inMusou(s, ctx)) {
          ctx.hit(24, {
            path: ['burst', 'charged1'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'normal',
            label: 'Musou Isshin (Charged Attack 1)',
          })
          ctx.hit(32, {
            path: ['burst', 'charged2'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'normal',
            label: 'Musou Isshin (Charged Attack 2)',
          })
          return { frames: 56, framesInto: { dash: 32, jump: 32 } }
        }
        ctx.hit(22, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'ExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 37,
          framesInto: { dash: 22, jump: 22, swap: 36 },
        }
      case 'skill': {
        ctx.hit(51, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Eye of Stormy Judgement',
        })
        // The Eye: Raiden's own Burst DMG bonus (from 1 s after the skill) and the strikes below
        ctx.buff(
          'RaidenShogun',
          ['RaidenShogun', 'skillEye'],
          'skillEye',
          66,
          25 * 60
        )
        // (an Eye still up keeps working until the new one starts: its own hit can strike)
        if (s.eyeEnd === undefined || ctx.now + 66 > s.eyeEnd)
          s.eyeStart = ctx.now + 66
        s.eyeEnd = ctx.now + 66 + 25 * 60
        for (const recipient of ctx.members) {
          const cost = energyCalcData[recipient]?.burstCost
          if (recipient !== 'RaidenShogun' && cost)
            ctx.buff(
              'RaidenShogun',
              ['RaidenShogun', 'skillEyeTeam'],
              `${cost}`,
              66,
              1500,
              { recipient }
            )
        }
        return {
          cooldown: { key: 'skill', frames: 600, delay: 6 },
          frames: 37,
          framesInto: { dash: 17, jump: 17, swap: 36 },
        }
      }
      case 'burst': {
        const gen = ++s.musouGen
        s.musouEnd = ctx.characterFrame('RaidenShogun') + musouFrames
        s.c6Count = 0
        s.c6Icd = -1
        // C2's DEF ignore from the cast until Musou Isshin ends (or she leaves the field)
        ctx.state('RaidenShogun', ['RaidenShogun', 'InBurst'], 'on')
        ctx.atCharacter('RaidenShogun', musouFrames, (c2) => {
          if (s.musouGen === gen) endMusou(c2, s)
        })
        // the Resolve stacks are consumed at the hitmark, before the slash is queued
        ctx.at(98, (c2) => {
          c2.state(
            'RaidenShogun',
            ['RaidenShogun', 'burstResolve'],
            `${Math.floor(s.resolve)}`
          )
          s.resolve = 0
        })
        ctx.hit(98, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 50,
          icd: 'burst',
          label: 'Musou Shinsetsu',
          snapshotDelay: 98,
        })
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 112,
          framesInto: { normal: 111, skill: 111, dash: 111, swap: 110 },
        }
      }
      case 'plunge':
        if (inMusou(s, ctx)) {
          ctx.hit(49, {
            path: ['burst', 'plungeLow'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'none',
            label: 'Low Plunge (Musou Isshin)',
          })
          return {
            frames: 85,
            framesInto: {
              normal: 58,
              skill: 59,
              burst: 59,
              dash: 78,
              jump: 81,
              swap: 60,
            },
          }
        }
        // Low Plunge (P: the rotation does not give the height)
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 96,
          framesInto: {
            normal: 60,
            skill: 59,
            burst: 60,
            dash: 80,
            jump: 80,
            swap: 62,
          },
        }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength)
        return {
          frames: previous?.kind === 'dash' ? 37 : 32,
          framesInto: { plunge: 5 },
        }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: RaidenState, hit) {
    // A1: a party member gaining particles gives 2 Resolve (once per 3 s)
    if (hit.path[0] === '_particle' && ctx.now >= s.particleReady) {
      s.resolve = Math.min(60, s.resolve + 2)
      s.particleReady = ctx.now + 180
    }
    if (hit.path[0].startsWith('_')) return
    if (hit.characterKey === 'RaidenShogun') {
      // C6: her Musou Isshin attacks (burst-tagged) while it lasts
      if (hit.tag === 'burst' && hit.path[1] !== 'dmg') c6(ctx, s)
      // her Eye strikes' particles: a 50% chance of 1 (0.8 s ICD), as expected counts, 100 frames
      // later (gcsim's particle delay)
      if (
        hit.path[0] === 'skill' &&
        hit.path[1] === 'coorDmg' &&
        ctx.characterFrame('RaidenShogun') >= s.eyeParticleIcd
      ) {
        s.eyeParticleIcd = ctx.characterFrame('RaidenShogun') + 48
        s.eyeParticles += 0.5
        if (s.eyeParticles >= 1) {
          s.eyeParticles -= 1
          ctx.hit(100, {
            path: ['_particle', 'electro'],
            tag: 'other',
            element: 'electro',
            label: 'Eye of Stormy Judgement (particle)',
          })
        }
      }
    }
    // The Eye: a party member's hit (not the Eye's own strike) sets off a coordinated strike, 0.9 s
    // ICD; Electro-Charged, Burning and Hydro Swirl damage does not
    if (s.eyeStart === undefined || s.eyeEnd === undefined) return
    if (hit.t < s.eyeStart || hit.t >= s.eyeEnd || hit.t < s.eyeIcd) return
    if (hit.path[0] === 'skill' && hit.path[1] === 'coorDmg') return
    if (
      hit.path[0] === 'reaction' &&
      ['electrocharged', 'burning', 'hydroSwirl'].includes(hit.path[1])
    )
      return
    s.eyeIcd = hit.t + 54
    ctx.hit(5, {
      characterKey: 'RaidenShogun',
      path: ['skill', 'coorDmg'],
      tag: 'skill',
      element: 'electro',
      applies: true,
      durability: 25,
      icd: 'skill',
      label: 'Eye of Stormy Judgement (strike)',
    })
  },
  onPartyAction(ctx, s: RaidenState, actor, action) {
    if (actor === 'RaidenShogun' || action.kind !== 'burst') return
    const cost = energyCalcData[actor]?.burstCost
    if (!cost) {
      ctx.note(
        `Raiden: ${actor}'s burst energy cost is unavailable; Resolve cannot be calculated.`
      )
      return
    }
    const multiplier =
      ctx.constellation('RaidenShogun') >= 1
        ? getCharEle(actor) === 'electro'
          ? 1.8
          : 1.2
        : 1
    const level =
      ctx.calculate('RaidenShogun', ['total', 'burstIndex']) ??
      (ctx.constellation('RaidenShogun') >= 3 ? 12 : 9)
    const perEnergy = resolveGained[Math.min(resolveGained.length - 1, level)]
    s.resolve = Math.min(60, s.resolve + cost * perEnergy * multiplier)
  },
  onSwapOut(ctx, s: RaidenState) {
    // leaving the field ends Musou Isshin, and C4 starts then
    if (!inMusou(s, ctx)) return
    endMusou(ctx, s)
  },
}
