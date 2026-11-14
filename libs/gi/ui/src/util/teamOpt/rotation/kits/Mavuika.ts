import type { RotationAction } from '../parse'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mavuika, main as of 2026-11-10. */

/** Ring form normal attack string (N1..N4; N2 and N3 have several hits) */
const ringNormals: NormalHit[] = [
  {
    hitmarks: [21],
    hitlag: [9],
    toNormal: 31,
    toCharged: 31,
    toAbil: 21,
    frames: 40,
  },
  {
    hitmarks: [14, 26],
    hitlag: [7, 7],
    worldTimeHits: true,
    toNormal: 42,
    toCharged: 42,
    toAbil: 26,
    frames: 50,
  },
  {
    hitmarks: [28, 33, 39],
    hitlag: [4, 4, 4],
    worldTimeHits: true,
    toNormal: 46,
    toCharged: 47,
    toAbil: 39,
    frames: 59,
  },
  {
    hitmarks: [30],
    hitlag: [10],
    toNormal: 60,
    toCharged: 61,
    toAbil: 30,
    frames: 61,
  },
]

/** Flamestrider (bike form) normal attack string (N1..N5, one hit each) */
const bikeNormals: NormalHit[] = [
  {
    hitmarks: [19],
    hitlag: [6],
    toNormal: 23,
    toCharged: 33,
    toAbil: 19,
    frames: 39,
  },
  {
    hitmarks: [24],
    hitlag: [5],
    toNormal: 32,
    toCharged: 35,
    toAbil: 24,
    frames: 46,
  },
  {
    hitmarks: [31],
    hitlag: [3],
    toNormal: 35,
    toCharged: 40,
    toAbil: 31,
    frames: 50,
  },
  {
    hitmarks: [13],
    hitlag: [2],
    toNormal: 27,
    toCharged: 29,
    toAbil: 13,
    frames: 44,
  },
  { hitmarks: [37], toNormal: 68, toCharged: 64, toAbil: 37, frames: 70 },
]

/** Nightsoul points drain per frame: 0.5 every 6 frames in Ring form, 0.9 in Flamestrider */
const RING_RATE = 0.5 / 6
const BIKE_RATE = 0.9 / 6
/** A Flamestrider charged attack drains 0.2 more per 6 frames (its ~134 frames: a flat amount) */
/** Fighting Spirit: 0 to 200; a burst needs 100 */
const MAX_SPIRIT = 200
const BURST_SPIRIT = 100
/** The burst's buff (no Nightsoul drain, the Spirit it spent as a stat) starts 105 frames in, 7 s long */
const BURST_BUFF_START = 105
const BURST_BUFF = 7 * 60
/** Rings of Searing Radiance: every 2 s in Ring form */
const RADIANCE_INTERVAL = 2 * 60
/** C6: a Flamestrider hit every 3 s in Flamestrider form */
const C6_INTERVAL = 3 * 60

type MavHit = Parameters<SimContext['hit']>[1]

interface MavuikaState {
  /** Nightsoul points, as of `pointsAt` */
  points: number
  pointsAt: number
  /** The Nightsoul Blessing is up (it ends when the points run out) */
  blessing: boolean
  /** Fighting Spirit, 0 to 200 */
  spirit: number
  /** Flamestrider form (otherwise Ring) */
  bike: boolean
  /** The burst's buff is from burstStart to burstEnd (it ends early on a swap) */
  burstStart: number
  burstEnd: number
  /** The Fighting Spirit the burst spent: its buff's state */
  chargeToken: number
  burstStacks: number
  /** The Ring form's radiance chain, and the Flamestrider form's C6 chain (their start frames) */
  ringSrc: number
  bikeSrc: number
  /** A normal attack hit may gain Fighting Spirit from this frame (0.1 s ICD) */
  naIcd: number
  /** The last normal attack string's last hit (0-based), while it is her last action */
  lastNormal?: number
  /** C1: the last frame she gained Fighting Spirit, and whether its ATK buff is on */
  lastGain: number
  c1On: boolean
  /** C2: the Ring's DEF shred is on (Ring form, or either form at C6, in the blessing) */
  c2On: boolean
  /** A4: only the latest burst's 20 s buff */
  a4Token: number
  /** Her last action was a jump (the Flamestrider plunge follows one): for `variant` */
  lastJump: boolean
}

