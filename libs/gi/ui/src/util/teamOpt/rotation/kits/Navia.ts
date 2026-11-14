import { REACTION_MARK } from '../lunarCrystallize'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/navia, main as of 2026-11-10. */

// Hitmarks are the damage frames (gcsim's shots land with no travel); the cancels are gcsim's
const naviaNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [8],
    toNormal: 28,
    toCharged: 28,
    toAbil: 23,
    frames: 28,
  },
  {
    hitmarks: [22],
    hitlag: [8],
    toNormal: 42,
    toCharged: 42,
    toAbil: 22,
    frames: 42,
  },
  {
    hitmarks: [31, 39, 48],
    toNormal: 48,
    toCharged: 48,
    toAbil: 29,
    frames: 48,
  },
  {
    hitmarks: [41],
    hitlag: [8],
    toNormal: 93,
    toCharged: 93,
    toAbil: 41,
    frames: 93,
  },
]

interface NaviaState {
  /** Crystal Shrapnel (up to 6), and its last gain (they last 300 s from it) */
  shrapnel: number
  lastGain: number
  /** Her burst hits give Shrapnel once per 2.4 s (Navia's clock); a Lunar-Crystallize once per 1 s */
  burstIcdEnd: number
  lcrIcdEnd: number
  /** Surging Blade's ICD: from 28 frames after a Crystalshot for 7 s (Navia's clock, inclusive) */
  arkheFrom: number
  arkheUntil: number
  /** A1: Geo infusion and +40% NA/CA/plunge DMG until this frame (Navia's clock, inclusive) */
  a1Until: number
  /** Crystallize shards on the field (any member's Crystallize): spawn frame and expiry */
  shards: { t: number; end: number }[]
}

/** Shrapnel lasts 300 s from its last gain */
const SHRAPNEL_DURATION = 300 * 60

function gainShrapnel(s: NaviaState, t: number) {
  if (t - s.lastGain > SHRAPNEL_DURATION) s.shrapnel = 0
  s.shrapnel = Math.min(6, s.shrapnel + 1)
  s.lastGain = t
}

/**
 * Crystalshot fires (gcsim's QueueCharTask at the firing frame): the shots are the Shrapnel's
 * (5 + 2 per stack up to 3), all of them hit here; the Shrapnel consumed is fixed on its hits
 */
function naviaFire(c: SimContext, s: NaviaState) {
  if (c.now - s.lastGain > SHRAPNEL_DURATION) s.shrapnel = 0
  const n = s.shrapnel
  const shots = 5 + Math.min(n, 3) * 2
  const states = [
    {
      owner: 'Navia' as const,
      path: ['Navia', 'skillCharges'],
      value: n > 0 ? `${n}` : '',
    },
    { owner: 'Navia' as const, path: ['Navia', 'shotsHit'], value: `${shots}` },
  ]
  c.hit(9, {
    path: ['skill', 'totalShardDmg'],
    tag: 'skill',
    element: 'geo',
    applies: true,
    icd: 'none',
    blunt: true,
    poiseDamage: 150,
    label: `Rosula Shardshot (${shots} shots)`,
    states,
  })
  // Surging Blade (its ICD is checked at firing, as gcsim does; it starts 28 frames later)
  const now = c.characterFrame('Navia')
  if (now < s.arkheFrom || now > s.arkheUntil) {
    s.arkheFrom = now + 28
    s.arkheUntil = now + 28 + 420
    c.atCharacter('Navia', 64, (c2) =>
      c2.hit(0, {
        path: ['skill', 'bladeDmg'],
        tag: 'skill',
        element: 'geo',
        applies: false,
        durability: 0,
        icd: 'none',
        label: 'Surging Blade',
        // (the firing's Shrapnel bonuses, as gcsim snapshots them)
        states,
      })
    )
  }
  // C1: each stack consumed (3 at most) cuts the burst cooldown by 1 s (and restores 3 Energy)
  if (c.constellation('Navia') >= 1 && n > 0)
    c.reduceCooldown('burst', 60 * Math.min(n, 3))
  // C2: one Cannon Fire Support shot 30 frames after the first shard hit
  if (c.constellation('Navia') >= 2) {
    c.hit(39, {
      path: ['burst', 'supportDmg'],
      tag: 'burst',
      element: 'geo',
      applies: true,
      durability: 25,
      icd: 'NaviaBurst',
      blunt: true,
      poiseDamage: 50,
      label: 'Cannon Fire Support (C2)',
    })
  }
  // A1: 4 s (Navia's clock)
  c.buff('Navia', ['Navia', 'a1AfterSkill'], 'on', 0, 241, {
    hitlag: 'recipient',
  })
  s.a1Until = now + 240
  // the Shrapnel is used up (C6 keeps 3 more)
  s.shrapnel = c.constellation('Navia') >= 6 ? Math.max(n - 3, 0) : 0
}

/** A1's Geo conversion for a hit `d` frames from now */
const a1Geo = (ctx: SimContext, s: NaviaState, d: number) =>
  ctx.characterFrame('Navia') + d <= s.a1Until

