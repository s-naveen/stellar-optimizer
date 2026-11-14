import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/hutao, main as of 2026-11-10. */

/** Normal attack string (N1..N6): hitmarks, cancels and frames, as gcsim's default (no Paramita) */
const normals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [5],
    toNormal: 14,
    toCharged: 20,
    toAbil: 12,
    frames: 20,
  },
  {
    hitmarks: [9],
    hitlag: [5],
    toNormal: 12,
    toCharged: 16,
    toAbil: 9,
    frames: 16,
  },
  {
    hitmarks: [17],
    hitlag: [5],
    toNormal: 26,
    toCharged: 23,
    toAbil: 17,
    frames: 26,
  },
  {
    hitmarks: [22],
    hitlag: [5],
    toNormal: 29,
    toCharged: 31,
    toAbil: 22,
    frames: 31,
  },
  {
    hitmarks: [16, 26],
    hitlag: [2, 5],
    toNormal: 37,
    toCharged: 48,
    toAbil: 26,
    frames: 48,
  },
  {
    hitmarks: [23],
    hitlag: [6],
    toNormal: 72,
    toCharged: 72,
    toAbil: 23,
    frames: 72,
  },
]

/** The same string in Paramita Papilio (the 5th and 6th hits differ) */
const paramitaNormals: NormalHit[] = [
  normals[0],
  // (gcsim: Paramita N2 into a charged attack counts world time)
  { ...normals[1], normalizedInto: ['charged'] },
  normals[2],
  normals[3],
  { hitmarks: [15, 26], toNormal: 36, toCharged: 48, toAbil: 26, frames: 48 },
  { hitmarks: [27], toNormal: 72, toCharged: 72, toAbil: 27, frames: 72 },
]

/** The sheet's normal nodes of each hit of the string (the 5th hit has two: '4' and '5') */
const normalNodes: string[][] = [['0'], ['1'], ['2'], ['3'], ['4', '5'], ['6']]

/** Paramita Papilio lasts 540 + 14 frames from the skill */
const PARAMITA = 540 + 14
/**
 * A Paramita charged attack extends the stance by 1.8 s while it lasts (gcsim's "pp slide"): the
 * extension is taken back when the attack ends, unless it is cancelled into her burst
 */
const PARAMITA_CA_EXTENSION = 108
/** The Paramita charged attack's animation (gcsim's AnimationLength) */
const PP_CHARGE_FRAMES = 42
/** A1 (Flutter By): the other members' CRIT Rate for 8 s, when the stance ends */
const A1_FRAMES = 8 * 60
/** Blood Blossom: a 570-frame debuff on the enemy (refreshed by each application); ticks every 240 */
const BB_DURATION = 570
const BB_INTERVAL = 240

type HuTaoHit = Parameters<SimContext['hit']>[1]

interface HuTaoState {
  /** Paramita Papilio ends at this frame (undefined: not up) */
  paramitaEnd?: number
  /** A1 is owed to the team (it is given when the stance ends) */
  a1Owed: boolean
  /** Blood Blossom is on the enemy (the latest application's `bbVersion`); its ticks run from `bbSrc` */
  bbLive: boolean
  bbVersion: number
  bbSrc: number
  /** The last normal attack string's last hit (0-based), while it is her last action */
  lastNormal?: number
  /** A Paramita charged attack's pending 1.8 s extension (its id; 0: none) */
  slide: number
  /** C6's 60 s cooldown ends */
  c6Ready: number
}

const inStance = (s: HuTaoState, t: number) =>
  s.paramitaEnd !== undefined && t < s.paramitaEnd

/** The stance's conditional, as the hit's own state (it stands at its snapshot and impact) */
const stanceState = (on: boolean) => ({
  owner: 'HuTao' as const,
  path: ['HuTao', 'GuideToAfterlifeVoyage'],
  value: on ? 'on' : '',
})

/**
 * A hit of hers. The stance is not a window on the sheet's conditional (it ends early on a swap,
 * and a window can't be cut): each hit carries it, as it is at the hit's frame, or at `at` (gcsim
 * snapshots the charged attack and the burst at the cast; carried as states here, since a stat
 * snapshot would not keep the hit's own states)
 */
function hitAt(
  ctx: SimContext,
  s: HuTaoState,
  delay: number,
  hit: HuTaoHit,
  at = delay
) {
  ctx.hit(delay, {
    ...hit,
    states: [...(hit.states ?? []), stanceState(inStance(s, ctx.now + at))],
  })
}

/** The charged attack's pending stance extension is taken back (gcsim's OnRemoved) */
function endSlide(c: SimContext, s: HuTaoState) {
  if (!s.slide) return
  s.slide = 0
  if (s.paramitaEnd === undefined) return
  const end = s.paramitaEnd - PARAMITA_CA_EXTENSION
  s.paramitaEnd = end
  if (c.now >= end) endStance(c, s, end)
  else c.at(end - c.now, (c2) => endStance(c2, s, end))
}