const maxPoints = (c: number) => (c >= 1 ? 120 : 80)
const spiritMul = (c: number) => (c >= 1 ? 1.25 : 1)
const inBurst = (s: MavuikaState, t: number) =>
  t >= s.burstStart && t < s.burstEnd

/**
 * Frames of Nightsoul drain from frame `from`: the points lose their rate per frame while the
 * blessing is up, and become Fighting Spirit (C1: the last frame that happened)
 */
function drain(s: MavuikaState, from: number, frames: number, cons: number) {
  const rate = s.bike ? BIKE_RATE : RING_RATE
  const used = Math.min(s.points, frames * rate)
  s.points -= used
  s.spirit = Math.min(MAX_SPIRIT, s.spirit + used * spiritMul(cons))
  if (used > 0) s.lastGain = Math.max(s.lastGain, from + used / rate)
  if (s.points < 0.001) {
    s.points = 0
    s.blessing = false
  }
}

/** Brings the Nightsoul points (and the Fighting Spirit they become) up to frame `t` */
function settle(s: MavuikaState, t: number, cons: number) {
  let at = s.pointsAt
  while (at < t) {
    const burst = inBurst(s, at)
    // (the burst's buff stops the drain; each piece runs to the next change)
    const end = burst
      ? Math.min(t, s.burstEnd)
      : at < s.burstStart
        ? Math.min(t, s.burstStart)
        : t
    if (!burst && s.blessing) drain(s, at, end - at, cons)
    at = end
  }
  s.pointsAt = t
}

/** A discrete Nightsoul use (a dash, a Flamestrider hit, a radiance tick) */
function consume(c: SimContext, s: MavuikaState, amount: number) {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  if (!s.blessing || inBurst(s, c.now)) return
  const used = Math.min(s.points, amount)
  s.points -= used
  s.spirit = Math.min(MAX_SPIRIT, s.spirit + used * spiritMul(cons))
  if (used > 0) s.lastGain = c.now
  if (s.points < 0.001) {
    s.points = 0
    s.blessing = false
  }
}

/** Nightsoul points generated now: the blessing starts with them, or they are added to it */
function gainPoints(c: SimContext, s: MavuikaState, amount: number) {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  if (!s.blessing) {
    s.blessing = true
    s.points = amount
  } else s.points = Math.min(maxPoints(cons), s.points + amount)
}

/**
 * C6, Flamestrider form: a Scorching Ring of Searing Radiance follows her and deals 500% ATK every
 * 3 s while the form lasts (gcsim's c6RingAtk uses 400%, the game text says 500%)
 */
const c6Tick = (s: MavuikaState, src: number) => (c: SimContext) => {
  settle(s, c.now, c.constellation('Mavuika'))
  if (s.bikeSrc !== src || !s.bike || !s.blessing) return
  hitAt(c, s, 0, {
    characterKey: 'Mavuika',
    path: ['constellation6', 'ringDmg'],
    tag: 'skill',
    element: 'pyro',
    applies: false,
    icd: 'none',
    nightsoul: true,
    label: 'Scorching Ring of Searing Radiance (C6)',
  })
  c.at(C6_INTERVAL, c6Tick(s, src))
}

function enterBike(c: SimContext, s: MavuikaState) {
  s.bike = true
  if (c.constellation('Mavuika') >= 6) {
    s.bikeSrc = c.now
    c.at(C6_INTERVAL, c6Tick(s, c.now))
  }
}

