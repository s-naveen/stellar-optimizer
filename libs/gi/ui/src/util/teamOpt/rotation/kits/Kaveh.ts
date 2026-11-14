import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kaveh, main as of 2026-11-10. */

const kavehNormals: NormalHit[] = [
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 35,
    toCharged: 44,
    toAbil: 27,
    frames: 44,
  },
  {
    hitmarks: [22],
    hitlag: [9],
    toNormal: 35,
    toCharged: 45,
    toAbil: 22,
    frames: 45,
  },
  {
    hitmarks: [33],
    hitlag: [9],
    toNormal: 42,
    toCharged: 56,
    toAbil: 33,
    frames: 56,
  },
  {
    hitmarks: [40],
    hitlag: [10],
    toNormal: 67,
    toCharged: 81,
    toAbil: 40,
    frames: 81,
  },
]

interface KavehState {
  /** Painted Dome: its effects run from `domeStart` (world) to `domeEnd` (Kaveh's clock, inclusive) */
  domeStart: number
  domeEnd: number
  domeToken: number
  /** C6: its 3 s internal cooldown (world, inclusive) */
  c6Until: number
  /** A4: Elemental Mastery stacks (max 4) and their 0.1 s ICD (Kaveh's clock) */
  a4Stacks: number
  a4Ready: number
}

const inDome = (ctx: SimContext, s: KavehState, d = 0) =>
  ctx.now + d >= s.domeStart && ctx.characterFrame('Kaveh') + d <= s.domeEnd

/** Painted Dome's effects end (its duration, or Kaveh leaving the field) */
function endDome(ctx: SimContext, s: KavehState) {
  s.domeEnd = -1
  s.domeToken++
  s.a4Stacks = 0
  ctx.state('Kaveh', ['Kaveh', 'afterBurst'], '')
  ctx.state('Kaveh', ['Kaveh', 'a4Stacks'], '')
}

/**
 * C6: while the dome is up, a normal, charged or plunge hit on an enemy triggers Pairidaeza's
 * Dreams 18 frames later (once per 3 s). `d` is the hit's delay from the action's start.
 */
function c6Trigger(ctx: SimContext, s: KavehState, d: number) {
  const t = ctx.now + d
  if (ctx.constellation('Kaveh') < 6 || !inDome(ctx, s, d) || t <= s.c6Until)
    return
  s.c6Until = t + 180
  ctx.hit(d + 18, {
    path: ['constellation6', 'dmg'],
    tag: 'other',
    element: 'dendro',
    applies: true,
    icd: 'none',
    label: "Pairidaeza's Dreams (C6)",
  })
  // and bursts the Dendro Cores with it
  ctx.at(d + 18, (c) => c.ruptureDendroCores())
  // its 0.09 s halt on Kaveh (when on the field)
  ctx.at(d + 18, (c) => {
    if (c.onField === 'Kaveh')
      c.hit(0, {
        characterKey: 'Kaveh',
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 6,
        extendsAction: true,
        label: "Pairidaeza's Dreams hitlag",
      })
  })
}

export const kit: KitModel = {
  characterKey: 'Kaveh',
  element: 'dendro',
  source: `${GCSIM}/kaveh`,
  init: (): KavehState => ({
    domeStart: -1,
    domeEnd: -1,
    domeToken: 0,
    c6Until: -1,
    a4Stacks: 0,
    a4Ready: -1,
  }),
  // C2: Normal Attack SPD +15% during Painted Dome
  normalAttackSpeed: (ctx, s: KavehState, attacker) =>
    attacker === 'Kaveh' && ctx.constellation('Kaveh') >= 2 && inDome(ctx, s)
      ? 0.15
      : 0,
  act(ctx, s: KavehState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          kavehNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: inDome(ctx, s, d) ? 'dendro' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            c6Trigger(ctx, s, d)
          },
          ctx
        )
      case 'plunge': {
        // gcsim's Low Plunge (the High Plunge is the other sheet node)
        ctx.hit(41, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: inDome(ctx, s, 41) ? 'dendro' : 'physical',
          poiseDamage: 150,
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        c6Trigger(ctx, s, 41)
        return {
          frames: 85,
          framesInto: { normal: 54, skill: 54, burst: 55, dash: 41, swap: 65 },
        }
      }
      case 'skill': {
        // Artistic Ingenuity: 35 frames (gcsim has no held skill)
        if (action.hold)
          ctx.note(
            'Kaveh: a held Artistic Ingenuity is modelled as a tap (gcsim has no hold).'
          )
        ctx.hit(35, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Artistic Ingenuity',
        })
        // it bursts the Dendro Cores it reaches (gcsim: 3 frames after the hit)
        ctx.at(38, (c) => c.ruptureDendroCores())
        // C1: the healing bonus after the skill (180 frames from frame 33)
        if (ctx.constellation('Kaveh') >= 1)
          ctx.buff('Kaveh', ['Kaveh', 'c1AfterSkill'], 'on', 33, 181, {
            hitlag: 'recipient',
          })
        return {
          cooldown: { key: 'skill', frames: 360, delay: 33 },
          frames: 52,
          framesInto: {
            normal: 45,
            skill: 45,
            burst: 45,
            dash: 34,
            jump: 34,
            swap: 44,
          },
        }
      }
      case 'burst': {
        // Painted Dome: 36 frames; its Dendro infusion (normal attacks, charged and plunges) lasts 720
        ctx.hit(36, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'dendro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Painted Dome',
        })
        // its hit bursts the Dendro Cores
        ctx.at(36, (c) => c.ruptureDendroCores())
        // its effects from the hit (a world task at 36), 12 s on Kaveh's clock
        s.domeStart = ctx.now + 36
        ctx.at(36, (c) => {
          s.domeEnd = c.characterFrame('Kaveh') + 720
          s.a4Stacks = 0
          const token = ++s.domeToken
          c.state('Kaveh', ['Kaveh', 'afterBurst'], 'on')
          c.state('Kaveh', ['Kaveh', 'a4Stacks'], '')
          c.atCharacter('Kaveh', 721, (c2) => {
            if (s.domeToken === token) endDome(c2, s)
          })
        })
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 49,
          framesInto: { normal: 48, dash: 44, jump: 44, swap: 42 },
        }
      }
      case 'charged':
        // gcsim has no charged attack for Kaveh (its config marks it not implemented)
        ctx.note('Kaveh: charged attack not modelled (gcsim has none).')
        return { frames: 30 }
      case 'dash':
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('male', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // the dome ends when Kaveh leaves the field
  onSwapOut(ctx, s: KavehState) {
    if (ctx.characterFrame('Kaveh') <= s.domeEnd) endDome(ctx, s)
  },
  onHit(ctx, s: KavehState, hit) {
    // A4: during Painted Dome, Kaveh's normal, charged and plunge hits add 25 EM (max 4 stacks,
    // once per 0.1 s)
    if (
      hit.characterKey !== 'Kaveh' ||
      !['normal', 'charged', 'plunge'].includes(hit.tag) ||
      hit.path[0].startsWith('_') ||
      s.a4Stacks >= 4 ||
      !inDome(ctx, s)
    )
      return
    const now = ctx.characterFrame('Kaveh')
    if (now <= s.a4Ready) return
    s.a4Ready = now + 6
    s.a4Stacks++
    ctx.state('Kaveh', ['Kaveh', 'a4Stacks'], `${s.a4Stacks}`)
  },
}