/**
 * Tracked HP (when the simulation has it): A4 below or at 50% HP, and C6 below 25% (10 s, once per
 * 60 s)
 */
function onHp(c: SimContext, s: HuTaoState) {
  const ratio = c.hpRatio('HuTao')
  if (ratio === undefined) return
  c.state('HuTao', ['HuTao', 'SanguineRouge'], ratio <= 0.5 ? 'on' : '')
  if (c.constellation('HuTao') >= 6 && ratio <= 0.25 && c.now >= s.c6Ready) {
    s.c6Ready = c.now + 3600
    c.buff('HuTao', ['HuTao', 'ButterflysEmbrace'], 'on', 0, 600, {
      hitlag: 'recipient',
    })
  }
}

/**
 * gcsim's charged attacks are deployable: no hitlag for her, but the enemy freezes for the defense
 * halt (3.6 frames, so 4)
 */
const chargedEnemyHitlag = (ctx: SimContext, delay: number) =>
  ctx.hit(delay, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: 0,
    enemyAnimationPause: 4,
    label: 'Enemy hitlag (deployable)',
  })

/**
 * Blood Blossom is applied (its ticks restart if it was off). (gcsim: an enemy status refreshed to
 * 570 frames, extended by enemy hitlag and active on its expiry frame; ticks on the enemy queue.)
 */
function applyBB(c: SimContext, s: HuTaoState) {
  if (!s.bbLive) {
    s.bbSrc = c.now
    c.atEnemy(BB_INTERVAL, bbTick(s, c.now))
  }
  s.bbLive = true
  const version = ++s.bbVersion
  c.atEnemy(BB_DURATION + 1, () => {
    if (s.bbVersion === version) s.bbLive = false
  })
}

const bbTick = (s: HuTaoState, src: number) => (c: SimContext) => {
  if (src !== s.bbSrc || !s.bbLive) return
  c.hit(0, {
    states: [stanceState(inStance(s, c.now))],
    characterKey: 'HuTao',
    path: ['skill', 'dmg'],
    tag: 'skill',
    element: 'pyro',
    applies: true,
    icd: 'none',
    label: 'Blood Blossom',
  })
  c.atEnemy(BB_INTERVAL, bbTick(s, src))
}

/** The stance ends (by time: A1 is given now, unless a swap already ended it) */
function endStance(c: SimContext, s: HuTaoState, end: number) {
  if (s.paramitaEnd !== end) return
  s.paramitaEnd = undefined
  if (s.a1Owed) {
    s.a1Owed = false
    c.buff('HuTao', ['HuTao', 'FlutterBy'], 'on', 0, A1_FRAMES)
  }
}

/** The charged attack's dash and jump frames after a normal string ending in hit `last` */
function ppChargeCancels(last: number | undefined): {
  dash: number
  jump: number
} {
  switch (last) {
    case 0:
      return { dash: 1, jump: 2 }
    case 1:
      return { dash: 4, jump: 5 }
    case 2:
      return { dash: 2, jump: 2 }
    default:
      // no normal before it, or N4, N5; gcsim has no cancel after N6 (taken as N5's)
      return { dash: 3, jump: 3 }
  }
}