/** Rings of Searing Radiance: a hit and a Nightsoul cost every 2 s, while in Ring form */
const radianceTick = (s: MavuikaState, src: number) => (c: SimContext) => {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  if (s.ringSrc !== src || s.bike || !s.blessing) return
  hitAt(c, s, 0, {
    characterKey: 'Mavuika',
    path: ['skill', 'radianceDmg'],
    tag: 'skill',
    element: 'pyro',
    applies: true,
    icd: 'none',
    nightsoul: true,
    label: 'Rings of Searing Radiance',
  })
  // C6, Ring form: a Flamestrider crashes into the struck opponent for 200% ATK
  if (cons >= 6)
    hitAt(c, s, 3, {
      characterKey: 'Mavuika',
      path: ['constellation6', 'flamestriderDmg'],
      tag: 'skill',
      element: 'pyro',
      applies: false,
      icd: 'none',
      nightsoul: true,
      label: 'Flamestrider (C6)',
    })
  consume(c, s, 3)
  c.at(RADIANCE_INTERVAL, radianceTick(s, src))
}

function enterRing(c: SimContext, s: MavuikaState) {
  s.bike = false
  s.ringSrc = c.now
  c.at(RADIANCE_INTERVAL, radianceTick(s, c.now))
}

/** Her moves on the Flamestrider (in the blessing): the buttons with their own frames there */
const FLAMESTRIDER_MOVES: Partial<Record<RotationAction['kind'], string>> = {
  normal: 'Flamestrider Normal Attack',
  charged: 'Flamestrider Charged Attack',
  skill: 'The Named Moment (Flamestrider)',
  plunge: 'Flamestrider Plunging Attack',
  dash: 'Flamestrider Sprint',
  jump: 'Flamestrider Jump',
}

/** The sheet's burstSpirit state for the Spirit the burst spent (100 to 200, by 10) */
const burstState = (stacks: number) =>
  String(Math.min(200, Math.max(100, Math.floor(stacks / 10) * 10)))

/**
 * A hit of hers. Her conditionals (the burst's buff, C2's form) can end early (a swap) or change
 * with the form, and a window can't be cut once pushed: each is on for the hit's frame only.
 */
function hitAt(ctx: SimContext, s: MavuikaState, delay: number, hit: MavHit) {
  const t = ctx.now + delay
  if (t >= s.burstStart && t < s.burstEnd)
    ctx.buff(
      'Mavuika',
      ['Mavuika', 'burstSpirit'],
      burstState(s.burstStacks),
      delay,
      1
    )
  // C2 in the blessing, Flamestrider form: her own hits deal more (+200 base ATK); in Ring form
  // the base ATK comes with the Ring's shred state (c2Update)
  if (ctx.constellation('Mavuika') >= 2 && s.bike && s.blessing)
    ctx.buff('Mavuika', ['Mavuika', 'c2FlameForm'], 'on', delay, 1)
  ctx.hit(delay, hit)
}

/**
 * C1: +40% ATK for 8 s after gaining Fighting Spirit (gcsim: 10 s; the game text and skillParam
 * say 8 s). C2: while the Ring follows her in the blessing (Ring form; either form at C6), nearby
 * opponents' DEF is decreased by 20% (and she has +200 base ATK). Both are kept as states and
 * brought up to date whenever a hit lands, so every hit sees them as of its frame.
 */
const C1_DURATION = 8 * 60
function consUpdate(ctx: SimContext, s: MavuikaState) {
  const cons = ctx.constellation('Mavuika')
  if (cons >= 1) {
    const on = ctx.now < s.lastGain + C1_DURATION
    if (on !== s.c1On) {
      s.c1On = on
      ctx.state('Mavuika', ['Mavuika', 'c1GainSpirit'], on ? 'on' : '')
    }
  }
  if (cons >= 2) {
    const on = s.blessing && (!s.bike || cons >= 6)
    if (on !== s.c2On) {
      s.c2On = on
      ctx.state('Mavuika', ['Mavuika', 'c2RingForm'], on ? 'on' : '')
    }
  }
}

