import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xilonen, main as of 2026-11-10. */

const xilonenNormals: NormalHit[] = [
  {
    hitmarks: [18],
    hitlag: [6],
    toNormal: 20,
    toCharged: 26,
    toAbil: 18,
    frames: 34,
  },
  {
    hitmarks: [16, 32],
    hitlag: [6, 6],
    worldTimeHits: true,
    toNormal: 46,
    toCharged: 39,
    toAbil: 32,
    frames: 57,
  },
  {
    hitmarks: [22],
    hitlag: [8],
    toNormal: 57,
    toCharged: 70,
    toAbil: 22,
    frames: 70,
  },
]

/** Our sheet's node for each hit: N2's two hits share one node (2 x 2) */
const xilonenNodes = [[0], [1, 1], [2]]

/** Blade Roller (in Nightsoul): four steps, one hit each (our sheet's ns0 to ns3) */
const rollerNormals: NormalHit[] = [
  {
    hitmarks: [17],
    hitlag: [6],
    toNormal: 20,
    toCharged: 44,
    toAbil: 17,
    frames: 44,
  },
  {
    hitmarks: [17],
    hitlag: [2],
    toNormal: 28,
    toCharged: 48,
    toAbil: 17,
    frames: 48,
  },
  {
    hitmarks: [22],
    hitlag: [2],
    toNormal: 30,
    toCharged: 50,
    toAbil: 22,
    frames: 50,
  },
  {
    hitmarks: [32],
    hitlag: [4],
    toNormal: 68,
    toCharged: 69,
    toAbil: 32,
    frames: 69,
  },
]

/**
 * Nightsoul: 45 points, drained 5 a second and spent by dashes (5) and dash-jumps (20).
 * It lasts until its points run out or its 9 s timer ends (C1: x1.45 timer, x0.7 cost).
 */
const nsStartPoints = 45
const nsDrain = 5
const nsMul = (c: number) => (c >= 1 ? 0.7 : 1)
const nsTimer = (c: number) => (c >= 1 ? 783 : 540)

interface Nightsoul {
  /** Points at frame `at` */
  points: number
  at: number
  /** The 9 s (or 13 s) timer's end */
  timerEnd: number
}

interface XilonenState {
  ns?: Nightsoul
  /** Nightsoul's planned end (frame), for the skill's cooldown check */
  planEnd: number
  /** The last Geo Sampler RES-shred application (frame) and the frame its window is on until */
  shredTick: number
  shredCover: number
  /** A4's 14 s ICD ends (frame) */
  a4Until: number
  /** Bumped whenever the plan changes or Nightsoul ends: stale end timers do nothing */
  nsGen: number
  /** Identifies one Nightsoul (its buff pulses stop when it ends) */
  entry: number
  /** C6's pause ICD ends (frame) */
  c6Until: number
  /** C6's 5 s window ends (frame): Nightsoul points are not spent in it */
  c6End: number
  /** C6's +300% DEF window is on (it also ends with Nightsoul); its token */
  c6On: boolean
  c6Token: number
}

/** Points left at frame t (no drain before `at`, which C6 moves later to pause it) */
const pointsAt = (ns: Nightsoul, t: number, mul: number) =>
  Math.max(0, ns.points - (Math.max(0, t - ns.at) / 60) * nsDrain * mul)

/** When Nightsoul ends: the timer, or the points run out */
const nsEndAt = (ns: Nightsoul, mul: number) =>
  Math.min(ns.timerEnd, ns.at + (ns.points / (nsDrain * mul)) * 60)

const nsActive = (s: XilonenState, t: number, c: number) =>
  s.ns !== undefined && t < nsEndAt(s.ns, nsMul(c))

/** Spend points (x the consumption multiplier) at frame t */
function spend(ns: Nightsoul, t: number, amount: number, mul: number) {
  ns.points = Math.max(0, pointsAt(ns, t, mul) - amount * mul)
  ns.at = Math.max(ns.at, t)
}

