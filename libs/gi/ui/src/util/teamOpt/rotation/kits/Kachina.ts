import type { KitModel, SimContext } from '../types'
import { type NormalHit, normalString, templateJump } from './common'

/*
 * Kachina. Neither gcsim nor the pinned kqmsim has her, so this kit follows the in-game text and
 * the game's own ability configs (BinOutput ConfigAbility_Avatar_Kachina, datamined):
 *   - the skill grants 60 Nightsoul points; in the Nightsoul's Blessing they drain 2.5 per second
 *     (0.5 per 0.2 s tick), and the Blessing (and Turbo Twirly) end when they run out
 *   - the independent Turbo Twirly attacks every 2 s, its hit 0.2 s after the trigger
 *   - a mounted slam costs 10 Nightsoul points; dismounting costs 2
 * Action frames are ESTIMATES: no frame data is published. Her normal/charged attacks use the
 * Loli polearm rig her charged attack shares with Yaoyao (gcsim's Yaoyao frames), and the skill and
 * burst animation lengths are estimated. Defense halt (+3.6 frames, gcsim's default) is applied to
 * her melee normal hits.
 */

const kachinaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [4],
    toNormal: 22,
    toCharged: 22,
    toAbil: 13,
    frames: 28,
  },
  // N2: two strikes (the sheet's nodes 1 and 2)
  {
    hitmarks: [11, 22],
    hitlag: [4, 4],
    toNormal: 31,
    toCharged: 34,
    toAbil: 22,
    frames: 40,
  },
  {
    hitmarks: [18],
    hitlag: [4],
    toNormal: 33,
    toCharged: 33,
    toAbil: 18,
    frames: 42,
  },
  {
    hitmarks: [21],
    hitlag: [4],
    toNormal: 59,
    toCharged: 59,
    toAbil: 21,
    frames: 59,
  },
]
/** The sheet's normal node for string step i, hit j (N2's two hits: 1 and 2) */
const normalNode = (i: number, j: number) =>
  i === 0 ? 0 : i === 1 ? 1 + j : i + 1

/** Nightsoul: the skill's points, the drain per frame (2.5 / s), a slam's and a dismount's cost */
const NS_GAIN = 60
const NS_DRAIN = 2.5 / 60
const SLAM_COST = 10
const DISMOUNT_COST = 2
/** The independent Twirly: a slam every 120 frames, its hit 12 frames after the trigger */
const TWIRLY_INTERVAL = 120
const TWIRLY_HIT = 12
/** The burst's Turbo Drill Field lasts 12 s */
const FIELD = 720

interface KachinaState {
  /** Nightsoul points at `at` (they drain while the Blessing is on) */
  points: number
  at: number
  blessing: boolean
  /** Turbo Twirly is out: ridden or independent */
  twirly: boolean
  riding: boolean
  /** The current Twirly's summon (its slams stop when another one replaces it) */
  version: number
  fieldEnd: number
}

/** Points now, after the drain since the last settle; ends the Blessing at 0 */
function settle(c: SimContext, s: KachinaState) {
  if (s.blessing) {
    s.points = Math.max(0, s.points - (c.now - s.at) * NS_DRAIN)
    if (s.points <= 0) end(c, s)
  }
  s.at = c.now
}

function end(_c: SimContext, s: KachinaState) {
  s.blessing = false
  s.twirly = false
  s.riding = false
  s.version++
}

/** When the points (at the current drain) run out, from now */
const remaining = (s: KachinaState) => Math.ceil(s.points / NS_DRAIN)

/** The Blessing's end, rescheduled after every change of points */
function scheduleEnd(c: SimContext, s: KachinaState) {
  const v = s.version
  const at = remaining(s)
  c.at(at, (c2) => {
    if (s.version !== v || !s.blessing) return
    settle(c2, s)
    if (s.blessing && s.points <= 0.001) end(c2, s)
  })
}

function gain(c: SimContext, s: KachinaState, points: number) {
  settle(c, s)
  s.points = Math.min(NS_GAIN, s.points + points)
  s.blessing = true
  scheduleEnd(c, s)
}

function spend(c: SimContext, s: KachinaState, points: number) {
  settle(c, s)
  s.points = Math.max(0, s.points - points)
  if (s.points <= 0) end(c, s)
  else scheduleEnd(c, s)
}

/** Turbo Twirly's Nightsoul-aligned Geo hit (independent or mounted) */
function twirlyHit(c: SimContext, delay: number, mounted: boolean) {
  c.hit(delay, {
    path: ['skill', mounted ? 'rideDmg' : 'independentDmg'],
    tag: 'skill',
    nightsoul: true,
    element: 'geo',
    applies: true,
    icd: 'skill',
    label: mounted ? 'Turbo Twirly (mounted)' : 'Turbo Twirly',
  })
}

/** The independent Twirly's slams: every 120 frames while it is out and not ridden */
function slams(c: SimContext, s: KachinaState, v: number) {
  c.at(TWIRLY_INTERVAL, (c2) => {
    if (s.version !== v || !s.twirly) return
    settle(c2, s)
    if (!s.twirly) return
    if (!s.riding) twirlyHit(c2, TWIRLY_HIT, false)
    slams(c2, s, v)
  })
}

