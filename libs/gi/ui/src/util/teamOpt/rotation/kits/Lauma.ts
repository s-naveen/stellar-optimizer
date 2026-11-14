import type { KitModel, SimContext } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/lauma. */

// Normal attack string: gcsim's InitNormalCancelSlice, with the charged override (17, 19, 33)
const laumaNormals: NormalHit[] = [
  { hitmarks: [14], toNormal: 29, toCharged: 17, toAbil: 14, frames: 29 },
  { hitmarks: [11], toNormal: 33, toCharged: 19, toAbil: 11, frames: 33 },
  { hitmarks: [16], toNormal: 38, toCharged: 33, toAbil: 16, frames: 38 },
]

/** The Spirit Envoy's transformation, before its status starts */
const deerTransformation = 49
interface HymnPool {
  count: number
  end: number
}
type HymnKind = 'burst' | 'song' | 'c6'

interface LaumaState {
  pools: Record<HymnKind, HymnPool>
  burstEnd: number
  songUsed: boolean
  song: number
  songEnd: number
  /** Spirit Envoy: its status runs over [deerStart, deerEnd) */
  deerStart: number
  deerEnd: number
  /** The latest skill's frame: its Frostgrove ticks stop when a new skill is cast */
  skillSrc: number
  /** C6: Frostgrove Sanctuary's Lunar-Bloom hits this skill (max 8) */
  c6Count: number
}

const deerActive = (s: LaumaState, t: number) =>
  t >= s.deerStart && t < s.deerEnd
/** Spirit Envoy can be entered again 4 s after it ends (gcsim: 240 frames, less with A4) */
const deerReady = (s: LaumaState, t: number) => t >= s.deerEnd + 240

/** Any action other than a jump ends the Spirit Envoy state */
function endDeer(s: LaumaState, t: number) {
  if (deerActive(s, t)) s.deerEnd = t
}

function syncHymn(ctx: SimContext, s: LaumaState) {
  for (const pool of Object.values(s.pools))
    if (pool.end <= ctx.now) pool.count = 0
  const active = Object.values(s.pools).some((p) => p.count > 0)
  ctx.state('Lauma', ['Lauma', 'burstPaleHymn'], active ? 'on' : '')
  return active
}
function setHymn(
  ctx: SimContext,
  s: LaumaState,
  kind: HymnKind,
  count: number
) {
  const pool = { count, end: ctx.now + 900 }
  s.pools[kind] = pool
  syncHymn(ctx, s)
  ctx.at(900, (c) => {
    if (s.pools[kind] === pool) syncHymn(c, s)
  })
}
/** C6: a Frostgrove Lunar-Bloom hit adds 2 Pale Hymn stacks and refreshes their 15 s */
function addC6Hymn(ctx: SimContext, s: LaumaState, count: number) {
  const pool = s.pools.c6
  pool.count = (pool.end > ctx.now ? pool.count : 0) + count
  pool.end = ctx.now + 900
  syncHymn(ctx, s)
  ctx.at(900, (c) => syncHymn(c, s))
}
/** Spend one Pale Hymn stack (C6's first, then the Moon Song's, then the burst's) */
function spendHymn(ctx: SimContext, s: LaumaState) {
  for (const kind of ['c6', 'song', 'burst'] as const) {
    if (s.pools[kind].count > 0) {
      s.pools[kind].count--
      break
    }
  }
  syncHymn(ctx, s)
}
function moonSong(ctx: SimContext, s: LaumaState, count: number) {
  if (!count) return
  if (ctx.now < s.burstEnd && !s.songUsed) {
    setHymn(ctx, s, 'song', 6 * count)
    s.songUsed = true
    s.song = 0
  } else {
    s.song = count
    s.songEnd = ctx.now + 900
  }
}