/**
 * Nightsoul ends (timer, points, recast or swap): gcsim's exitNightsoul starts the skill's 7 s
 * cooldown at that moment. `endedAt` is the frame it really ended, when that was before now.
 */
function exitNightsoul(
  ctx: SimContext,
  s: XilonenState,
  endedAt: number = ctx.now
) {
  if (s.ns === undefined) return
  s.ns = undefined
  s.nsGen++
  // gcsim's exitNightsoul deletes C6's DMG window
  c6Off(ctx, s)
  // the last Sampler RES shred lingers 1 s after its application (gcsim: 60-frame mod)
  const until = s.shredTick + 60
  const from = Math.max(ctx.now, s.shredCover)
  if (until > from) {
    ctx.buff(
      'Xilonen',
      ['Xilonen', 'nsBlessing'],
      'on',
      from - ctx.now,
      until - from
    )
    s.shredCover = until
  }
  ctx.setCooldown('skill', Math.max(0, Math.round(420 - (ctx.now - endedAt))))
}

/** (Re)plans Nightsoul's end after a spend or C6: a timer exits it when the plan holds */
function replan(ctx: SimContext, s: XilonenState, ns: Nightsoul, c: number) {
  const end = nsEndAt(ns, nsMul(c))
  const gen = ++s.nsGen
  s.planEnd = end
  if (end <= ctx.now) {
    exitNightsoul(ctx, s, end)
    return
  }
  ctx.at(Math.ceil(end - ctx.now), (cx) => {
    if (s.nsGen === gen) exitNightsoul(cx, s, end)
  })
}

/**
 * The Geo Sampler's RES shred (the sheet's Nightsoul conditional): gcsim re-applies a 1 s shred
 * every 0.3 s while Nightsoul is up, from the first frame (before Yohual's Scratch lands)
 */
function shredPulse(ctx: SimContext, s: XilonenState, c: number, id: number) {
  if (s.ns === undefined || s.entry !== id) return
  const end = nsEndAt(s.ns, nsMul(c))
  if (ctx.now >= end) return
  const len = ctx.now + 18 >= end ? 60 : 18
  const start = Math.max(ctx.now, s.shredCover)
  const stop = ctx.now + len
  if (stop > start)
    ctx.buff(
      'Xilonen',
      ['Xilonen', 'nsBlessing'],
      'on',
      start - ctx.now,
      stop - start
    )
  s.shredTick = ctx.now
  s.shredCover = Math.max(s.shredCover, stop)
  ctx.at(18, (cx) => shredPulse(cx, s, c, id))
}

/**
 * Her attacks outside Nightsoul: the sheet's Nightsoul condition (A1's +30% Normal and Plunging
 * DMG, which gcsim gives only to Nightsoul-aligned attacks) lingers 1 s after it ends for the
 * Sampler's shred, so these pin it off (the Geo shred does not matter to physical hits)
 */
const notNightsoul = [
  { owner: 'Xilonen' as const, path: ['Xilonen', 'nsBlessing'], value: '' },
]

/** Converted Samplers: the other members of Pyro, Hydro, Cryo or Electro */
const converted = (ctx: SimContext) =>
  (['pyro', 'hydro', 'cryo', 'electro'] as const).reduce(
    (n, e) => n + ctx.partyCount(e),
    0
  )

/**
 * A1 (with two or more converted Samplers): each Blade Roller hit gives 35 Nightsoul points. At
 * the 90-point limit they burst: the points are spent (Nightsoul ends unless C6 holds it), every
 * Sampler's RES shred lasts 15 s, and A4 gives +20% DEF for 15 s (14 s ICD).
 */
