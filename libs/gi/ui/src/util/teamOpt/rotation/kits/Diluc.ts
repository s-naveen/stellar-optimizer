import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/diluc, main as of 2026-11-10. */

const dilucNormals: NormalHit[] = [
  {
    hitmarks: [24],
    hitlag: [10],
    toNormal: 32,
    toCharged: 32,
    toAbil: 24,
    frames: 32,
  },
  {
    hitmarks: [39],
    hitlag: [9],
    toNormal: 46,
    toCharged: 46,
    toAbil: 39,
    frames: 46,
  },
  {
    hitmarks: [26],
    hitlag: [9],
    toNormal: 34,
    toCharged: 34,
    toAbil: 26,
    frames: 34,
  },
  {
    hitmarks: [49],
    hitlag: [11],
    toNormal: 99,
    toCharged: 99,
    toAbil: 49,
    frames: 99,
  },
]

/** Each normal hit's poise damage (gcsim) */
const attackPoise = [108.1, 105.57, 119.03, 161.46]

/** Searing Onslaught's hitmarks, by cast in the combo (1st to 3rd) */
const skillHitmarks = [24, 28, 46]
/** Its hitlag: 0.12 / 0.12 / 0.16 s halts + defense halt, × 0.99, rounded up */
const skillHitlag = [11, 11, 14]

/** Searing Onslaught's frames by cast in the combo (a wait starts at the dash cancel) */
const skillCast = [
  {
    frames: 32,
    framesInto: { skill: 31, dash: 24, jump: 24, swap: 30, wait: 24 },
  },
  {
    frames: 38,
    framesInto: {
      skill: 37,
      burst: 37,
      dash: 28,
      jump: 31,
      swap: 36,
      wait: 28,
    },
  },
  {
    frames: 66,
    framesInto: {
      normal: 58,
      skill: 57,
      burst: 57,
      dash: 47,
      jump: 48,
      wait: 47,
    },
  },
]

interface DilucState {
  /** Searing Onslaught casts in the combo so far (the 3rd ends it); token guards stale resets */
  casts: number
  windowToken: number
  /** The last cast's C4 window (2–4 s after its hitmark, world frames) */
  c4Start: number
  c4End: number
  /** Skill state lasts until this frame (C6: a normal attack then continues the combo) */
  skillStateEnd: number
  /** The normal combo position before the skill (C6) */
  savedNormal: number
  /** C6: boosted normal hits so far in this window (2 at most), those before the current
   * normal attack, and the window's end */
  c6Used: number
  c6Before: number
  c6End: number
}

/** A character hitlag marker */
function hitlag(ctx: SimContext, at: number, frames: number, label: string) {
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: frames,
    label,
  })
}

/**
 * Dawn's phoenix (gcsim): 8 ticks every 12 frames while it flies forward 2.8 m per tick (16 x 8 m
 * boxes from 4 m behind each position), then explodes 23.8 m away (a 16 x 10 m box from 6 m back);
 * a tick lands if its box reaches the target
 */
function phoenixReaches(ctx: SimContext, from: number, to: number) {
  const { distance, radius } = ctx.target
  return from <= distance + radius && to >= distance - radius
}

