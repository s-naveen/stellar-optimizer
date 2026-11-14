import { HARMONY_MARK, REACTION_MARK } from '../lunarCrystallize'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/zibai, main as of 2026-11-10. */

/*
 * Constellations (gcsim cons.go): C1 100 Radiance at entry, 5 Strides, +220% on the first Stride's
 * 2nd hit; C2 +30% Lunar-Crystallize DMG for the party while in the mode (A1's Stride bonus grows
 * in the sheet); C4 keeps her normal sequence while in the mode, and a Stride that hits makes the
 * next N4's Lunar-Crystallize hit deal 250%; C6 gains Radiance 50% faster, and a Stride spends all
 * of it, elevating her Lunar-Crystallize DMG by 1.6% per point above 70 for 3 s.
 */

const zibaiNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 18,
    toCharged: 21,
    toAbil: 11,
    frames: 40,
  },
  {
    hitmarks: [12],
    hitlag: [5],
    toNormal: 18,
    toCharged: 36,
    toAbil: 12,
    frames: 36,
  },
  {
    hitmarks: [17, 27],
    hitlag: [5, 2],
    toNormal: 40,
    toCharged: 45,
    toAbil: 27,
    frames: 45,
  },
  {
    hitmarks: [27],
    hitlag: [6],
    toNormal: 57,
    toCharged: 67,
    toAbil: 27,
    frames: 67,
  },
]

interface ZibaiState {
  /** Frame the Lunar Phase Shift mode ends (undefined: not in it) */
  modeEnd?: number
  radiance: number
  /** Last frame radiance was settled (the ticker adds 10/s while in the mode) */
  radianceAt: number
  /** Radiance per tick (C6: 1.5) */
  rate: number
  strides: number
  /** Frames: ICDs of radiance from normal hits and from Lunar-Crystallize */
  normalIcd: number
  lcrIcd: number
  /** C2's party buff is on (follows the mode) and its expiry check */
  c2On: boolean
  modeCheck: number
  /** C4: her own normal sequence (it does not reset while in the mode), and Scattermoon
   * Splendor until */
  seq: number
  c4Until: number
}

/** C6: Radiance gains are 50% larger */
const gain = (c: number) => (c >= 6 ? 1.5 : 1)

const zibaiMaxStrides = (c: number) => (c >= 1 ? 5 : 4)

/** Bring Zibai's radiance up to `t` (the mode's ticker: +1 every 6 frames) */
function zibaiSettle(s: ZibaiState, t: number) {
  if (s.modeEnd === undefined) {
    s.radianceAt = t
    return
  }
  const until = Math.min(t, s.modeEnd)
  if (until > s.radianceAt)
    s.radiance = Math.min(
      100,
      s.radiance + Math.floor((until - s.radianceAt) / 6) * s.rate
    )
  s.radianceAt += Math.max(0, Math.floor((until - s.radianceAt) / 6)) * 6
  if (t >= s.modeEnd) s.modeEnd = undefined
}

/** C2: the party's Lunar-Crystallize bonus follows the mode (rechecked when the mode may end) */
function syncMode(ctx: SimContext, s: ZibaiState) {
  if (ctx.constellation('Zibai') < 2) return
  zibaiSettle(s, ctx.now)
  const on = s.modeEnd !== undefined
  if (on !== s.c2On) {
    s.c2On = on
    ctx.state('Zibai', ['Zibai', 'c2ShiftMode'], on ? 'on' : '')
  }
  if (!on) return
  const id = ++s.modeCheck
  ctx.at(Math.max(1, s.modeEnd! - ctx.now), (c) => {
    if (id === s.modeCheck) syncMode(c, s)
  })
}