// Not modelled: C1's energy (no energy simulation) and her Charged Attack (gcsim has none).
// Crystallize shards are collected only by her held skill (gcsim needs an explicit pick-up too).
export const kit: KitModel = {
  characterKey: 'Navia',
  element: 'geo',
  source: `${GCSIM}/navia`,
  init: (): NaviaState => ({
    shrapnel: 0,
    lastGain: -1e9,
    shards: [],
    burstIcdEnd: -1e9,
    lcrIcdEnd: -1e9,
    arkheFrom: -1e9,
    arkheUntil: -1e9,
    a1Until: -1e9,
  }),
  act(ctx, s: NaviaState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // A1: Geo while the Crystalshot's 4 s last
        const result = normalString(
          naviaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: a1Geo(ctx, s, d) ? 'geo' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
        // N3 cancels into the skill 1 frame later than the other abilities (30 vs 29)
        const into = result.framesInto
        if ((action.count ?? 1) === 3 && into && into.skill !== undefined)
          into.skill += 1
        return result
      }
      case 'charged':
        ctx.note(
          'Navia: Charged Attack not modelled (gcsim has no frames for it)'
        )
        return { frames: 30 }
      case 'skill': {
        // hE: the shortest hold (gcsim's hold=1): firing at 41; tap fires at 11
        const extra = 0
        const firing = action.hold ? 41 + extra : 11
        // two charges, 9 s each, recovering one after the other (gcsim's charge queue)
        ctx.atCharacter('Navia', firing, (c) => naviaFire(c, s))
        // the hold pulls in Crystallize shards within 12 m (checks every 30 frames from 12;
        // ~9 frames' travel; a shard can be picked up 31 frames after it spawns), each a Shrapnel
        if (action.hold)
          for (let at = 12; at < firing; at += 30)
            ctx.at(at, (c) => {
              const arrive = c.now + 9
              const fire = c.now - at + firing
              if (arrive >= fire) return
              s.shards = s.shards.filter((shard) => {
                if (shard.end <= c.now) return false
                if (shard.t + 31 > arrive) return true
                c.at(9, (c2) => gainShrapnel(s, c2.now))
                return false
              })
            })
        const cooldown = { key: 'skill', frames: 540, delay: firing }
        // gcsim's frames: the Shrapnel count at the press picks the table (3+ stacks: longer)
        const many = s.shrapnel >= 3
        if (!action.hold)
          return many
            ? {
                cooldown,
                frames: 41,
                framesInto: { normal: 40, dash: 26, jump: 24, swap: 40 },
              }
            : {
                cooldown,
                frames: 40,
                framesInto: { normal: 38, dash: 24, jump: 24, swap: 38 },
              }
        return many
          ? {
              cooldown,
              frames: 73 + extra,
              framesInto: {
                dash: 56 + extra,
                jump: 56 + extra,
                swap: 71 + extra,
              },
            }
          : {
              cooldown,
              frames: 71 + extra,
              framesInto: {
                normal: 70 + extra,
                dash: 54 + extra,
                jump: 54 + extra,
                swap: 69 + extra,
              },
            }
      }
      case 'burst': {
        // the initial shot (104 frames), then Cannon Fire Support (gcsim's ticks: 154 frames in,
        // then every 42 or 48 frames for 12 s, each landing 9 frames after it is fired)
        ctx.hit(104, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'none',
          blunt: true,
          poiseDamage: 100,
          label: 'Singing Salute',
        })
        let tick = 0
        let next = 0
        for (let i = 0; i <= 720; i += next) {
          tick++
          const d = 154 + i + 9
          ctx.hit(d, {
            path: ['burst', 'supportDmg'],
            tag: 'burst',
            element: 'geo',
            applies: true,
            durability: 25,
            icd: 'NaviaBurst',
            blunt: true,
            poiseDamage: 50,
            label: 'Cannon Fire Support',
          })
          next = tick % 3 === 2 ? 48 : 42
        }
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 127,
          framesInto: {
            normal: 102,
            skill: 102,
            dash: 103,
            jump: 103,
            swap: 93,
          },
        }
      }
      case 'plunge': {
        // gcsim's Low Plunge (the collision hit is off by default; it needs the airborne state)
        ctx.hit(37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: a1Geo(ctx, s, 37) ? 'geo' : 'physical',
          poiseDamage: 150,
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 82,
          framesInto: {
            normal: 50,
            skill: 50,
            burst: 50,
            dash: 37,
            swap: 62,
          },
        }
      }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength, female body)
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  charges: () => ({ skill: 2 }),
  onHit(ctx, s: NaviaState, hit) {
    // C4: a burst hit (the C2 shot too) lowers the enemy's Geo RES by 20% for 8 s
    if (
      hit.characterKey === 'Navia' &&
      hit.tag === 'burst' &&
      ctx.constellation('Navia') >= 4
    )
      ctx.buff('Navia', ['Navia', 'c4AfterBurstHit'], 'on', 0, 481, {
        hitlag: 'enemy',
      })
    // her burst's hits (its Cannon Fire Support and C2 too): once per 2.4 s (Navia's clock)
    if (
      hit.characterKey === 'Navia' &&
      hit.tag === 'burst' &&
      ctx.characterFrame('Navia') > s.burstIcdEnd
    ) {
      gainShrapnel(s, hit.t)
      s.burstIcdEnd = ctx.characterFrame('Navia') + 144
    }
    // any Lunar-Crystallize reaction in the party: once per 1 s
    const lunar =
      hit.tag === 'directLunarCrystallize' ||
      hit.tag === 'reactionLunarCrystallize' ||
      (hit.path[0] === REACTION_MARK[0] && hit.path[1] === REACTION_MARK[1])
    if (lunar && hit.t > s.lcrIcdEnd) {
      gainShrapnel(s, hit.t)
      s.lcrIcdEnd = hit.t + 60
    }
    // a Crystallize leaves a shard (15 s) for her hold to collect
    if (hit.path[0] === '_reaction' && hit.path[1] === 'crystallize')
      s.shards.push({ t: hit.t, end: hit.t + 900 })
  },
}