// C1 (+15% while the enemy is above half HP) is the sheet's conditional; C2 needs incoming hits.
export const kit: KitModel = {
  characterKey: 'Diluc',
  element: 'pyro',
  source: `${GCSIM}/diluc`,
  init: (): DilucState => ({
    casts: 0,
    windowToken: 0,
    c4Start: -1e9,
    c4End: -1e9,
    skillStateEnd: -1e9,
    savedNormal: 0,
    c6Used: 2,
    c6Before: 2,
    c6End: -1e9,
  }),
  // C6: the boosted normal attacks' ATK SPD +30%. gcsim fixes a normal attack's ATK SPD as it
  // starts, and counts it only from a normal attack state with fewer than 2 boosted hits landed:
  // the second boosted normal of a string (the first one follows the skill)
  normalAttackSpeed: (ctx, s: DilucState, attacker, alreadyNormal) =>
    attacker === 'Diluc' &&
    alreadyNormal &&
    ctx.constellation('Diluc') >= 6 &&
    ctx.characterFrame('Diluc') <= s.c6End &&
    s.c6Before <= 1
      ? 0.3
      : 0,
  act(ctx, s: DilucState, action, previous) {
    const c = ctx.constellation('Diluc')
    switch (action.kind) {
      case 'normal': {
        // C6: Searing Onslaught does not interrupt the combo (a normal attack made in its state)
        if (c >= 6 && ctx.now <= s.skillStateEnd)
          ctx.normalSequence(dilucNormals.length, s.savedNormal)
        const result = normalString(
          dilucNormals,
          action.count ?? 1,
          (i, d) => {
            // C6: the next 2 normal attack hits within 6 s of Searing Onslaught: +30% DMG
            const c6 =
              c >= 6 &&
              s.c6Used < 2 &&
              ctx.characterFrame('Diluc') + d <= s.c6End
            s.c6Before = s.c6Used
            if (c6) s.c6Used++
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              // (Dawn's infusion makes it Pyro: ctx.infuse)
              element: 'physical',
              applies: true,
              icd: 'normal',
              poiseDamage: attackPoise[i],
              label: `N${i + 1}`,
              ...(c >= 6
                ? {
                    states: [
                      {
                        owner: 'Diluc' as const,
                        path: ['Diluc', 'DilucC6'],
                        value: c6 ? 'on' : '',
                      },
                    ],
                  }
                : {}),
            })
          },
          ctx
        )
        s.savedNormal = ctx.normalSequence(dilucNormals.length, 0)
        return result
      }
      case 'charged':
        // gcsim has no Charged Attack for Diluc (its CA-Spinning and CA-Final are unimplemented)
        ctx.note(
          'Diluc: Charged Attack not modelled (gcsim has no frames for it)'
        )
        return { frames: 30 }
      case 'skill': {
        // (no hold in gcsim: a held E is the same press)
        const k = s.casts
        const hm = skillHitmarks[k]
        // C4: 2 s after a cast's hit, for 2 s, the next Searing Onslaught in the combo deals +40%
        // (gcsim boosts any skill hit in that window, a new combo's first one included; the game
        // text and the sheet's nodes boost only the combo's 2nd and 3rd)
        const boosted =
          c >= 4 &&
          k > 0 &&
          ctx.now + hm >= s.c4Start &&
          ctx.now + hm <= s.c4End
        ctx.hit(hm, {
          path: boosted
            ? ['constellation4', k === 1 ? 'secondHitBoost' : 'thirdHitBoost']
            : ['skill', ['firstHit', 'secondHit', 'thirdHit'][k]],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 120,
          label: `Searing Onslaught ${k + 1}${boosted ? ' (C4)' : ''}`,
        })
        hitlag(ctx, hm, skillHitlag[k], 'Searing Onslaught hitlag')
        s.c4Start = ctx.now + hm + 120
        s.c4End = s.c4Start + 120
        if (c >= 6) {
          s.c6Used = 0
          s.c6End = ctx.characterFrame('Diluc') + 360
        }
        // the combo window: 4 s after each cast (Diluc's clock); the 3rd cast ends the combo
        const token = ++s.windowToken
        if (k === 2) s.casts = 0
        else {
          s.casts = k + 1
          ctx.atCharacter('Diluc', 241, () => {
            if (s.windowToken === token) s.casts = 0
          })
        }
        const result = withHitlag(skillCast[k], {
          hitmarks: [hm],
          hitlag: [skillHitlag[k]],
        })
        s.skillStateEnd = ctx.now + result.frames
        // the 1st cast starts the 10 s cooldown; the casts inside the window do not wait for it
        return k === 0
          ? { ...result, cooldown: { key: 'skill', frames: 600 } }
          : result
      }
      case 'burst': {
        // Dawn's Pyro Infusion: 8 s, +4 s and Pyro DMG +20% with A4 (assumed unlocked), on
        // Diluc's clock
        ctx.infuse('pyro', 0, 721, 'Diluc')
        ctx.buff('Diluc', ['Diluc', 'Burst'], 'on', 0, 721, {
          hitlag: 'recipient',
        })
        // the slash lands at 101 (a world task at 100), 8 DoT ticks 12 frames apart, the
        // explosion at 202, as far as the phoenix's path reaches the target
        const dawn = (d: number, node: string, label: string) =>
          ctx.hit(d, {
            path: ['burst', node],
            tag: 'burst',
            element: 'pyro',
            applies: true,
            durability: 50,
            // (gcsim's ICDGroupDiluc: all of Dawn's hits share one group)
            icd: 'Diluc',
            label,
          })
        if (phoenixReaches(ctx, -1, 5)) {
          dawn(101, 'slashDmg', 'Dawn (slash)')
          ctx.hit(101, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 9,
            label: 'Dawn hitlag',
          })
        }
        for (let i = 0; i < 8; i++)
          if (phoenixReaches(ctx, 2.8 * i - 4, 2.8 * i + 4))
            dawn(112 + 12 * i, 'dotDmg', 'Dawn (DoT)')
        if (phoenixReaches(ctx, 18.8, 28.8))
          dawn(202, 'explosionDmg', 'Dawn (explosion)')
        const result: ActionResult = {
          cooldown: { key: 'burst', frames: 720, delay: 14 },
          frames: 140,
          framesInto: { normal: 139, skill: 139, jump: 139, swap: 138 },
        }
        return phoenixReaches(ctx, -1, 5)
          ? withHitlag(result, { hitmarks: [101], hitlag: [9] })
          : result
      }
      case 'plunge': {
        // gcsim's Low Plunge (the collision hit is off by default); gcsim needs the airborne
        // state for plunges, which the rotation takes as given
        ctx.hit(36, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          poiseDamage: 150,
          label: 'Low Plunge',
        })
        return {
          frames: 78,
          framesInto: {
            normal: 49,
            skill: 50,
            burst: 49,
            dash: 36,
            jump: 77,
            swap: 59,
          },
        }
      }
      case 'dash':
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength, male body)
        return templateJump('male', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: DilucState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.casts === 0
        ? 'skill'
        : undefined,
}