export const kit: KitModel = {
  characterKey: 'Zibai',
  moonsign: 1,
  element: 'geo',
  source: `${GCSIM}/zibai`,
  init: (): ZibaiState => ({
    radiance: 0,
    radianceAt: 0,
    strides: 0,
    normalIcd: -1e9,
    lcrIcd: -1e9,
    rate: 1,
    c2On: false,
    modeCheck: 0,
    seq: 0,
    c4Until: -1,
  }),
  actionReadyAt(ctx, state: ZibaiState, action) {
    if (action.kind !== 'skill') return ctx.now
    const s = { ...state }
    zibaiSettle(s, ctx.now)
    return s.modeEnd !== undefined && s.radiance < 70 ? ctx.now + 1 : ctx.now
  },
  act(ctx, s: ZibaiState, action, previous) {
    zibaiSettle(s, ctx.now)
    const inMode = s.modeEnd !== undefined
    const c = ctx.constellation('Zibai')
    s.rate = gain(c)
    // gcsim resets the normal sequence on any other action, except (C4) while in the mode; an
    // E that starts the mode counts as in it
    if (
      action.kind !== 'normal' &&
      !(c >= 4 && (inMode || action.kind === 'skill'))
    )
      s.seq = 0
    switch (action.kind) {
      case 'normal': {
        // C4: her own sequence (the engine's resets on every other action)
        const seqCtx: SimContext =
          c >= 4
            ? {
                ...ctx,
                normalSequence: (length, count) => {
                  const first = s.seq % length
                  s.seq = (first + count) % length
                  return first
                },
              }
            : ctx
        return normalString(
          zibaiNormals,
          action.count ?? 1,
          (i, d, j) => {
            if (!inMode) {
              ctx.hit(d, {
                path: ['normal', `${i}`],
                tag: 'normal',
                element: 'physical',
                applies: true,
                icd: 'normal',
                label: `N${i + 1}`,
              })
              return
            }
            ctx.hit(d, {
              path: ['skill', `shift${i + 1}Dmg`],
              tag: 'normal',
              element: 'geo',
              applies: true,
              icd: 'normal',
              label: `Phase Shift N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            })
            // the 4th hit's extra Lunar-Crystallize hit (Ascendant Gleam), 20 frames later
            if (i === 3 && ctx.moonsign >= 2)
              ctx.hit(d + 20, {
                path: ['skill', 'shift4GleamDmg'],
                tag: 'directLunarCrystallize',
                element: 'geo',
                // (Geo 25, ICD none: it can react)
                applies: true,
                label: 'Phase Shift N4 (Lunar-Crystallize)',
              })
          },
          seqCtx
        )
      }
      case 'charged': {
        for (let j = 0; j < 2; j++)
          ctx.hit(32, {
            path: inMode ? ['skill', 'shiftCaDmg'] : ['charged', 'dmg'],
            tag: 'charged',
            element: inMode ? 'geo' : 'physical',
            applies: true,
            icd: 'normal',
            label: inMode ? 'Phase Shift Charged Attack' : 'Charged Attack',
          })
        return {
          frames: 72,
          framesInto: { skill: 70, burst: 70, dash: 32, jump: 32, swap: 69 },
        }
      }
      case 'skill': {
        if (!inMode) {
          // Heaven and Earth Made Manifest: the Lunar Phase Shift mode, 918 frames
          ctx.at(18, (c2) => {
            s.modeEnd = c2.now + 900
            s.radianceAt = c2.now
            s.radiance = Math.min(100, s.radiance + gain(c))
            s.strides = 0
            if (c >= 1) s.radiance = 100
            syncMode(c2, s)
          })
          // gcsim's zero-damage hit where the mode starts (also C1's first-Stride reset)
          ctx.hit(18, {
            path: ['skill', 'castDmg'],
            tag: 'other',
            element: 'physical',
            label: 'Lunar Phase Shift (0 DMG)',
          })
          ctx.buff('Zibai', ['Zibai', 'a1Moonfall'], 'on', 18, 240)
          if (c >= 1)
            // the first Stride's 2nd hit of this mode: +220% (see `countedBuffs`)
            ctx.note('Zibai C1: the first Stride of each mode gets +220%.')
          return {
            frames: 52,
            framesInto: {
              normal: 28,
              skill: 28,
              burst: 29,
              dash: 27,
              jump: 27,
              swap: 52,
            },
            cooldown: { key: 'skill', frames: 1080, delay: 18 },
          }
        }
        // Spirit Steed's Stride: 70 radiance
        if (s.radiance < 70)
          return {
            frames: 0,
            failed: `Zibai: not enough Phase Shift Radiance for Stride (${s.radiance}/70)`,
          }
        // C6: spend all of it; each point above 70 elevates her Lunar-Crystallize DMG by 1.6%
        // for 3 s (on her hitlag clock)
        if (c >= 6) {
          const points = Math.min(30, Math.round(s.radiance - 70))
          if (points > 0)
            ctx.buff('Zibai', ['Zibai', 'c6Point'], `${points}`, 0, 180, {
              hitlag: 'recipient',
            })
          s.radiance = 0
        } else s.radiance -= 70
        s.lcrIcd = -1e9
        s.strides++
        ctx.hit(30, {
          path: ['skill', 'stride1Dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          label: "Spirit Steed's Stride (1st)",
        })
        ctx.hit(36, {
          path: ['skill', 'stride2Dmg'],
          tag: 'directLunarCrystallize',
          element: 'geo',
          label: "Spirit Steed's Stride (2nd, Lunar-Crystallize)",
        })
        if (s.strides >= zibaiMaxStrides(c)) {
          s.modeEnd = ctx.now
          syncMode(ctx, s)
        }
        for (const t of [30, 36])
          ctx.hit(t, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 2,
            label: 'Stride hitlag',
          })
        return withHitlag(
          {
            frames: 61,
            framesInto: {
              normal: 45,
              skill: 54,
              burst: 45,
              dash: 42,
              jump: 43,
              swap: 61,
            },
          },
          { hitmarks: [30, 34], hitlag: [2, 2] }
        )
      }
      case 'burst': {
        ctx.hit(95, {
          path: ['burst', 'skill1Dmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          label: 'Burst',
        })
        ctx.hit(95, {
          path: ['burst', 'skill2Dmg'],
          tag: 'directLunarCrystallize',
          element: 'geo',
          label: 'Burst (Lunar-Crystallize)',
        })
        if (inMode) {
          s.modeEnd = (s.modeEnd ?? ctx.now) + 102
          syncMode(ctx, s)
        }
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 103,
          framesInto: {
            normal: 97,
            skill: 98,
            dash: 98,
            jump: 99,
            swap: 96,
          },
        }
      }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Stride (in the mode) has no cooldown: it is gated by radiance
  cooldownKey: (s: ZibaiState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.modeEnd === undefined
        ? 'skill'
        : undefined,
  onHit(ctx, s: ZibaiState, hit) {
    // A1 Selenic Descent: also on any Moondrift Harmony
    if (hit.path[0] === HARMONY_MARK[0] && hit.path[1] === HARMONY_MARK[1])
      ctx.buff('Zibai', ['Zibai', 'a1Moonfall'], 'on', 0, 240)
    if (hit.characterKey === 'Zibai' && ctx.constellation('Zibai') >= 4) {
      // C4: a Stride that hits gives Scattermoon Splendor (30 s); the next N4 Lunar-Crystallize
      // hit uses it up for 250%
      if (hit.path[1] === 'stride1Dmg' || hit.path[1] === 'stride2Dmg')
        s.c4Until = hit.t + 1800
      else if (hit.path[1] === 'shift4GleamDmg' && hit.t < s.c4Until) {
        s.c4Until = -1
        hit.states = [
          ...(hit.states ?? []),
          { owner: 'Zibai', path: ['Zibai', 'c4Splendor'], value: 'on' },
        ]
      }
    }
    zibaiSettle(s, hit.t)
    if (s.modeEnd === undefined) return
    // +5 radiance per Phase Shift normal hit (30-frame ICD), +35 per Lunar-Crystallize
    // reaction (240-frame ICD, reset by Stride)
    if (
      hit.characterKey === 'Zibai' &&
      (hit.path[1]?.startsWith('shift') ?? false) &&
      hit.path[1] !== 'shiftCaDmg' &&
      hit.t - s.normalIcd >= 30
    ) {
      s.radiance = Math.min(100, s.radiance + 5 * s.rate)
      s.normalIcd = hit.t
    }
    if (
      hit.path[1] === REACTION_MARK[1] &&
      hit.path[0] === REACTION_MARK[0] &&
      hit.t - s.lcrIcd >= 240
    ) {
      s.radiance = Math.min(100, s.radiance + 35 * s.rate)
      s.lcrIcd = hit.t
    }
  },
  onSwapOut(ctx, s: ZibaiState) {
    zibaiSettle(s, ctx.now)
    s.modeEnd = undefined
    s.seq = 0
    // (upstream gcsim's C4 also drops Scattermoon Splendor when she leaves the field)
    s.c4Until = -1
    syncMode(ctx, s)
  },
  // her hitlag extends the mode (gcsim AddStatus(…, true)); the Radiance ticker keeps world time
  onHitlag(ctx, s: ZibaiState, frames) {
    zibaiSettle(s, ctx.now)
    if (s.modeEnd !== undefined) s.modeEnd += frames
  },
  countedBuffs(hits, c) {
    // C1: the first Stride's 2nd hit after each mode entry
    if (c < 1) return { buffs: [], extraHits: [] }
    const covered = new Set<number>()
    let armed = false
    hits.forEach((h, i) => {
      if (h.characterKey !== 'Zibai') return
      if (h.label.startsWith('Lunar Phase Shift')) armed = true
      if (h.path[1] === 'stride2Dmg' && armed) {
        covered.add(i)
        armed = false
      }
    })
    return {
      buffs: [
        {
          owner: 'Zibai',
          path: ['Zibai', 'c1FirstStride'],
          value: 'on',
          hits: covered,
        },
      ],
      extraHits: [],
    }
  },
}