export const kit: KitModel = {
  characterKey: 'HuTao',
  element: 'pyro',
  source: `${GCSIM}/hutao`,
  init: (): HuTaoState => ({
    a1Owed: false,
    bbLive: false,
    bbVersion: 0,
    bbSrc: -1,
    slide: 0,
    c6Ready: 0,
  }),
  onHpChange(ctx, s: HuTaoState, change) {
    if (change.characterKey === 'HuTao') onHp(ctx, s)
  },
  act(ctx, s: HuTaoState, action, previous) {
    const cons = ctx.constellation('HuTao')
    // the next action ends a Paramita charged attack: its extension stays only into the burst
    if (s.slide) {
      if (action.kind === 'burst') s.slide = 0
      else endSlide(ctx, s)
    }
    const stanceNow = inStance(s, ctx.now)
    switch (action.kind) {
      case 'normal': {
        const count = Math.min(action.count ?? 1, normals.length)
        s.lastNormal = count - 1
        const table = stanceNow ? paramitaNormals : normals
        return normalString(
          table,
          count,
          (i, d, j) =>
            hitAt(ctx, s, d, {
              path: ['normal', normalNodes[i][j]],
              tag: 'normal',
              element: stanceNow ? 'pyro' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      }
      case 'charged': {
        const last = s.lastNormal
        s.lastNormal = undefined
        if (stanceNow) {
          // Paramita charged attack: snapshotted at the cast, it lands 3 frames in and applies
          // Blood Blossom; the stance is extended by 1.8 s while it lasts (see endSlide)
          const end = s.paramitaEnd! + PARAMITA_CA_EXTENSION
          s.paramitaEnd = end
          ctx.at(end - ctx.now, (c2) => endStance(c2, s, end))
          const slide = ++s.slide
          ctx.atCharacter('HuTao', PP_CHARGE_FRAMES + 1, (c2) => {
            if (s.slide === slide) endSlide(c2, s)
          })
          hitAt(
            ctx,
            s,
            3,
            {
              path: ['charged', 'dmg'],
              tag: 'charged',
              element: 'pyro',
              applies: true,
              icd: 'PoleExtraAttack',
              label: 'Paramita Charged Attack',
            },
            0
          )
          chargedEnemyHitlag(ctx, 3)
          ctx.at(3, (c2) => applyBB(c2, s))
          const cancels = ppChargeCancels(last)
          return {
            frames: PP_CHARGE_FRAMES,
            framesInto: { burst: 33, dash: cancels.dash, jump: cancels.jump },
          }
        }
        hitAt(ctx, s, 19, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        chargedEnemyHitlag(ctx, 19)
        return {
          frames: 62,
          framesInto: { normal: 57, skill: 60, dash: 19, jump: 19 },
        }
      }
      case 'plunge': {
        s.lastNormal = undefined
        // (the low plunge; the high plunge and the collision (only when asked) are not modelled)
        if (stanceNow) {
          hitAt(ctx, s, 45, {
            path: ['plunging', 'low'],
            tag: 'plunge',
            element: 'pyro',
            applies: true,
            icd: 'none',
            label: 'Low Plunge (Paramita Papilio)',
          })
          return {
            frames: 75,
            framesInto: { normal: 58, skill: 58, burst: 58, swap: 61 },
          }
        }
        hitAt(ctx, s, 44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 75,
          framesInto: { normal: 58, skill: 59, burst: 59, jump: 74, swap: 61 },
        }
      }
      case 'skill': {
        s.lastNormal = undefined
        // Paramita Papilio: the stance, and 30% of her current HP drained (tracked HP only; its
        // 0-damage attack is not modelled)
        const end = ctx.now + PARAMITA
        s.paramitaEnd = end
        s.a1Owed = true
        ctx.at(PARAMITA, (c2) => endStance(c2, s, end))
        if (ctx.healthTracked)
          ctx.drainHp('HuTao', 0.3 * (ctx.hpRatio('HuTao') ?? 1))
        else
          ctx.note(
            'HuTao: HP is not tracked: A4 (50% HP or less), the low-HP Spirit Soother and C6 follow the team conditionals.'
          )
        return {
          cooldown: { key: 'skill', frames: 960, delay: 14 },
          frames: 52,
          framesInto: { normal: 29, burst: 28, dash: 37, jump: 37 },
        }
      }
      case 'burst': {
        s.lastNormal = undefined
        // 50% HP or less at the cast (tracked HP): the low-HP damage and regeneration, and A4 as
        // it is at the cast (its heal lands on the same frame as the hit)
        const hp = ctx.hpRatio('HuTao')
        const low = (hp ?? 1) <= 0.5
        hitAt(
          ctx,
          s,
          66,
          {
            path: ['burst', low ? 'lowHpDmg' : 'dmg'],
            tag: 'burst',
            element: 'pyro',
            applies: true,
            durability: 50,
            icd: 'none',
            label: low ? 'Spirit Soother (Low HP)' : 'Spirit Soother',
            ...(hp !== undefined
              ? {
                  states: [
                    {
                      owner: 'HuTao' as const,
                      path: ['HuTao', 'SanguineRouge'],
                      value: low ? 'on' : '',
                    },
                  ],
                }
              : {}),
          },
          0
        )
        if (ctx.healthTracked)
          ctx.hit(66, {
            path: ['_heal', 'burst', low ? 'lowHpRegen' : 'regen'],
            tag: 'other',
            element: 'physical',
            healTargets: ['HuTao'],
            label: 'Spirit Soother (Heal)',
          })
        // C2: the burst applies Blood Blossom
        if (cons >= 2) ctx.at(66, (c2) => applyBB(c2, s))
        return {
          cooldown: { key: 'burst', frames: 900, delay: 62 },
          frames: 98,
          framesInto: { normal: 97, skill: 97, swap: 95 },
        }
      }
      case 'dash':
        s.lastNormal = undefined
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        s.lastNormal = undefined
        // (her body's jump: 31 frames, 34 after a dash)
        return templateJump('girl', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // (gcsim: Paramita is a hitlag-extended buff: her hitlag pushes its end back)
  onHitlag(ctx, s: HuTaoState, frames) {
    if (!frames || !inStance(s, ctx.now)) return
    const end = s.paramitaEnd! + frames
    s.paramitaEnd = end
    ctx.at(end - ctx.now, (c2) => endStance(c2, s, end))
  },
  onSwapOut(ctx, s: HuTaoState) {
    // a swap ends the stance (and gives A1 to the team); her last normal no longer counts
    s.lastNormal = undefined
    s.slide = 0
    if (s.paramitaEnd === undefined) return
    s.paramitaEnd = undefined
    if (s.a1Owed) {
      s.a1Owed = false
      ctx.buff('HuTao', ['HuTao', 'FlutterBy'], 'on', 0, A1_FRAMES)
    }
  },
}
