import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ningguang, main as of 2026-11-10. */

/** Her Normal and Charged Attacks come in three kinds (Left, Right, Twirl), chosen at random in gcsim */
type Kind = 'left' | 'right' | 'twirl'

/** A Normal Attack: 2 hits, 10 frames of projectile travel after its hitmark */
const naKinds: Record<Kind, NormalHit> = {
  left: {
    hitmarks: [39, 39],
    toNormal: 61,
    toCharged: 42,
    toAbil: 15,
    frames: 61,
  },
  right: {
    hitmarks: [29, 29],
    toNormal: 56,
    toCharged: 40,
    toAbil: 5,
    frames: 56,
  },
  twirl: {
    hitmarks: [37, 37],
    toNormal: 66,
    toCharged: 40,
    toAbil: 13,
    frames: 66,
  },
}

interface CaKind {
  /** Its hitmark (its base hit lands 10 frames later) */
  hit: number
  /** Its Star Jade gems' hitmark, and with C6 (7 gems) */
  gem: number
  gemC6: number
  frames: number
  framesInto: Record<
    'normal' | 'charged' | 'skill' | 'burst' | 'dash' | 'jump' | 'swap',
    number
  >
}

const caKinds: Record<Kind, CaKind> = {
  left: {
    hit: 35,
    gem: 45,
    gemC6: 40,
    frames: 52,
    framesInto: {
      normal: 46,
      charged: 47,
      skill: 48,
      burst: 47,
      dash: 32,
      jump: 32,
      swap: 46,
    },
  },
  right: {
    hit: 58,
    gem: 66,
    gemC6: 58,
    frames: 74,
    framesInto: {
      normal: 68,
      charged: 69,
      skill: 72,
      burst: 69,
      dash: 54,
      jump: 54,
      swap: 67,
    },
  },
  twirl: {
    hit: 66,
    gem: 74,
    gemC6: 67,
    frames: 82,
    framesInto: {
      normal: 76,
      charged: 76,
      skill: 77,
      burst: 77,
      dash: 61,
      jump: 62,
      swap: 76,
    },
  },
}

interface NingguangState {
  /** Star Jades: 0 to 3, or 7 after C6's burst */
  jades: number
  /** The kind of the last Normal or Charged Attack */
  prev: Kind
  /** The Jade Screen is up until this frame, and its token (a newer screen replaces it) */
  screenUntil: number
  screenToken: number
  /** The skill's snapshot (the Jade Screen's gems use it) */
  skillSnap?: { t: number; onField: CharacterKey }
  /** C2: the last time the cooldown was reset */
  c2ResetAt: number
}

/**
 * gcsim picks the next Normal (or Charged) Attack kind at random among the two other than the
 * last one; the cycle Left → Right → Twirl → Left takes those transitions with the same long-run
 * share of each kind (1/3)
 */
const NEXT: Record<Kind, Kind> = {
  left: 'right',
  right: 'twirl',
  twirl: 'left',
}

/** A Normal Attack's hit adds a Star Jade (up to 3) while she is on the field */
function gainJade(ctx: SimContext, s: NingguangState) {
  if (ctx.onField !== 'Ningguang' || s.jades === 7) return
  s.jades = Math.min(3, s.jades + 1)
}

/** The Jade Screen is destroyed (C2: the skill's cooldown resets, at most once per 6 s) */
function shatterScreen(ctx: SimContext, s: NingguangState) {
  s.screenUntil = ctx.now
  s.screenToken++
  ctx.state('Ningguang', ['Ningguang', 'Constellation4'], '')
  if (
    ctx.constellation('Ningguang') >= 2 &&
    ctx.now - s.c2ResetAt >= 360 &&
    ctx.cooldownReadyAt('skill') > ctx.now
  ) {
    s.c2ResetAt = ctx.now
    ctx.resetCooldown('skill')
  }
}

/** Enemy-only hitlag of a deployable hit */
const enemyHitlag = (ctx: SimContext, d: number, frames: number) =>
  ctx.hit(d, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: 0,
    enemyAnimationPause: frames,
    label: 'Enemy hitlag (deployable)',
  })