export const kit: KitModel = {
  characterKey: 'Lauma',
  moonsign: 1,
  element: 'dendro',
  source: `${KQMSIM}/lauma`,
  init: (): LaumaState => ({
    pools: {
      burst: { count: 0, end: -1 },
      song: { count: 0, end: -1 },
      c6: { count: 0, end: -1 },
    },
    burstEnd: -1,
    songUsed: false,
    song: 0,
    songEnd: -1,
    deerStart: -1e9,
    deerEnd: -1e9,
    skillSrc: -1,
    c6Count: 0,
  }),
  onHit(ctx, s: LaumaState, hit) {
    const direct =
      hit.label.includes('Lunar-Bloom') && !hit.path[0].startsWith('_')
    const core =
      hit.path[0] === 'reaction' &&
      ['bloom', 'bountiful', 'hyperbloom', 'burgeon'].includes(hit.path[1])
    if (!(direct || core)) return
    const active = syncHymn(ctx, s)
    // Native applies the bonus before spending a stack; preserve it on this hit.
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Lauma',
        path: ['Lauma', 'burstPaleHymn'],
        value: active ? 'on' : '',
      },
    ]
    // (C6's Frostgrove Lunar-Bloom hit does not spend a stack: it adds 2)
    if (
      !active ||
      (hit.characterKey === 'Lauma' &&
        hit.path[0] === 'constellation6' &&
        hit.path[1] === 'dmg1')
    )
      return
    spendHymn(ctx, s)
  },
  act(ctx, s: LaumaState, action, previous) {
    const c = ctx.constellation('Lauma')
    const now = ctx.now
    switch (action.kind) {
      case 'normal':
        endDeer(s, now)
        return normalString(
          laumaNormals,
          action.count ?? 1,
          (i, d) => {
            const hitmark = laumaNormals[i].hitmarks[0]
            // C6: a normal attack started with Pale Hymn stacks spends one and becomes Lunar-Bloom
            // DMG (150% EM, no Dendro application); its hit then spends another for the bonus
            ctx.at(d - hitmark, (c2) => {
              const converted = c >= 6 && syncHymn(c2, s)
              if (converted) spendHymn(c2, s)
              c2.hit(
                hitmark,
                converted
                  ? {
                      path: ['constellation6', 'dmg2'],
                      tag: 'other',
                      element: 'dendro',
                      applies: false,
                      icd: 'none',
                      label: `N${i + 1} (C6, Lunar-Bloom)`,
                    }
                  : {
                      path: ['normal', `${i}`],
                      tag: 'normal',
                      element: 'dendro',
                      applies: true,
                      icd: 'normal',
                      label: `N${i + 1}`,
                    }
              )
            })
          },
          ctx
        )
      case 'charged': {
        if (!deerActive(s, now) && deerReady(s, now)) {
          // Spirit Envoy: enter it (no damage); the status starts after the transformation,
          // lasting 10 s (+5 s at C1)
          s.deerStart = now + deerTransformation
          s.deerEnd = now + deerTransformation + 600 + (c >= 1 ? 300 : 0)
          return {
            frames: 64,
            framesInto: {
              normal: 61,
              charged: 63,
              burst: 63,
              skill: 63,
              swap: 49,
              jump: 49,
            },
          }
        }
        // Spiritcall Prayer: the charged attack (ends the Spirit Envoy state)
        endDeer(s, now)
        ctx.hit(73, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Spiritcall Prayer',
        })
        return {
          frames: 68,
          framesInto: {
            normal: 67,
            skill: 67,
            burst: 67,
            dash: 67,
            jump: 67,
            swap: 67,
            charged: deerReady(s, now) ? 67 : 68,
          },
        }
      }
      case 'skill': {
        endDeer(s, now)
        // A1 (the bloom crit, on the sheet's ascension) for 20 s; C1 (the heal) is not modelled
        ctx.buff('Lauma', ['Lauma', 'a1AfterSkill'], 'on', 0, 1200)
        // Frostgrove Sanctuary: 8 ticks from 62 frames, 117 apart, for 15 s; each tick shreds RES
        // for 10 s (the cond) and at C6 adds a Lunar-Bloom hit (max 8 per skill)
        s.skillSrc = now
        s.c6Count = 0
        // C6: the skill removes the Pale Hymn stacks C6 gave
        if (c >= 6) {
          s.pools.c6 = { count: 0, end: -1 }
          syncHymn(ctx, s)
        }
        const src = now
        for (let i = 0; i < 8; i++)
          ctx.at(62 + 117 * i, (c2) => {
            if (s.skillSrc !== src) return
            frostgroveTick(c2, s)
          })
        if (action.hold) return holdSkill(ctx, s)
        ctx.hit(16, {
          path: ['skill', 'pressDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Hymn of Hunting',
        })
        ctx.buff('Lauma', ['Lauma', 'skillAfterHit'], 'on', 16, 600)
        return {
          cooldown: { key: 'skill', frames: 720, delay: 13 },
          frames: 42,
          framesInto: {
            normal: 38,
            charged: 38,
            burst: 38,
            dash: 37,
            jump: 38,
            swap: 36,
          },
        }
      }
      case 'burst': {
        endDeer(s, now)
        s.burstEnd = -1
        s.songUsed = false
        ctx.at(96, (c) => {
          s.burstEnd = c.now + 900
          setHymn(c, s, 'burst', 18)
          if (c.now < s.songEnd && s.song > 0) moonSong(c, s, s.song)
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 115,
          framesInto: {
            normal: 111,
            charged: deerReady(s, now) ? 115 : 110,
            skill: 110,
            dash: 111,
            swap: 109,
          },
        }
      }
      case 'dash':
        if (deerActive(s, now))
          return {
            frames: 0,
            failed: 'Lauma: no dash in the Spirit Envoy state',
          }
        // Lady body: 22 frames, jump after 3
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        if (deerActive(s, now))
          return {
            frames: 0,
            failed: 'Lauma: jump in the Spirit Envoy state is not modelled',
          }
        // Lady body: 32 frames (37 after a dash)
        return templateJump('lady', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: LaumaState) {
    endDeer(s, ctx.now)
  },
}

/** The Hymn of Eternal Rest (hold): a Dendro hit, and a Lunar-Bloom hit 45 frames in */
function holdSkill(ctx: SimContext, s: LaumaState) {
  ctx.hit(45, {
    path: ['skill', 'hold1Dmg'],
    tag: 'skill',
    element: 'dendro',
    applies: true,
    icd: 'none',
    label: 'Hymn of Eternal Rest',
  })
  ctx.at(29, (c) => {
    const dew = c.consumeDew(Math.min(c.dew, 3))
    moonSong(c, s, dew)
    if (!dew) return
    c.hit(16, {
      path: ['skill', 'hold2Dmg'],
      tag: 'other',
      element: 'dendro',
      applies: false,
      icd: 'none',
      label: `Hymn of Eternal Rest (Lunar-Bloom, ${dew} Dew)`,
      states: [
        {
          owner: 'Lauma',
          path: ['Lauma', 'skillVerdantDew'],
          value: String(dew),
        },
      ],
    })
  })
  ctx.buff('Lauma', ['Lauma', 'skillAfterHit'], 'on', 45, 600)
  return {
    cooldown: { key: 'skill', frames: 720, delay: 13 },
    frames: 64,
    framesInto: { normal: 57, charged: 57, burst: 58, jump: 57, swap: 56 },
  }
}

/** A Frostgrove Sanctuary tick: Dendro damage, the RES shred, and at C6 a Lunar-Bloom hit 16 later */
function frostgroveTick(c: SimContext, s: LaumaState) {
  c.hit(0, {
    path: ['skill', 'frostgroveDmg'],
    tag: 'skill',
    element: 'dendro',
    applies: true,
    icd: 'none',
    label: 'Frostgrove Sanctuary',
  })
  c.buff('Lauma', ['Lauma', 'skillAfterHit'], 'on', 0, 600)
  if (c.constellation('Lauma') >= 6 && s.c6Count < 8) {
    s.c6Count++
    c.hit(16, {
      path: ['constellation6', 'dmg1'],
      tag: 'other',
      element: 'dendro',
      applies: false,
      icd: 'none',
      label: 'Frostgrove Sanctuary C6 (Lunar-Bloom)',
    })
    // its hit gives 2 Pale Hymn stacks (refreshing those C6 gave)
    c.at(16, (c2) => addC6Hymn(c2, s, 2))
  }
}
