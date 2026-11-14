import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/gaming, main as of 2026-11-10. */

const gamingNormals: NormalHit[] = [
  {
    hitmarks: [25],
    hitlag: [10],
    toNormal: 30,
    toCharged: 39,
    toAbil: 25,
    frames: 39,
  },
  {
    hitmarks: [18],
    hitlag: [9],
    toNormal: 32,
    toCharged: 46,
    toAbil: 18,
    frames: 46,
  },
  {
    hitmarks: [34],
    hitlag: [11],
    toNormal: 79,
    toCharged: 86,
    toAbil: 34,
    frames: 86,
  },
  {
    hitmarks: [48],
    hitlag: [11],
    toNormal: 87,
    toCharged: 89,
    toAbil: 48,
    frames: 89,
  },
]

/** The Elemental Skill: 6 s cooldown, starting 4 frames in */
const SKILL_CD = 360
const SKILL_DELAY = 4

interface GamingState {
  /** Suanni Man Chai is out until this frame (only one at a time) */
  manChaiEnd: number
  /** Wushou Stance (Q) is up until this frame (Gaming's clock; it ends when he leaves the field) */
  burstUntil: number
  /** The last action was Gaming's Elemental Skill: a Charmed Cloudstrider plunge */
  afterSkill: boolean
  /** A1's healing (0.8 s) runs until this frame (Gaming's clock) */
  a1Until: number
}

const gamingClock = (ctx: SimContext) => ctx.characterFrame('Gaming')
/** HP above 50% (tracked HP; otherwise assumed) */
const hpAbove = (ctx: SimContext) => (ctx.hpRatio('Gaming') ?? 1) > 0.5

/**
 * Suanni Man Chai appears (unless one is out) and links up with Gaming `walk` frames later: if he
 * is on the field then, the Elemental Skill's cooldown resets (and C1 heals 15% of his HP)
 */
function manChai(ctx: SimContext, s: GamingState, walk: number) {
  if (ctx.now < s.manChaiEnd) return
  const end = ctx.now + walk
  s.manChaiEnd = end
  ctx.at(walk, (c) => {
    if (c.onField !== 'Gaming') return
    s.manChaiEnd = c.now
    c.resetCooldown('skill', 1, 'Gaming')
    if (c.constellation('Gaming') >= 1 && c.healthTracked)
      c.healPercent('Gaming', 0.15, ['Gaming'])
  })
}

/** A4's state from the tracked HP: +20% Charmed Cloudstrider DMG at 50% HP or more */
function a4State(ctx: SimContext) {
  const ratio = ctx.hpRatio('Gaming')
  if (ratio !== undefined)
    ctx.state(
      'Gaming',
      ['Gaming', 'a4HpState'],
      ratio >= 0.5 ? 'above' : 'below'
    )
}

export const kit: KitModel = {
  characterKey: 'Gaming',
  element: 'pyro',
  source: `${GCSIM}/gaming`,
  init: (): GamingState => ({
    manChaiEnd: -1,
    burstUntil: -1,
    afterSkill: false,
    a1Until: -1,
  }),
  onStart(ctx) {
    // HP not tracked: A4's +20% Charmed Cloudstrider DMG (50% HP or more) is assumed on
    ctx.state('Gaming', ['Gaming', 'a4HpState'], 'above')
  },
  onHpChange(ctx, _s: GamingState, change) {
    if (change.characterKey !== 'Gaming') return
    a4State(ctx)
    // C2: an overflowing heal gives +20% ATK for 5 s
    if (
      change.kind === 'heal' &&
      change.overheal > 1e-9 &&
      ctx.constellation('Gaming') >= 2
    )
      ctx.buff('Gaming', ['Gaming', 'c2Overheal'], 'on', 0, 300, {
        hitlag: 'recipient',
      })
  },
  act(ctx, s: GamingState, action, previous) {
    if (action.kind === 'charged')
      return {
        frames: 0,
        failed: 'Gaming: charged attack has no gcsim frame data (not modelled)',
      }
    const afterSkill = s.afterSkill
    s.afterSkill = action.kind === 'skill'
    switch (action.kind) {
      case 'normal':
        return normalString(
          gamingNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'skill':
        // no damage of its own: the plunge after it is the Charmed Cloudstrider
        return {
          cooldown: { key: 'skill', frames: SKILL_CD, delay: SKILL_DELAY },
          frames: 64,
          framesInto: { plunge: 23, jump: 63, swap: 63 },
        }
      case 'burst': {
        ctx.hit(60, {
          path: ['burst', 'smashDmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          icd: 'burst',
          label: "Suanni's Gilded Dance",
        })
        // Wushou Stance from 36 frames in, for 12 s; it heals 30% of his Max HP then
        ctx.at(36, (c) => {
          s.burstUntil = gamingClock(c) + 720
          if (c.healthTracked) c.healPercent('Gaming', 0.3, ['Gaming'])
        })
        // Suanni Man Chai: out 61 frames in, back 100 frames later
        ctx.at(61, (c) => manChai(c, s, 100))
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 77,
          framesInto: { normal: 63, skill: 63, dash: 66, jump: 65 },
        }
      }
      case 'plunge': {
        if (afterSkill) {
          // Plunging Attack: Charmed Cloudstrider, 32 frames in
          ctx.hit(32, {
            path: ['skill', 'cloudstriderDmg'],
            tag: 'plunge',
            element: 'pyro',
            applies: true,
            label: 'Plunging Attack: Charmed Cloudstrider',
          })
          ctx.at(32, (c) => {
            // A1: 1.5% of his Max HP every 0.2 s for 0.8 s (not while one runs)
            if (!c.healthTracked || gamingClock(c) <= s.a1Until) return
            s.a1Until = gamingClock(c) + 48
            const heal = (c2: SimContext) => {
              if (gamingClock(c2) > s.a1Until) return
              c2.healPercent('Gaming', 0.015, ['Gaming'])
              c2.atCharacter('Gaming', 12, heal)
            }
            c.atCharacter('Gaming', 12, heal)
          })
          // a frame later: Man Chai while Wushou Stance is up with HP above 50%, then the HP cost
          // (15% of his Max HP, not below 10%)
          ctx.at(33, (c) => {
            if (gamingClock(c) <= s.burstUntil && hpAbove(c)) manChai(c, s, 92)
            const ratio = c.hpRatio('Gaming')
            if (ratio !== undefined && ratio > 0.1)
              c.drainHp('Gaming', Math.min(0.15, ratio - 0.1))
          })
          return {
            frames: 99,
            framesInto: {
              normal: 52,
              skill: 52,
              burst: 52,
              dash: 32,
              swap: 69,
            },
          }
        }
        // not after the skill: a plain Low Plunge (gcsim only allows plunges in its Xianyun-airborne state)
        ctx.hit(43, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 84,
          framesInto: { normal: 56, skill: 56, burst: 56, dash: 43, swap: 67 },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(_ctx, s: GamingState) {
    // leaving the field ends Wushou Stance, and the skill-into-plunge link
    s.burstUntil = -1
    s.afterSkill = false
  },
}
