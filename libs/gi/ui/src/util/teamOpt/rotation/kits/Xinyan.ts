import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xinyan, main as of 2026-11-10. */

const xinyanNormals: NormalHit[] = [
  {
    hitmarks: [25],
    hitlag: [10],
    toNormal: 33,
    toCharged: 33,
    toAbil: 25,
    frames: 33,
  },
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 39,
    toCharged: 39,
    toAbil: 27,
    frames: 39,
  },
  {
    hitmarks: [47],
    hitlag: [11],
    toNormal: 64,
    toCharged: 64,
    toAbil: 47,
    frames: 64,
  },
  {
    hitmarks: [35],
    hitlag: [11],
    toNormal: 94,
    toCharged: 94,
    toAbil: 35,
    frames: 94,
  },
]

/** Each normal hit's poise damage (gcsim) */
const attackPoise = [96.6, 93.15, 121.9, 146.63]

/** Sweeping Fervor's shield lasts 12 s */
const SHIELD = 12 * 60

interface XinyanState {
  /** The Sweeping Fervor shield is up until this frame, and its level */
  shieldUntil: number
  shieldLevel: number
  /** The level-3 shield's DoT chain (a new level-3 shield restarts it) */
  dotGen: number
  /** C1 (Xinyan's clock): the 5 s ICD, the ATK SPD buff's end, crit chance accumulated */
  c1Ready: number
  c1End: number
  c1Chance: number
}

/** Xinyan's hits whose CRIT procs C1 (any of her attacks: gcsim leaves out plunges, the game
 * text does not) */
const C1_HIT = new Set(['normal', 'charged', 'plunge', 'skill', 'burst'])

/** A character hitlag marker (total halt incl. defense halt, gcsim's ceil(dur × (1 − factor))) */
function hitlag(ctx: SimContext, at: number, frames: number, label: string) {
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: frames,
    label,
  })
}

/** A new shield (12 s); the level-3 Rave shield deals Pyro DMG every 2 s while it is up */
function shield(ctx: SimContext, s: XinyanState, level: number) {
  s.shieldLevel = level
  s.shieldUntil = ctx.now + SHIELD
  // A4: the shielded (active) character's Physical DMG +15% while the shield is up
  ctx.buff('Xinyan', ['Xinyan', 'p2Shield'], 'on', 0, SHIELD)
  const gen = ++s.dotGen
  if (level < 3) return
  const tick = (c: SimContext) => {
    if (s.dotGen !== gen || s.shieldLevel !== 3 || c.now >= s.shieldUntil)
      return
    c.hit(1, {
      path: ['skill', 'lvl3Dmg'],
      tag: 'skill',
      element: 'pyro',
      applies: true,
      durability: 25,
      icd: 'none',
      label: 'Sweeping Fervor (DoT)',
    })
    c.at(120, tick)
  }
  ctx.at(120, tick)
}