export const kit: KitModel = {
  characterKey: 'Ningguang',
  element: 'geo',
  source: `${GCSIM}/ningguang`,
  init: (): NingguangState => ({
    jades: 0,
    prev: 'left',
    screenUntil: -1e9,
    screenToken: 0,
    c2ResetAt: -1e9,
  }),
  onSwapOut(_ctx, s: NingguangState) {
    s.jades = 0
  },
  // A4: a member passing through the Jade Screen (gcsim: any dash while it is up) gets +12% Geo
  // DMG for 10 s
  onPartyAction(ctx, s: NingguangState, actor, action) {
    if (action.kind === 'dash' && ctx.now < s.screenUntil)
      ctx.buff('Ningguang', ['Ningguang', 'Ascension4'], 'on', 0, 601, {
        recipient: actor,
        hitlag: 'recipient',
      })
  },
  act(ctx, s: NingguangState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // each Normal Attack takes the next kind of the cycle (Left after a dash)
        const n = action.count ?? 1
        const kinds: Kind[] = []
        for (let i = 0; i < n; i++) {
          const k: Kind =
            i === 0 && previous?.kind === 'dash' ? 'left' : NEXT[s.prev]
          kinds.push(k)
          s.prev = k
        }
        return normalString(
          kinds.map((k) => naKinds[k]),
          n,
          (i, d, j) => {
            if (j === 0) ctx.at(d, (c2) => gainJade(c2, s))
            ctx.hit(d, {
              path: ['normal', '0'],
              tag: 'normal',
              element: 'geo',
              applies: true,
              icd: 'normal',
              blunt: true,
              poiseDamage: 45,
              label: `Sparkling Scatter (${kinds[i]})`,
            })
          },
          ctx
        )
      }
      case 'charged': {
        // after a Normal Attack the kind follows it (Left after Left or Twirl, Right after Right);
        // otherwise the next kind of the cycle (gcsim: random). Its windup is skipped after a
        // Normal or Charged Attack
        const afterNormal = previous?.kind === 'normal'
        const windup = afterNormal || previous?.kind === 'charged' ? 15 : 0
        const k: Kind = afterNormal
          ? s.prev === 'right'
            ? 'right'
            : 'left'
          : NEXT[s.prev]
        // (gcsim does not record a Charged Attack's kind for the next one)
        const ca = caKinds[k]
        ctx.hit(ca.hit - windup + 10, {
          path: ['charged', 'baseDmg'],
          tag: 'charged',
          element: 'geo',
          applies: true,
          icd: 'ExtraAttack',
          blunt: true,
          poiseDamage: 45,
          label: `Charged Attack (${k})`,
        })
        // the Star Jades are spent on it, one gem each
        const gemHit = s.jades === 7 ? ca.gemC6 : ca.gem
        for (let i = 0; i < s.jades; i++) {
          ctx.hit(gemHit - windup + 10, {
            path: ['charged', 'jadeDmg'],
            tag: 'charged',
            element: 'geo',
            applies: true,
            durability: 50,
            icd: 'ExtraAttack',
            blunt: true,
            poiseDamage: 30,
            label: 'Charged Attack (Star Jade)',
          })
          enemyHitlag(ctx, gemHit - windup + 10, 4)
        }
        s.jades = 0
        const f = ca.framesInto
        return {
          frames: ca.frames - windup,
          framesInto: {
            normal: f.normal - windup,
            charged: f.charged - windup,
            skill: f.skill - windup,
            burst: f.burst - windup,
            dash: f.dash - windup,
            jump: f.jump - windup,
            swap: f.swap - windup,
          },
        }
      }
      case 'skill': {
        // Jade Screen: its hit when placed (a world task at 17, snapshotted then; deployable:
        // the enemy alone takes its hitlag); the screen, a Geo construct, lasts 30 s
        ctx.hit(17, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          icd: 'none',
          blunt: true,
          poiseDamage: 133.2,
          label: 'Jade Screen',
        })
        enemyHitlag(ctx, 17, 7)
        ctx.at(17, (c) => {
          s.skillSnap = { t: c.now, onField: c.onField }
        })
        // a screen still up is replaced (destroyed: C2 can reset this cast's cooldown, which
        // starts first)
        const replaced = ctx.now < s.screenUntil
        if (replaced) ctx.at(0, (c) => shatterScreen(c, s))
        ctx.at(0, (c) => {
          s.screenUntil = c.now + 1800
          const token = ++s.screenToken
          c.construct(1800)
          // C4: Elemental RES +10% near the screen
          c.state('Ningguang', ['Ningguang', 'Constellation4'], 'on')
          c.at(1800, (c2) => {
            if (s.screenToken !== token) return
            c2.state('Ningguang', ['Ningguang', 'Constellation4'], '')
          })
        })
        return {
          cooldown: { key: 'skill', frames: 720 },
          frames: 62,
          framesInto: { dash: 28, jump: 29, swap: 60 },
        }
      }
      case 'burst': {
        // Starshatter: 6 Star Jade hits
        for (const t of [62, 97, 106, 110, 116, 124])
          ctx.hit(t, {
            path: ['burst', 'gemDmg'],
            tag: 'burst',
            element: 'geo',
            applies: true,
            durability: 50,
            icd: 'burst',
            blunt: true,
            poiseDamage: 30,
            label: 'Starshatter',
          })
        for (const t of [62, 97, 106, 110, 116, 124]) enemyHitlag(ctx, t, 4)
        // with the Jade Screen up, it is destroyed for 6 more gems (with the skill's snapshot)
        if (ctx.now < s.screenUntil) {
          const snap = s.skillSnap
          for (let i = 0; i < 6; i++)
            ctx.hit(154, {
              path: ['burst', 'gemDmg'],
              tag: 'burst',
              element: 'geo',
              applies: true,
              durability: 50,
              icd: 'burst',
              blunt: true,
              poiseDamage: 30,
              label: 'Starshatter (Jade Screen)',
              ...(snap
                ? {
                    statSnapshots: (
                      [
                        'atk',
                        'critRate_',
                        'critDMG_',
                        'all_dmg_',
                        'geo_dmg_',
                        'burst_dmg_',
                      ] as const
                    ).map((stat) => ({
                      stat,
                      path: ['total', stat],
                      ...snap,
                    })),
                  }
                : {}),
            })
          shatterScreen(ctx, s)
        }
        // C6: 7 Star Jades
        if (ctx.constellation('Ningguang') >= 6) s.jades = 7
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 127,
          framesInto: { dash: 99, jump: 100, swap: 98 },
        }
      }
      case 'dash':
        // template dash (Lady body)
        return { frames: 22, framesInto: { jump: 3 } }
      // template jump (Lady body): 37 frames after a dash, else 32
      case 'jump':
        return templateJump('lady', 'catalyst', previous, ctx)
      case 'plunge':
        // no plunge in gcsim for her: not modelled
        ctx.note(
          'Ningguang: the plunging attack has no gcsim frame data; not modelled'
        )
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
}
