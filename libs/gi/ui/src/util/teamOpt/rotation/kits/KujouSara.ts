import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/sara, main as of 2026-11-10. */

/** Normal attack string (gcsim attack.go): the arrows land 10 frames after their hitmark */
const saraNormals: NormalHit[] = [
  { hitmarks: [24], toNormal: 25, toCharged: 14, toAbil: 14, frames: 25 },
  { hitmarks: [23], toNormal: 28, toCharged: 13, toAbil: 13, frames: 28 },
  { hitmarks: [29], toNormal: 37, toCharged: 19, toAbil: 19, frames: 37 },
  { hitmarks: [29], toNormal: 38, toCharged: 19, toAbil: 19, frames: 38 },
  { hitmarks: [42], toNormal: 45, toCharged: 32, toAbil: 32, frames: 45 },
]

type Hit = Parameters<SimContext['hit']>[1]

/** The player's hurtbox radius (gcsim's default) and the AoE radii of the Tengu Juurai */
const PLAYER_RADIUS = 0.3
const CLUSTER_RADIUS = 3
const AMBUSH_RADIUS = 6
const TITANBREAKER_RADIUS = 6

interface SaraState {
  /** Crowfeather Cover (Tengu Stormcall, 18 s) lasts until this frame */
  coverEnd: number
  /** C1's 3 s cooldown ends (Sara's clock) */
  c1Ready: number
}

/** The Fully-Charged Aimed Shot's Electro hit */
const fullyAimed = (label: string, snapshotDelay: number): Hit => ({
  path: ['charged', 'fullyAimed'],
  tag: 'charged',
  element: 'electro',
  applies: true,
  durability: 25,
  icd: 'none',
  label,
  snapshotDelay,
})

/** C1: a Tengu Juurai's hit or ATK bonus cuts Tengu Stormcall's cooldown by 1 s, once every 3 s */
function c1(c: SimContext, s: SaraState) {
  if (c.constellation('KujouSara') < 1) return
  const now = c.characterFrame('KujouSara')
  if (now < s.c1Ready) return
  s.c1Ready = now + 180
  c.reduceCooldown('skill', 60, 'KujouSara')
}

/**
 * A Tengu Juurai's ATK bonus (C6: its Electro CRIT DMG too) on the character on the field `delay`
 * frames from now, for 6 s, if its AoE reaches the player (gcsim's attackBuff)
 */
function tengu(
  ctx: SimContext,
  s: SaraState,
  delay: number,
  reachesPlayer: boolean
) {
  if (!reachesPlayer) return
  ctx.at(delay, (c) => {
    c.buff('KujouSara', ['KujouSara', 'tenguRecipient'], 'on', 0, 360, {
      recipient: c.onField,
      hitlag: 'recipient',
    })
    c1(c, s)
  })
}

/** A Tengu Juurai hit on the enemy (C1 on hit) */
function juurai(ctx: SimContext, s: SaraState, delay: number, hit: Hit) {
  ctx.hit(delay, hit)
  ctx.at(delay, (c) => c1(c, s))
}

export const kit: KitModel = {
  characterKey: 'KujouSara',
  element: 'electro',
  source: `${GCSIM}/sara`,
  init: (): SaraState => ({ coverEnd: -1, c1Ready: 0 }),
  onStart(ctx) {
    ctx.state('KujouSara', ['KujouSara', 'timeline'], 'on')
    ctx.state('KujouSara', ['KujouSara', 'tenguRecipient'], '')
  },
  act(ctx, s: SaraState, action, previous) {
    const c = ctx.constellation('KujouSara')
    const { radius, distance } = ctx.target
    switch (action.kind) {
      case 'normal':
        return normalString(
          saraNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
              snapshotDelay: d - 10,
            }),
          ctx
        )
      case 'charged': {
        if (ctx.now < s.coverEnd) {
          // A1: with Crowfeather Cover the Fully-Charged Aimed Shot is 60% faster; the Crowfeather
          // it leaves at the target (snapshotted as the arrow is fired) explodes 90 frames after it
          s.coverEnd = -1
          ctx.hit(60, fullyAimed('Fully-Charged Aimed Shot (A1)', 50))
          juurai(ctx, s, 150, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'none',
            label: 'Tengu Juurai: Ambush',
            snapshotDelay: 50,
          })
          tengu(ctx, s, 151, distance <= AMBUSH_RADIUS + PLAYER_RADIUS)
          return { frames: 60, framesInto: { dash: 50, jump: 50 } }
        }
        ctx.hit(96, fullyAimed('Fully-Charged Aimed Shot', 86))
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      }
      case 'skill': {
        s.coverEnd = ctx.now + 1080
        if (c >= 2 && distance <= AMBUSH_RADIUS + radius) {
          // C2: a weaker Crowfeather (30% of the Ambush) at Sara's position, 103 frames in
          juurai(ctx, s, 103, {
            path: ['constellation2', 'dmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            durability: 25,
            icd: 'none',
            label: 'Tengu Juurai: Ambush (C2, weaker)',
            snapshotDelay: 50,
          })
        }
        if (c >= 2) tengu(ctx, s, 104, true)
        return {
          cooldown: { key: 'skill', frames: 600, delay: 7 },
          frames: 52,
          framesInto: {
            normal: 29,
            charged: 30,
            burst: 32,
            jump: 51,
            swap: 50,
          },
        }
      }
      case 'burst': {
        // everything snapshots at frame 47 (the cooldown start)
        juurai(ctx, s, 51, {
          path: ['burst', 'titanbreaker'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Tengu Juurai: Titanbreaker',
          snapshotDelay: 47,
        })
        tengu(ctx, s, 52, distance <= TITANBREAKER_RADIUS + PLAYER_RADIUS)
        // Stormclusters: 4 (6 with C4) moving out from the target in evenly spread directions (the
        // first towards the far side), 6 ticks each, 18 frames apart from frame 100, 3.6 m out
        // then 1.35 m further per tick: a tick hits the enemy, or buffs the player, whose
        // hurtbox its 3 m AoE reaches
        const clusters = c >= 4 ? 6 : 4
        for (let j = 0; j < 6; j++) {
          const out = 3.6 + 1.35 * j
          let reachesPlayer = false
          for (let i = 0; i < clusters; i++) {
            const angle = (2 * Math.PI * i) / clusters
            const x = out * Math.sin(angle)
            const y = distance + out * Math.cos(angle)
            if (Math.hypot(x, y) <= CLUSTER_RADIUS + PLAYER_RADIUS)
              reachesPlayer = true
            if (out <= CLUSTER_RADIUS + radius)
              juurai(ctx, s, 100 + 18 * j, {
                path: ['burst', 'stormcluster'],
                tag: 'burst',
                element: 'electro',
                applies: true,
                durability: 25,
                icd: 'burst',
                label: 'Tengu Juurai: Stormcluster',
                snapshotDelay: 47,
              })
          }
          tengu(ctx, s, 101 + 18 * j, reachesPlayer)
        }
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 47 },
          frames: 80,
          framesInto: { normal: 78, skill: 57, dash: 58, jump: 58, swap: 56 },
        }
      }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'bow', previous, ctx)
      case 'plunge':
        ctx.note(
          'Sara: plunge is not modelled (gcsim has no plunge frames for Sara)'
        )
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
}