export const kit: KitModel = {
  characterKey: 'Xinyan',
  element: 'pyro',
  source: `${GCSIM}/xinyan`,
  init: (): XinyanState => ({
    shieldUntil: -1,
    shieldLevel: 1,
    dotGen: 0,
    c1Ready: -1,
    c1End: -1,
    c1Chance: 0,
  }),
  onStart(ctx) {
    if (ctx.constellation('Xinyan') >= 1)
      ctx.note(
        'Xinyan C1: the ATK SPD buff procs on an expected crit (the CRIT Rate accumulated over her hits once the 5 s cooldown is up), not a random roll.'
      )
  },
  // C1: Normal (and Charged) Attack ATK SPD +12% for 5 s (Xinyan's clock); gcsim fixes a normal
  // attack's ATK SPD as it starts and counts C1 only from a normal attack state
  normalAttackSpeed: (ctx, s: XinyanState, attacker, alreadyNormal) =>
    attacker === 'Xinyan' &&
    alreadyNormal &&
    ctx.characterFrame('Xinyan') <= s.c1End
      ? 0.12
      : 0,
  act(ctx, s: XinyanState, action, previous) {
    const c = ctx.constellation('Xinyan')
    switch (action.kind) {
      case 'normal':
        return normalString(
          xinyanNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              poiseDamage: attackPoise[i],
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        return {
          frames: 0,
          failed: 'Xinyan: charged attack is not in gcsim yet (not modelled)',
        }
      case 'skill': {
        ctx.hit(15, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 200,
          label: 'Sweeping Fervor (Initial)',
        })
        // 0.09 s halt + defense halt
        hitlag(ctx, 15, 9, 'Sweeping Fervor hitlag')
        // the shield, 28 frames in (Xinyan's clock): a new Ad Lib only when none is up, then the
        // hit's Lead-In upgrade (A1: one opponent; Rave needs two, so single target: level 2).
        // An existing level 2 or 3 shield is not refreshed
        ctx.atCharacter('Xinyan', 28, (at) => {
          const up = at.now < s.shieldUntil
          if (!up || s.shieldLevel < 2) shield(at, s, 2)
        })
        // C4: the swing lowers the enemy's Physical RES by 15% for 12 s
        if (c >= 4)
          ctx.buff('Xinyan', ['Xinyan', 'c4Burst'], 'on', 15, SHIELD, {
            hitlag: 'enemy',
          })
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 1080, delay: 13 },
            frames: 62,
            framesInto: { normal: 53, burst: 54, dash: 54, jump: 53 },
          },
          { hitmarks: [15], hitlag: [9] }
        )
      }
      case 'burst': {
        ctx.hit(22, {
          path: ['burst', 'pressPhysDmg'],
          tag: 'burst',
          element: 'physical',
          applies: true,
          durability: 100,
          icd: 'none',
          label: 'Riff Revolution (Initial)',
        })
        // defense halt only
        hitlag(ctx, 22, 4, 'Riff Revolution hitlag')
        // the Pyro DoT: the first at 57 frames (Xinyan's clock, with its own defense halt), then
        // six every 17 frames from 17 after it (gcsim queues them after that halt)
        ctx.atCharacter('Xinyan', 57, (at) => {
          for (let i = 0; i < 7; i++)
            at.hit(i ? 17 * i : 0, {
              path: ['burst', 'dotPyroDmg'],
              tag: 'burst',
              element: 'pyro',
              applies: true,
              icd: 'burst',
              label: 'Riff Revolution (DoT)',
            })
          hitlag(at, 0, 4, 'Riff Revolution DoT hitlag')
        })
        if (c >= 2) {
          // C2: a Rave shield (level 3) 43 frames in (Xinyan's clock), and two extra pulses of its
          // DoT at 65 and 83 frames
          ctx.atCharacter('Xinyan', 43, (at) => shield(at, s, 3))
          for (const t of [65, 83])
            ctx.hit(t, {
              path: ['skill', 'lvl3Dmg'],
              tag: 'skill',
              element: 'pyro',
              applies: true,
              icd: 'none',
              label: 'Sweeping Fervor (C2 pulse)',
            })
        }
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900, delay: 1 },
            frames: 87,
            framesInto: { normal: 86, swap: 86 },
          },
          // the initial hit's halt; the first DoT's (57 frames on Xinyan's clock) after it
          { hitmarks: [22, 61], hitlag: [4, 4] }
        )
      }
      case 'plunge':
        // gcsim's Low Plunge (it only allows plunges in its Xianyun-airborne state; modelled as a plain one)
        ctx.hit(38, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          poiseDamage: 150,
          label: 'Low Plunge',
        })
        return {
          frames: 81,
          framesInto: {
            normal: 51,
            charged: 51,
            skill: 51,
            burst: 51,
            dash: 38,
            swap: 64,
          },
        }
      case 'dash':
        // Girl body
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: XinyanState, hit) {
    // C1: a CRIT Hit by Xinyan while she is on the field (once every 5 s, Xinyan's clock)
    if (
      ctx.constellation('Xinyan') < 1 ||
      hit.characterKey !== 'Xinyan' ||
      ctx.onField !== 'Xinyan' ||
      !C1_HIT.has(hit.tag) ||
      hit.path[0].startsWith('_')
    )
      return
    const now = ctx.characterFrame('Xinyan')
    if (now <= s.c1Ready) return
    // (without the damage evaluator's stats, a 50% CRIT Rate is assumed)
    let cr = ctx.calculate('Xinyan', ['total', 'critRate_']) ?? 0.5
    // C2: +100% CRIT Rate on Riff Revolution's Physical hit
    if (
      hit.path.join('.') === 'burst.pressPhysDmg' &&
      ctx.constellation('Xinyan') >= 2
    )
      cr += 1
    s.c1Chance += Math.max(0, Math.min(1, cr))
    if (s.c1Chance < 1 - 1e-9) return
    s.c1Chance = 0
    s.c1Ready = now + 300
    s.c1End = now + 300
  },
}
