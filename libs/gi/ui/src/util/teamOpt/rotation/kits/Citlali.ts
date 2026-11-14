import type { HitTag, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/citlali, main as of 2026-11-10. */

/** Normal attack and charged attack projectiles: gcsim's default travel time (frames) */
const TRAVEL = 10

const citlaliNormals: NormalHit[] = [
  {
    hitmarks: [16 + TRAVEL],
    toNormal: 34,
    toCharged: 33,
    toAbil: 16,
    frames: 38,
  },
  {
    hitmarks: [16 + TRAVEL],
    toNormal: 37,
    toCharged: 37,
    toAbil: 16,
    frames: 39,
  },
  {
    hitmarks: [36 + TRAVEL],
    toNormal: 49,
    toCharged: 50,
    toAbil: 36,
    frames: 52,
  },
]

/** Nightsoul points: Opal Fire consumes 0.8 every 6 frames (8 per second) */
const POINTS_PER_FRAME = 0.8 / 6
/** Points needed to start Opal Fire (C6: any points, during the blessing) */
const OPAL_FIRE_POINTS = 50
/** Maximum Nightsoul points */
const MAX_POINTS = 100
/** C6: at most 40 Cifra points */
const CIFRA_MAX = 40

/**
 * C6 Cifra of the Secret Law: +1.5% Pyro/Hydro DMG for the party and +2.5% DMG for Citlali per
 * point, published as the sheet's state (its steps of 2) whenever a hit lands
 */
function cifraUpdate(ctx: SimContext, s: CitlaliState) {
  const v = Math.floor(s.cifra / 2) * 2
  const value = v >= 2 ? String(v) : ''
  if (value === s.cifraState) return
  s.cifraState = value
  ctx.state('Citlali', ['Citlali', 'c6NsConsumed'], value)
}

/** Tags that consume a Stellar Blade (C1) when the active member lands them */
const c1Tags: HitTag[] = ['normal', 'charged', 'plunge', 'skill', 'burst']

interface CitlaliState {
  /** Nightsoul points, as of `pointsAt` */
  points: number
  pointsAt: number
  /** The Nightsoul Blessing (20 s, from Itzpapa's summon) ends at this frame (undefined: none) */
  blessingEnd?: number
  /** Opal Fire is on: Itzpapa's Frostfall Storm every 59 frames */
  fire: boolean
  /** The frame the current Opal Fire started (its tick chain's id) */
  fireSrc: number
  /** C4: a Frostfall Storm hit may restore points and summon a Skull from this frame */
  c4Ready: number
  a1Ready: number
  /** C6: Cifra of the Secret Law points (0-40), and the sheet state last published */
  cifra: number
  cifraState: string
}

/** Brings the points and the blessing up to frame `t` */
function settle(s: CitlaliState, t: number, c6: boolean) {
  if (s.blessingEnd !== undefined && t >= s.blessingEnd) {
    // the blessing ends with its Opal Fire (the points stay)
    advance(s, s.blessingEnd, c6)
    s.blessingEnd = undefined
    s.fire = false
    // C6: Itzpapa leaving the field removes the Cifra points
    s.cifra = 0
  }
  advance(s, t, c6)
}

/** Opal Fire drains the points; without C6 it ends when they run out */
function advance(s: CitlaliState, t: number, c6: boolean) {
  if (t <= s.pointsAt) return
  if (s.fire) {
    const runsOut = s.pointsAt + s.points / POINTS_PER_FRAME
    if (!c6 && t >= runsOut) {
      s.points = 0
      s.fire = false
    } else {
      const left = Math.max(0, s.points - (t - s.pointsAt) * POINTS_PER_FRAME)
      // C6: each point Itzpapa consumes is a Cifra point (at most 40)
      if (c6) s.cifra = Math.min(CIFRA_MAX, s.cifra + s.points - left)
      s.points = left
    }
  }
  s.pointsAt = t
}

/** Opal Fire starts during the blessing once the points reach 50 (C6: with any points) */
function tryFire(c: SimContext, s: CitlaliState) {
  if (s.blessingEnd === undefined || s.fire) return
  if (s.points < OPAL_FIRE_POINTS && c.constellation('Citlali') < 6) return
  s.fire = true
  const src = c.now
  s.fireSrc = src
  // Itzpapa's Frostfall Storm: 59 frames after Opal Fire starts, then every 59 frames while it is on
  const tick = (c2: SimContext) => {
    const cons = c2.constellation('Citlali')
    settle(s, c2.now, cons >= 6)
    if (!s.fire || s.fireSrc !== src) return
    c2.hit(0, {
      characterKey: 'Citlali',
      path: ['skill', 'frostfallStormDmg'],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      icd: 'CitlaliFrostfallStorm',
      nightsoul: true,
      label: 'Frostfall Storm',
    })
    // C4: a Frostfall Storm hit (8 s cooldown) restores 16 points and summons a Skull 57 frames later
    if (cons >= 4 && c2.now >= s.c4Ready) {
      s.c4Ready = c2.now + 8 * 60
      gain(c2, s, 16)
      c2.hit(57, {
        characterKey: 'Citlali',
        path: ['constellation4', 'dmg'],
        tag: 'other',
        element: 'cryo',
        applies: true,
        icd: 'none',
        nightsoul: true,
        label: 'Spiritvessel Skull (C4)',
      })
    }
    c2.at(59, tick)
  }
  c.at(59, tick)
}

/** Nightsoul points generated now (capped at 100); Opal Fire may start */
function gain(c: SimContext, s: CitlaliState, amount: number) {
  settle(s, c.now, c.constellation('Citlali') >= 6)
  s.points = Math.min(MAX_POINTS, s.points + amount)
  tryFire(c, s)
}

export const kit: KitModel = {
  sampled: true,
  characterKey: 'Citlali',
  element: 'cryo',
  source: `${GCSIM}/citlali`,
  nightsoul(ctx, state: CitlaliState) {
    const s = { ...state }
    settle(s, ctx.now, ctx.constellation('Citlali') >= 6)
    return {
      active: s.blessingEnd !== undefined && ctx.now < s.blessingEnd,
      points: s.points,
    }
  },
  init: (): CitlaliState => ({
    points: 0,
    pointsAt: 0,
    fire: false,
    fireSrc: -1,
    c4Ready: -1,
    a1Ready: -1,
    cifra: 0,
    cifraState: '',
  }),
  act(ctx, s: CitlaliState, action, previous) {
    const cons = ctx.constellation('Citlali')
    switch (action.kind) {
      case 'normal':
        return normalString(
          citlaliNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'cryo',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(50 + TRAVEL, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return {
          frames: 56,
          framesInto: {
            normal: 49,
            charged: 52,
            skill: 52,
            burst: 51,
            dash: 45,
            jump: 46,
            swap: 50,
          },
        }
      case 'skill': {
        // C6: the points this cast finds are consumed into Cifra stacks (up to 40)
        settle(s, ctx.now, cons >= 6)
        const found = s.points
        if (cons >= 6) s.points = 0
        ctx.hit(20, {
          path: ['skill', 'obsidianDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: 'Obsidian Tzitzimitl',
        })
        // 18 frames: Itzpapa's Nightsoul Blessing (20 s), +24 points; Opal Fire may start
        ctx.at(18, (c2) => {
          settle(s, c2.now, c2.constellation('Citlali') >= 6)
          s.points += 24
          s.blessingEnd = c2.now + 20 * 60
          tryFire(c2, s)
        })
        // C2: Itzpapa's shield (from 37 frames) or the blessing gives the active member +250 EM
        if (cons >= 2)
          ctx.buff(
            'Citlali',
            ['Citlali', 'c2ShieldEleMas'],
            'on',
            18,
            20 * 60 + 19
          )
        // C6: the points this cast consumes are the new Cifra points (the old ones are removed);
        // Itzpapa's drain adds the rest (advance)
        if (cons >= 6) {
          s.cifra = Math.min(CIFRA_MAX, found)
          cifraUpdate(ctx, s)
        }
        return {
          cooldown: { key: 'skill', frames: 16 * 60, delay: 18 },
          frames: 50,
          framesInto: {
            normal: 42,
            charged: 42,
            burst: 41,
            dash: 49,
            jump: 49,
            swap: 41,
          },
        }
      }
      case 'burst': {
        ctx.hit(118, {
          path: ['burst', 'iceStormDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'none',
          nightsoul: true,
          label: 'Ice Storm',
        })
        // +24 points, 115 frames in
        ctx.at(115, (c2) => gain(c2, s, 24))
        // One Spiritvessel Skull (one target assumed; gcsim makes up to 3 for 3 enemies in range).
        // Its delay is random: 87 to 117 frames after the Ice Storm (sampled rotations)
        const skullAt = 118 + 87 + Math.floor(ctx.random() * 31)
        ctx.at(skullAt, (c2) => gain(c2, s, 3))
        ctx.hit(skullAt, {
          path: ['burst', 'skullDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          icd: 'CitlaliSpiritVessel',
          nightsoul: true,
          label: 'Spiritvessel Skull',
        })
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 113,
          framesInto: {
            normal: 112,
            charged: 112,
            skill: 111,
            dash: 112,
            swap: 110,
          },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // (her body's jump: 31 frames, 34 after a dash)
        return templateJump('girl', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onNightsoulBurst(ctx, s: CitlaliState) {
    gain(ctx, s, 4)
  },
  onHit(ctx, s: CitlaliState, hit) {
    const cons = ctx.constellation('Citlali')
    if (cons >= 6) {
      settle(s, ctx.now, true)
      cifraUpdate(ctx, s)
    }
    if (
      hit.path[0] !== '_reaction' ||
      !['melt', 'frozen'].includes(hit.path[1])
    )
      return
    settle(s, ctx.now, cons >= 6)
    if (s.blessingEnd === undefined || ctx.now >= s.blessingEnd) return
    // A1: the opponent's Pyro and Hydro RES shred (a debuff on the enemy, paused by its hitlag)
    ctx.buff('Citlali', ['Citlali', 'a1NsFreezeMelt'], 'on', 1, 720, {
      hitlag: 'enemy',
    })
    if (ctx.now >= s.a1Ready) {
      s.a1Ready = ctx.now + 480
      gain(ctx, s, 16)
      // C1: the same trigger (and 8 s cooldown) gives 3 more Stellar Blades (countedBuffs)
      if (cons >= 1)
        ctx.hit(0, {
          path: ['_marker', 'citlaliBlades'],
          tag: 'other',
          element: 'physical',
          label: 'Citlali C1: +3 Stellar Blades',
        })
    }
  },
  countedBuffs(hits, c) {
    // C1: 10 Stellar Blades per skill, each consumed by a hit of the active member (the sheet's
    // dmg% stand-in for the flat EM×2); the blades go at the blessing's end
    if (c < 1) return { buffs: [], extraHits: [] }
    const covered = new Set<number>()
    let blades = 0
    let blessingEnd = -1
    hits.forEach((h, i) => {
      if (h.t >= blessingEnd) blades = 0
      if (
        h.characterKey === 'Citlali' &&
        h.path[0] === '_marker' &&
        h.path[1] === 'citlaliBlades'
      ) {
        if (h.t < blessingEnd) blades += 3
        return
      }
      if (
        h.characterKey === 'Citlali' &&
        h.path[0] === 'skill' &&
        h.path[1] === 'obsidianDmg'
      ) {
        // (the blessing started 18 frames before this hit, and lasts 20 s)
        blades = 10
        blessingEnd = h.t + 20 * 60 - 2
        return
      }
      if (
        blades > 0 &&
        h.characterKey !== 'Citlali' &&
        h.onField === h.characterKey &&
        c1Tags.includes(h.tag)
      ) {
        covered.add(i)
        blades--
      }
    })
    return {
      buffs: [
        {
          owner: 'Citlali',
          path: ['Citlali', 'c1BladeConsume'],
          value: 'on',
          hits: covered,
        },
      ],
      extraHits: [],
    }
  },
}