/** Native single-target bike collision and finisher timing (charge.go). */
export function bikeChargeTiming(
  target: { radius: number; distance: number },
  skip: number
) {
  const { radius: r, distance: d } = target
  if (d + r <= 1 || d - r >= 7) return undefined
  const angleFrame = (degrees: number) => {
    const angle = (degrees + 360) % 360
    const quadrant = Math.floor(angle / 90)
    const spin = 3 - quadrant
    const lengths = [9, 7, 15, 14]
    let accumulated = lengths.slice(0, spin).reduce((a, b) => a + b, 0)
    if (accumulated > 0) accumulated--
    return (
      accumulated +
      Math.round(lengths[spin] - ((angle - quadrant * 90) * lengths[spin]) / 90)
    )
  }
  const theta =
    (Math.acos(
      Math.max(-1, Math.min(1, (16 + d * d - (3 + r) ** 2) / (8 * d)))
    ) *
      180) /
    Math.PI
  const start = angleFrame(90 + theta)
  const end = angleFrame(90 - theta)
  const covers = (frame: number) =>
    r - d > 1 ||
    (start <= end
      ? frame >= start && frame <= end
      : frame >= start || frame <= end)
  let raw = 35
  while (raw < 375 && !covers(raw % 45)) raw++
  const phase = raw % 45
  const delay = phase < 10 ? 10 - phase : phase >= 35 ? 55 - phase : 0
  const hit = raw - skip
  return { hit, final: hit + 1 + delay + 45, normal: hit + delay + 74 + 3 }
}

