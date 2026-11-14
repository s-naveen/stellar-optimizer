import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yoimiya, main as of 2026-11-10. */

/**
 * The bow's normal attack hits (gcsim's attackHitmarks; its cancel into the charged shot is the
 * Aim cancel, the hitmark). Each arrow lands `TRAVEL` frames after its hitmark (gcsim's default).
 */
const TRAVEL = 10
const yoimiyaNormals: NormalHit[] = [
  { hitmarks: [15, 24], toNormal: 35, toCharged: 24, toAbil: 24, frames: 35 },
  { hitmarks: [17], toNormal: 26, toCharged: 17, toAbil: 17, frames: 26 },
  { hitmarks: [25], toNormal: 39, toCharged: 25, toAbil: 25, frames: 39 },
  { hitmarks: [11, 26], toNormal: 44, toCharged: 26, toAbil: 26, frames: 44 },
  { hitmarks: [17], toNormal: 52, toCharged: 17, toAbil: 17, frames: 52 },
]

/** Niwabi Fire-Dance: 10 s (+ 11 frames of start-up), on Yoimiya's clock */
const NIWABI = 611

interface YoimiyaState {
  /** Niwabi Fire-Dance is on (it ends on swap out) */
  skillOn: boolean
  /** Bumped per cast: a timer stops if a newer one has started */
  skillGen: number
  /** A1: Pyro DMG stacks from Normal Attack hits, and until when they last (3 s from the last) */
  a1Stacks: number
  a1Until: number
  /** Aurous Blaze on the enemy: until (frame), and its 2 s ICD */
  abUntil: number
  abIcdUntil: number
  /** C2: the accumulated CRIT chance of her Pyro hits (a CRIT Hit at each whole one) */
  c2Chance: number
}

function endNiwabi(ctx: SimContext, s: YoimiyaState) {
  if (!s.skillOn) return
  s.skillOn = false
  ctx.state('Yoimiya', ['Yoimiya', 'skill'], '')
}

/** A1: a Blazing Arrow's hit while Niwabi is on and she is on the field adds a stack (3 s) */
function a1Hit(ctx: SimContext, s: YoimiyaState) {
  if (!s.skillOn || ctx.onField !== 'Yoimiya') return
  // (gcsim: the stacks are active on their expiry frame)
  if (ctx.now > s.a1Until) s.a1Stacks = 0
  s.a1Stacks = Math.min(10, s.a1Stacks + 1)
  const until = ctx.now + 180
  s.a1Until = until
  ctx.state('Yoimiya', ['Yoimiya', 'a1'], `${s.a1Stacks}`)
  ctx.at(181, (c) => {
    if (s.a1Until === until) c.state('Yoimiya', ['Yoimiya', 'a1'], '')
  })
}

/**
 * A Normal Attack: Pyro while Niwabi is on (each arrow snapshots as it is fired, gcsim's Snapshot
 * override), with A1's stacks on each hit and C6's Kindling attack (a 50% chance per attack, so a
 * weight of 0.5; snapshotted as the attack starts)
 */
function normal(
  ctx: SimContext,
  s: YoimiyaState,
  count: number,
  c: number,
  infused: boolean
): ActionResult {
  return normalString(
    yoimiyaNormals,
    count,
    (i, d, j) => {
      const at = d + TRAVEL
      ctx.hit(at, {
        path: ['normal', `${i}`],
        tag: 'normal',
        element: infused ? 'pyro' : 'physical',
        applies: true,
        icd: 'normal',
        label: `N${i + 1}`,
        snapshotDelay: d,
      })
      if (!infused) return
      ctx.at(at, (c2) => a1Hit(c2, s))
      // C6: the Kindling attack 5 frames after the attack's first hit
      if (c >= 6 && j === 0)
        ctx.hit(at + 5, {
          path: ['constellation6', `${i}`],
          tag: 'normal',
          element: 'pyro',
          applies: true,
          icd: 'normal',
          weight: 0.5,
          label: `Kindling (C6) N${i + 1}`,
          snapshotDelay: d - yoimiyaNormals[i].hitmarks[0],
        })
    },
    ctx
  )
}