function rollerHit(ctx: SimContext, s: XilonenState, c: number) {
  if (s.ns === undefined || !nsActive(s, ctx.now, c) || converted(ctx) < 2)
    return
  const ns = s.ns
  // (no points while they are spent: C6 can hold the blessing at 0, gcsim's a1cb)
  if (pointsAt(ns, ctx.now, nsMul(c)) < 0.001) return
  ns.points = Math.min(90, pointsAt(ns, ctx.now, nsMul(c)) + 35)
  ns.at = Math.max(ns.at, ctx.now)
  if (ns.points >= 90) {
    ctx.consumeNightsoul(90)
    ns.points = 0
    // shred refreshed every 0.3 s for 15 s, each lasting 1 s
    ctx.buff('Xilonen', ['Xilonen', 'sourceActive'], 'on', 0, 15 * 60 + 48)
    // C2: Electro members get their Elemental Burst CD reduced by 6 s (and 25 Energy)
    if (c >= 2)
      for (const m of ctx.members)
        if (getCharEle(m) === 'electro') ctx.reduceCooldown('burst', 360, m)
    if (ctx.now >= s.a4Until) {
      s.a4Until = ctx.now + 14 * 60
      ctx.nightsoulBurst()
    }
  }
  replan(ctx, s, ns, c)
}

/** C6 (Imperishable Night Carnival): attacks, dashes and plunges in Nightsoul pause it 5 s */
function c6(ctx: SimContext, s: XilonenState, c: number) {
  if (
    c < 6 ||
    s.ns === undefined ||
    !nsActive(s, ctx.now, c) ||
    ctx.now < s.c6Until
  )
    return
  s.c6Until = ctx.now + 15 * 60
  s.c6End = ctx.now + 5 * 60
  const ns = s.ns
  ns.points = pointsAt(ns, ctx.now, nsMul(c))
  ns.at = ctx.now + 5 * 60
  ns.timerEnd += 5 * 60
  // +300% DEF as Normal and Plunging DMG for 5 s, cut short when Nightsoul ends
  const token = ++s.c6Token
  if (!s.c6On) {
    s.c6On = true
    ctx.state('Xilonen', ['Xilonen', 'c6Imperishable'], 'on')
  }
  ctx.at(5 * 60, (cx) => {
    if (s.c6Token === token) c6Off(cx, s)
  })
  // and heals the party for 120% DEF every 1.5 s while it lasts
  for (let k = 1; k <= 3; k++)
    ctx.at(90 * k, (cx) => {
      if (s.c6Token !== token || !s.c6On) return
      cx.hit(0, {
        path: ['_heal', 'constellation6', 'heal'],
        tag: 'other',
        element: 'physical',
        healTargets: [...cx.members],
        label: 'Imperishable Night Carnival (Heal)',
      })
    })
  replan(ctx, s, ns, c)
}

function c6Off(ctx: SimContext, s: XilonenState) {
  if (!s.c6On) return
  s.c6On = false
  s.c6Token++
  ctx.state('Xilonen', ['Xilonen', 'c6Imperishable'], '')
}