export const kit: KitModel = {
  characterKey: 'Mavuika',
  element: 'pyro',
  source: `${GCSIM}/mavuika`,
  nightsoul(ctx, state: MavuikaState) {
    const s = { ...state }
    settle(s, ctx.now, ctx.constellation('Mavuika'))
    return { active: s.blessing, points: s.points }
  },
  onNightsoulBurst(ctx) {
    ctx.buff('Mavuika', ['Mavuika', 'a1NsBurst'], 'on', 1, 600, {
      hitlag: 'recipient',
    })
  },
  onNightsoulConsume(ctx, s: MavuikaState, actor, amount) {
    if (actor !== 'Mavuika' && amount > 0) {
      s.spirit = Math.min(
        MAX_SPIRIT,
        s.spirit + amount * spiritMul(ctx.constellation('Mavuika'))
      )
      s.lastGain = ctx.now
    }
  },
  init: (): MavuikaState => ({
    points: 0,
    pointsAt: 0,
    blessing: false,
    spirit: MAX_SPIRIT,
    bike: false,
    burstStart: -1,
    burstEnd: -1,
    burstStacks: 0,
    chargeToken: 0,
    ringSrc: -1,
    bikeSrc: -1,
    naIcd: -1,
    lastGain: Number.NEGATIVE_INFINITY,
    c1On: false,
    c2On: false,
    a4Token: 0,
    lastJump: false,
  }),
  // On the Flamestrider (in the blessing) her normal and charged attacks, E, dash, jump and the
  // plunge after that jump are the Flamestrider's own moves, with their own frames
  variant(ctx, state: MavuikaState, action) {
    const s = { ...state }
    settle(s, ctx.now, ctx.constellation('Mavuika'))
    if (!s.bike || !s.blessing) return undefined
    if (action.kind === 'plunge' && !s.lastJump) return undefined
    const label = FLAMESTRIDER_MOVES[action.kind]
    return label
      ? { key: 'flamestrider', label, mode: 'Flamestrider' }
      : undefined
  },
  act(ctx, s: MavuikaState, action, previous) {
    const cons = ctx.constellation('Mavuika')
    settle(s, ctx.now, cons)
    consUpdate(ctx, s)
    const flame = s.bike && s.blessing
    s.lastJump = action.kind === 'jump'
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        if (flame) {
          s.lastNormal = undefined
          return normalString(
            bikeNormals,
            count,
            (i, d) => {
              hitAt(ctx, s, d, {
                path: ['skill', `normal${i + 1}Dmg`],
                tag: 'normal',
                element: 'pyro',
                applies: true,
                icd: 'MavuikaFlamestrider',
                nightsoul: true,
                label: `Flamestrider N${i + 1}`,
              })
              // (each Flamestrider hit costs 1 Nightsoul point)
              ctx.at(d, (c2) => consume(c2, s, 1))
            },
            ctx
          )
        }
        s.lastNormal = Math.min(count, ringNormals.length) - 1
        return normalString(
          ringNormals,
          count,
          (i, d) =>
            hitAt(ctx, s, d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      }
      case 'charged': {
        s.lastNormal = undefined
        if (flame) {
          const skipped = ['normal', 'charged', 'dash', 'burst'].includes(
            previous?.kind ?? ''
          )
            ? 15
            : previous?.kind === 'plunge'
              ? 13
              : 0
          const timing = bikeChargeTiming(ctx.target, skipped)
          if (!timing)
            return {
              frames: 0,
              failed:
                'Mavuika: the target is outside the Flamestrider spin hitbox.',
            }
          const token = ++s.chargeToken
          consume(ctx, s, (0.2 / 6) * Math.max(0, timing.final - 45))
          hitAt(ctx, s, timing.hit, {
            path: ['skill', 'chargedCyclicDmg'],
            tag: 'charged',
            element: 'pyro',
            nightsoul: true,
            applies: true,
            icd: 'MavuikaFlamestrider',
            label: 'Flamestrider Charged Attack (Cyclic)',
          })
          ctx.at(timing.final, (c) => {
            if (token !== s.chargeToken || c.onField !== 'Mavuika' || !s.bike)
              return
            hitAt(c, s, 0, {
              path: ['skill', 'chargedFinalDmg'],
              tag: 'charged',
              element: 'pyro',
              nightsoul: true,
              applies: true,
              icd: 'MavuikaFlamestrider',
              blunt: true,
              poiseDamage: 120,
              label: 'Flamestrider Charged Attack (Final)',
            })
            c.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 3,
              label: 'Flamestrider finisher hitlag',
            })
          })
          return {
            frames: timing.normal,
            framesInto: {
              normal: timing.normal,
              charged: timing.hit,
              skill: timing.hit,
              burst: timing.hit,
              dash: timing.hit,
              jump: timing.hit,
              swap: timing.hit,
              wait: timing.hit,
            },
          }
        }
        hitAt(ctx, s, 79, {
          path: ['charged', 'finalDmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        // the hit pauses her 13 frames (0.15 s halt + the 3.6-frame defense halt); a following
        // wait starts at the hit (gcsim's CanQueueAfter)
        return withHitlag(
          {
            frames: 99,
            framesInto: {
              normal: 98,
              charged: 98,
              skill: 98,
              dash: 79,
              jump: 79,
              wait: 79,
            },
          },
          { hitmarks: [79], hitlag: [13] }
        )
      }
      case 'skill': {
        s.lastNormal = undefined
        const cooldown = { key: 'skill', frames: 15 * 60, delay: 18 }
        const skillHit: MavHit = {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: flame ? 'The Named Moment (Flamestrider)' : 'The Named Moment',
        }
        if (flame) {
          // in Flamestrider form, E refreshes the form (press or hold)
          hitAt(ctx, s, 16, skillHit)
          gainPoints(ctx, s, maxPoints(cons))
          return {
            cooldown,
            frames: 39,
            framesInto: {
              normal: 27,
              charged: 27,
              burst: 27,
              dash: 25,
              jump: 27,
              swap: 24,
            },
          }
        }
        if (action.hold) {
          enterBike(ctx, s)
          hitAt(ctx, s, 16, skillHit)
          gainPoints(ctx, s, maxPoints(cons))
          return {
            cooldown,
            frames: 43,
            framesInto: { dash: 42, jump: 42, swap: 34 },
          }
        }
        enterRing(ctx, s)
        hitAt(ctx, s, 16, skillHit)
        gainPoints(ctx, s, maxPoints(cons))
        return {
          cooldown,
          frames: 28,
          framesInto: {
            normal: 18,
            charged: 19,
            skill: 19,
            burst: 18,
            swap: 24,
          },
        }
      }
      case 'burst': {
        s.lastNormal = undefined
        if (s.spirit < BURST_SPIRIT)
          return {
            frames: 0,
            failed: `Mavuika: not enough Fighting Spirit (${Math.floor(s.spirit)}/${BURST_SPIRIT})`,
          }
        s.burstStacks = s.spirit
        s.spirit = 0
        s.burstStart = ctx.now + BURST_BUFF_START
        s.burstEnd = s.burstStart + BURST_BUFF
        // A4 buffs the active party member for 20 seconds, independently of the
        // seven-second Crucible window that adds flat damage to Mavuika's attacks.
        // (states, so a burst within 20 s of the last one replaces its buff instead of overlapping)
        const a4 = ++s.a4Token
        const spirit = burstState(s.burstStacks)
        for (let second = 0; second <= 20; second++)
          ctx.at(BURST_BUFF_START + second * 60, (c2) => {
            if (s.a4Token !== a4) return
            const on = second < 20
            c2.state('Mavuika', ['Mavuika', 'a4Spirit'], on ? spirit : '')
            c2.state(
              'Mavuika',
              ['Mavuika', 'a4TimeSinceBurst'],
              on ? String(second) : ''
            )
          })
        enterBike(ctx, s)
        ctx.at(87, (c2) => gainPoints(c2, s, 10))
        hitAt(ctx, s, 106, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 25,
          icd: 'none',
          nightsoul: true,
          label: 'Sunfell Slice',
        })
        return {
          cooldown: { key: 'burst', frames: 18 * 60 },
          frames: 141,
          framesInto: {
            normal: 116,
            charged: 116,
            skill: 116,
            dash: 116,
            jump: 116,
            swap: 116,
          },
        }
      }
      case 'plunge': {
        s.lastNormal = undefined
        if (flame && previous?.kind === 'jump') {
          // Flamestrider plunge (after its jump): the impact
          hitAt(ctx, s, 41, {
            path: ['skill', 'plungeDmg'],
            tag: 'plunge',
            element: 'pyro',
            applies: true,
            icd: 'MavuikaFlamestrider',
            nightsoul: true,
            label: 'Flamestrider Plunge (impact)',
          })
          return {
            frames: 77,
            framesInto: {
              normal: 60,
              charged: 60,
              skill: 41,
              burst: 61,
              dash: 41,
              jump: 76,
              swap: 75,
            },
          }
        }
        hitAt(ctx, s, 37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 80,
          framesInto: {
            normal: 51,
            charged: 52,
            skill: 37,
            burst: 51,
            dash: 37,
            swap: 62,
          },
        }
      }
      case 'dash': {
        s.lastNormal = undefined
        if (flame) {
          // Flamestrider Sprint: a hit 6 frames in, and 10 Nightsoul points
          hitAt(ctx, s, 6, {
            path: ['skill', 'sprintDmg'],
            tag: 'other',
            element: 'pyro',
            applies: true,
            icd: 'MavuikaFlamestrider',
            nightsoul: true,
            label: 'Flamestrider Sprint',
          })
          consume(ctx, s, 10)
          return {
            frames: 24,
            framesInto: {
              charged: 20,
              normal: 18,
              skill: 20,
              burst: 20,
              jump: 6,
              swap: 6,
            },
          }
        }
        // (Ring form: the Lady dash)
        return { frames: 22, framesInto: { jump: 3 } }
      }
      case 'jump':
        s.lastNormal = undefined
        // Flamestrider jump (its plunge is available after it); Ring form: the Lady jump
        // (gcsim's bikeJumpFrames: 42, its low plunge at 16)
        if (flame) return { frames: 42, framesInto: { plunge: 16 } }
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: MavuikaState, hit) {
    const cons = ctx.constellation('Mavuika')
    settle(s, hit.t, cons)
    // Fighting Spirit: any member's normal attack hit gives 1.5 (0.1 s ICD)
    if (hit.tag === 'normal' && hit.t >= s.naIcd) {
      s.naIcd = hit.t + 6
      s.spirit = Math.min(MAX_SPIRIT, s.spirit + 1.5 * spiritMul(cons))
      s.lastGain = hit.t
    }
    consUpdate(ctx, s)
  },
  onSwapOut(ctx, s: MavuikaState) {
    // a swap ends the burst's buff, and her last normal no longer counts
    settle(s, ctx.now, ctx.constellation('Mavuika'))
    s.lastNormal = undefined
    s.burstEnd = Math.min(s.burstEnd, ctx.now)
    s.burstStart = Math.min(s.burstStart, s.burstEnd)
    // leaving the field on the Flamestrider turns it back into the Ring (gcsim's onExitField:
    // exitBike), which then follows the active member
    if (s.bike && s.blessing) enterRing(ctx, s)
    consUpdate(ctx, s)
  },
}