/** Summons Turbo Twirly (`delay` frames from now), independent or ridden */
function summon(c: SimContext, s: KachinaState, delay: number, ride: boolean) {
  c.at(delay, (c2) => {
    s.version++
    const v = s.version
    s.twirly = true
    s.riding = ride
    // a Geo Construct while it exists (an estimate of its life: the Blessing's points)
    c2.construct(remaining(s))
    slams(c2, s, v)
  })
}

export const kit: KitModel = {
  characterKey: 'Kachina',
  element: 'geo',
  source:
    'in-game text and ability configs (no gcsim kit); frames estimated from Yaoyao',
  init: (): KachinaState => ({
    points: 0,
    at: 0,
    blessing: false,
    twirly: false,
    riding: false,
    version: 0,
    fieldEnd: -1,
  }),
  onStart(c) {
    c.note(
      'Kachina: action frames are estimates (no published frame data); Nightsoul drain, Twirly intervals and costs follow the game ability configs. C1 energy and C6 (shield replaced) are not modelled.'
    )
  },
  nightsoul(c, state: KachinaState) {
    const s = { ...state }
    if (s.blessing) s.points = Math.max(0, s.points - (c.now - s.at) * NS_DRAIN)
    return { active: s.blessing && s.points > 0, points: s.points }
  },
  onNightsoulBurst(c) {
    // A1: Geo DMG +20% for 12 s after a party member's Nightsoul Burst
    c.buff('Kachina', ['Kachina', 'a1NightsoulBurst'], 'on', 0, 720)
  },
  // With Turbo Twirly out, the skill becomes Mount / Dismount (no cooldown)
  cooldownKey: (s: KachinaState, action) =>
    action.kind === 'skill' && s.twirly
      ? undefined
      : action.kind === 'skill' || action.kind === 'burst'
        ? action.kind
        : undefined,
  // With Turbo Twirly out her E mounts or dismounts it, and riding it her normal attacks are its
  // slams: each with its own frames
  variant(ctx, state: KachinaState, action) {
    const s = { ...state }
    settle(ctx, s)
    const mode = "Nightsoul's Blessing"
    if (action.kind === 'skill' && s.twirly)
      return s.riding
        ? { key: 'dismount', label: 'Dismount Turbo Twirly', mode }
        : { key: 'mount', label: 'Mount Turbo Twirly', mode }
    if (action.kind === 'normal' && s.riding)
      return { key: 'riding', label: 'Turbo Twirly Slam', mode }
    return undefined
  },
  act(ctx, s: KachinaState, action, previous) {
    settle(ctx, s)
    switch (action.kind) {
      case 'skill': {
        if (s.twirly) {
          // Mount / Dismount (dismounting costs 2 points)
          if (s.riding) {
            spend(ctx, s, DISMOUNT_COST)
            s.riding = false
            return { frames: 20, framesInto: { normal: 18, swap: 18 } }
          }
          s.riding = true
          return { frames: 25, framesInto: { normal: 22, swap: 22 } }
        }
        // Tap: throws Turbo Twirly (independent); hold: summons and rides it
        const hold = !!action.hold
        gain(ctx, s, NS_GAIN)
        summon(ctx, s, hold ? 30 : 20, hold)
        return hold
          ? {
              frames: 45,
              framesInto: { normal: 40, burst: 40, swap: 40 },
              cooldown: { key: 'skill', frames: 1200, delay: 30 },
            }
          : {
              frames: 32,
              framesInto: { normal: 28, burst: 28, dash: 24, swap: 26 },
              cooldown: { key: 'skill', frames: 1200, delay: 20 },
            }
      }
      case 'normal':
        if (s.riding) {
          // Mounted: each normal attack is a Twirly slam (10 points); 50 frames apart (estimate)
          const n = action.count ?? 1
          let t = 0
          for (let i = 0; i < n; i++) {
            if (!s.twirly) break
            twirlyHit(ctx, t + 26, true)
            ctx.at(t, (c2) => spend(c2, s, SLAM_COST))
            t += 50
          }
          return { frames: t, framesInto: { skill: t - 10, swap: t - 10 } }
        }
        return normalString(
          kachinaNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${normalNode(i, j)}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${i === 1 ? ` (${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        // (Yaoyao's charged attack animation)
        ctx.hit(24, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'extraAttack',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 55,
          framesInto: {
            normal: 49,
            skill: 49,
            burst: 50,
            dash: 24,
            jump: 24,
            swap: 49,
          },
        }
      case 'burst': {
        const c = ctx.constellation('Kachina')
        ctx.hit(55, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Time to Get Serious!',
        })
        s.fieldEnd = ctx.now + 55 + FIELD
        // C4: the active character in the field gains DEF (one opponent: 8%)
        if (c >= 4)
          ctx.buff('Kachina', ['Kachina', 'c4Opponents'], '1', 55, FIELD)
        // C2: 20 points; without a Twirly, the Blessing and an independent one
        if (c >= 2)
          ctx.at(55, (c2) => {
            const had = s.twirly
            gain(c2, s, 20)
            if (!had) summon(c2, s, 0, false)
          })
        return {
          frames: 95,
          framesInto: { normal: 92, skill: 92, swap: 90 },
          cooldown: { key: 'burst', frames: 1080 },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('loli', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