export const kit: KitModel = {
  characterKey: 'Xilonen',
  element: 'geo',
  source: `${GCSIM}/xilonen`,
  nightsoul(ctx, s: XilonenState) {
    const c = ctx.constellation('Xilonen')
    return {
      active: nsActive(s, ctx.now, c),
      points: s.ns ? pointsAt(s.ns, ctx.now, nsMul(c)) : 0,
    }
  },
  onNightsoulBurst(ctx) {
    ctx.buff('Xilonen', ['Xilonen', 'nsBurst'], 'on', 1, 900, {
      hitlag: 'recipient',
    })
  },
  init: (): XilonenState => ({
    planEnd: 0,
    shredTick: -1e9,
    shredCover: -1,
    a4Until: -1,
    nsGen: 0,
    entry: 0,
    c6Until: -1,
    c6End: -1,
    c6On: false,
    c6Token: 0,
  }),
  act(ctx, s: XilonenState, action, previous) {
    const c = ctx.constellation('Xilonen')
    // Nightsoul ran out (timer or points) before this action: its exit already started the cooldown
    if (s.ns !== undefined && !nsActive(s, ctx.now, c))
      exitNightsoul(ctx, s, nsEndAt(s.ns, nsMul(c)))
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        if (nsActive(s, ctx.now, c)) {
          // each Blade Roller lands only while Nightsoul lasts: A1's 90-point burst ends it
          // (without C6), and gcsim's next attack is then a physical N1 (not modelled: noted)
          const r = normalString(
            rollerNormals,
            count,
            (i, d) =>
              ctx.at(d, (cx) => {
                if (!nsActive(s, cx.now, c)) {
                  cx.note(
                    'Xilonen: Nightsoul ended mid-string (A1 spent its 90 points); the rest of the string is not modelled.'
                  )
                  return
                }
                cx.hit(0, {
                  characterKey: 'Xilonen',
                  path: ['normal', `ns${i}`],
                  tag: 'normal',
                  element: 'geo',
                  applies: true,
                  durability: 25,
                  icd: 'XilonenSkate',
                  nightsoul: true,
                  label: `Blade Roller ${i + 1}`,
                })
                rollerHit(cx, s, c)
              }),
            ctx
          )
          c6(ctx, s, c)
          return r
        }
        return normalString(
          xilonenNormals,
          count,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${xilonenNodes[i][j]}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              durability: 25,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
              states: notNightsoul,
            }),
          ctx
        )
      }
      case 'charged':
        // gcsim: Xilonen cannot Charged Attack in Nightsoul
        if (nsActive(s, ctx.now, c))
          return {
            frames: 0,
            failed: 'Xilonen cannot Charged Attack in Nightsoul',
          }
        ctx.hit(23, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'normal',
          label: 'Charged Attack',
          states: notNightsoul,
        })
        return {
          frames: 42,
          framesInto: { burst: 40, dash: 23, jump: 23, swap: 27 },
        }
      case 'skill': {
        if (nsActive(s, ctx.now, c)) {
          // Nightsoul is up: the skill ends it (1 frame), and the cooldown starts now
          exitNightsoul(ctx, s)
          return { frames: 1 }
        }
        // Yohual's Scratch: enters Nightsoul (its Geo hit at 6 frames)
        ctx.note(
          'Xilonen: A1 and A4 are assumed unlocked; energy (C2 Electro refund) is not modelled.'
        )
        s.ns = {
          points: nsStartPoints,
          at: ctx.now,
          timerEnd: ctx.now + nsTimer(c),
        }
        s.entry++
        s.shredCover = -1
        // the skill cannot be recast for 1 s (gcsim's xilonen-e-recast-cd)
        ctx.setCooldown('skillRecast', 60)
        // the Geo Sampler's shred and A1's Normal Attack DMG (the sheet's Nightsoul conditional)
        shredPulse(ctx, s, c, s.entry)
        replan(ctx, s, s.ns, c)
        ctx.hit(6, {
          path: ['skill', 'rushDmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          durability: 25,
          icd: 'skill',
          nightsoul: true,
          label: "Yohual's Scratch",
          snapshotDelay: 6,
        })
        return {
          frames: 20,
          framesInto: { normal: 19, dash: 15, jump: 15, swap: 19 },
        }
      }
      case 'burst': {
        // Ebullient Rhythm heals when two or more samplers are converted; otherwise the Follow-Up Beats hit
        const samplers = (['pyro', 'hydro', 'cryo', 'electro'] as const).reduce(
          (n, e) => n + ctx.partyCount(e),
          0
        )
        ctx.hit(96, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 25,
          icd: 'burst',
          nightsoul: true,
          label: 'Ocelotlicue Point!',
        })
        if (samplers < 2)
          for (const hitmark of [128, 164])
            ctx.hit(hitmark, {
              path: ['burst', 'beatDmg'],
              tag: 'burst',
              element: 'geo',
              applies: true,
              durability: 25,
              icd: 'burst',
              nightsoul: true,
              label: 'Follow-Up Beat',
            })
        else
          for (const t of [185, 274, 362, 450, 539, 627, 716, 805])
            ctx.hit(t, {
              path: ['_heal', 'burst', 'heal'],
              tag: 'other',
              element: 'physical',
              label: 'Ebullient Rhythm (Heal)',
            })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 101,
          framesInto: { normal: 95, skill: 93, dash: 95, jump: 94, swap: 92 },
        }
      }
      case 'plunge': {
        // In Nightsoul the plunge is the Geo, DEF-based high plunge (gcsim's only Nightsoul plunge)
        if (nsActive(s, ctx.now, c)) {
          ctx.hit(39, {
            path: ['plunging', 'ns_high'],
            tag: 'plunge',
            element: 'geo',
            applies: true,
            durability: 25,
            icd: 'none',
            nightsoul: true,
            label: 'High Plunge (Nightsoul)',
          })
          // A1: the Nightsoul plunge's hit gives points like a Blade Roller (gcsim's a1cb)
          ctx.at(39, (cx) => rollerHit(cx, s, c))
          c6(ctx, s, c)
          return {
            frames: 77,
            framesInto: {
              normal: 55,
              skill: 56,
              burst: 55,
              dash: 39,
              swap: 57,
            },
          }
        }
        // Low Plunge otherwise (P: the rotation does not give the height)
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
          states: notNightsoul,
        })
        return {
          frames: 75,
          framesInto: { normal: 59, skill: 59, burst: 58, dash: 47, swap: 60 },
        }
      }
      case 'dash': {
        // a dash in Nightsoul costs 5 points (none while C6's 5 s window holds the points)
        if (s.ns !== undefined && ctx.now >= s.c6End) {
          spend(s.ns, ctx.now, 5, nsMul(c))
          replan(ctx, s, s.ns, c)
        }
        c6(ctx, s, c)
        return { frames: 22, framesInto: { jump: 3 } }
      }
      case 'jump': {
        // a jump right after a dash costs 20 points in Nightsoul
        const afterDash = previous?.kind === 'dash'
        if (afterDash && s.ns !== undefined && ctx.now >= s.c6End) {
          spend(s.ns, ctx.now, 20, nsMul(c))
          replan(ctx, s, s.ns, c)
        }
        return {
          frames: afterDash ? 37 : 32,
          framesInto: { plunge: 5 },
        }
      }
      default:
        return { frames: 30 }
    }
  },
  countedBuffs(hits, c) {
    // C4 (Blooming): each member's next 6 Normal, Charged or Plunging hits within 15 s of entering
    // Nightsoul (Yohual's Scratch) get the DEF-based DMG bonus
    if (c < 4) return { buffs: [], extraHits: [] }
    const covered = new Set<number>()
    const left = new Map<CharacterKey, number>()
    let until = -1
    hits.forEach((h, i) => {
      if (
        h.characterKey === 'Xilonen' &&
        h.path[0] === 'skill' &&
        h.path[1] === 'rushDmg'
      ) {
        until = h.t + 15 * 60
        left.clear()
        return
      }
      if (h.t >= until || !['normal', 'charged', 'plunge'].includes(h.tag))
        return
      const n = left.get(h.characterKey) ?? 6
      if (n <= 0) return
      left.set(h.characterKey, n - 1)
      covered.add(i)
    })
    return {
      buffs: [
        {
          owner: 'Xilonen',
          path: ['Xilonen', 'c4Blooming'],
          value: 'on',
          hits: covered,
        },
      ],
      extraHits: [],
    }
  },
  cooldownKey: (s: XilonenState, action, now) =>
    action.kind === 'skill'
      ? s.ns !== undefined && now < s.planEnd
        ? 'skillRecast'
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(ctx, s: XilonenState) {
    // Leaving the field ends Nightsoul in gcsim (OnCharacterSwap), which starts the skill's 7 s cooldown
    exitNightsoul(ctx, s)
  },
}