export const kit: KitModel = {
  characterKey: 'Yoimiya',
  element: 'pyro',
  source: `${GCSIM}/yoimiya`,
  init: (): YoimiyaState => ({
    skillOn: false,
    skillGen: 0,
    a1Stacks: 0,
    a1Until: -1,
    abUntil: -1,
    abIcdUntil: -1,
    c2Chance: 0,
  }),
  onStart(ctx) {
    ctx.state('Yoimiya', ['Yoimiya', 'timeline'], 'on')
  },
  act(ctx, s: YoimiyaState, action, previous) {
    ctx.note(
      "Yoimiya: C1 (the ATK after a kill) is not modelled; C2 counts her Pyro hits' expected CRIT Hits."
    )
    const c = ctx.constellation('Yoimiya')
    switch (action.kind) {
      case 'normal':
        return normal(ctx, s, action.count ?? 1, c, s.skillOn)
      case 'charged':
        // the fully-charged Aimed Shot (no Kindling Arrows): fired 86 frames in, 10 of travel
        ctx.hit(96, {
          path: ['charged', 'full'],
          tag: 'charged',
          element: 'pyro',
          applies: true,
          label: 'Fully-Charged Aimed Shot',
          snapshotDelay: 86,
        })
        return { frames: 97, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        // a new Niwabi resets stale A1 stacks
        if (ctx.now > s.a1Until) s.a1Stacks = 0
        s.skillOn = true
        const gen = ++s.skillGen
        ctx.state('Yoimiya', ['Yoimiya', 'skill'], 'skill')
        ctx.atCharacter('Yoimiya', NIWABI, (c2) => {
          if (s.skillGen === gen) endNiwabi(c2, s)
        })
        // no damage: Niwabi Fire-Dance is a buff
        return {
          cooldown: { key: 'skill', frames: 1080, delay: 11 },
          frames: 34,
          framesInto: {
            normal: 22,
            charged: 22,
            burst: 23,
            jump: 32,
            swap: 31,
          },
        }
      }
      case 'burst': {
        // Aurous Blaze: the initial hit (75 frames in) marks the enemy for 10 s (14 s at C1)
        ctx.hit(75, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'burst',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Aurous Blaze (initial)',
        })
        ctx.at(75, (c2) => {
          s.abUntil = c2.now + (c >= 1 ? 840 : 600)
        })
        // A4: the other members' ATK for 15 s from 75 frames in, +1% per A1 stack she has when
        // she uses the burst (gcsim counts expired stacks too)
        const stacks = ctx.now <= s.a1Until ? s.a1Stacks : 0
        ctx.buff('Yoimiya', ['Yoimiya', 'burst'], 'on', 75, 900)
        if (stacks)
          ctx.buff('Yoimiya', ['Yoimiya', 'a4Stacks'], `${stacks}`, 75, 900)
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 113,
          framesInto: { skill: 112, dash: 111, jump: 112, swap: 109 },
        }
      }
      case 'dash':
        // the template's dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // the template's jump (Girl body): longer right after a dash
        return templateJump('girl', 'bow', previous, ctx)
      default:
        // gcsim has no plunge for Yoimiya: no damage
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: YoimiyaState) {
    // Niwabi Fire-Dance ends when she leaves the field
    endNiwabi(ctx, s)
  },
  onHit(ctx, s: YoimiyaState, hit) {
    // C2: a CRIT Hit of her Pyro DMG gives +25% Pyro DMG for 6 s (also off the field). The CRIT
    // Hits are the expected ones: her CRIT Rate accumulated over her Pyro hits
    if (
      hit.characterKey === 'Yoimiya' &&
      hit.element === 'pyro' &&
      !hit.path[0].startsWith('_') &&
      hit.path[0] !== 'reaction' &&
      ctx.constellation('Yoimiya') >= 2
    ) {
      // (without the team's stats, every Pyro hit is taken as a CRIT Hit: with her usual CRIT
      // Rate and hit rate the buff is up almost all the time anyway)
      const cr = ctx.calculate('Yoimiya', ['total', 'critRate_']) ?? 1
      s.c2Chance += Math.max(0, Math.min(1, cr)) * (hit.weight ?? 1)
      if (s.c2Chance >= 1 - 1e-9) {
        s.c2Chance -= 1
        ctx.buff('Yoimiya', ['Yoimiya', 'c2'], 'c2', 0, 360)
      }
    }
    // Aurous Blaze: another member's hit on the marked enemy (2 s ICD) explodes it, 1 frame later
    if (
      hit.characterKey === 'Yoimiya' ||
      // (gcsim: the mark and its ICD are active on their expiry frame)
      hit.t > s.abUntil ||
      hit.t <= s.abIcdUntil ||
      !['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag)
    )
      return
    s.abIcdUntil = hit.t + 120
    ctx.hit(1, {
      characterKey: 'Yoimiya',
      path: ['burst', 'exp'],
      tag: 'burst',
      element: 'pyro',
      applies: true,
      icd: 'burst',
      label: 'Aurous Blaze (explosion)',
      snapshotDelay: 0,
    })
    // C4: her Aurous Blaze's explosion cuts Niwabi Fire-Dance's cooldown by 1.2 s
    if (ctx.constellation('Yoimiya') >= 4)
      ctx.reduceCooldown('skill', 72, 'Yoimiya')
  },
}
