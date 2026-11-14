import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yaoyao, main as of 2026-11-10. */

// N3 is two hits (sheet nodes 2 and 3); its cancels are from the second hit's frame.
const yaoyaoNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 22,
    toCharged: 22,
    toAbil: 13,
    frames: 28,
  },
  {
    hitmarks: [16],
    hitlag: [8],
    toNormal: 22,
    toCharged: 25,
    toAbil: 16,
    frames: 31,
  },
  {
    hitmarks: [12, 31],
    hitlag: [0, 5],
    toNormal: 41,
    toCharged: 37,
    toAbil: 31,
    frames: 51,
  },
  {
    hitmarks: [21],
    hitlag: [9],
    toNormal: 59,
    toCharged: 59,
    toAbil: 21,
    frames: 59,
  },
]

/** The sheet's normal node for string step i (N3's two hits: 2 and 3) */
const normalNode = (i: number, j: number) => (i === 2 ? 2 + j : i === 3 ? 4 : i)

interface YaoyaoState {
  /** The cast that started Moonjade Descent (its Yuegui and A1 work only while it is that one) */
  burstTok?: number
  /** Dash and jump intervals [from, to): A1 throws a radish at a tick in one of them */
  air: [number, number][]
}

/**
 * Adeptal Legacy lasts 360 frames from the cast (gcsim): the burst's 5 s "Adeptal Legacy Duration"
 * after its ~1 s (63-frame) animation
 */
const BURST_DUR = 360
/** C4: Elemental Mastery for 8.8 s from the cast (gcsim; the text's "for 8s" seemingly counts from
 * the end of the cast) */
const C4_DUR = 528

/** Adeptal Legacy is up at this frame (its radishes are burst radishes then) */
const inBurst = (s: YaoyaoState, t: number) =>
  s.burstTok !== undefined && t < s.burstTok + BURST_DUR

/** A Yuegui's radish from a throw: lands 13 frames after the throw */
const throwRadish = (
  c: SimContext,
  path: string[],
  icd: string,
  label: string,
  icdGroup: string,
  snapshotAt?: number
) =>
  c.hit(13, {
    path,
    tag: path[0] === 'burst' ? 'burst' : 'skill',
    element: 'dendro',
    applies: true,
    durability: 25,
    icd,
    icdGroup,
    label,
    ...(snapshotAt === undefined
      ? {}
      : {
          statSnapshots: [
            {
              stat: 'atk' as const,
              path: ['total', 'atk'],
              t: snapshotAt,
              onField: 'Yaoyao' as const,
            },
            {
              stat: 'dendro_dmg_' as const,
              path: ['total', 'dendro_dmg_'],
              t: snapshotAt,
              onField: 'Yaoyao' as const,
            },
            {
              stat: 'eleMas' as const,
              path: ['total', 'eleMas'],
              t: snapshotAt,
              onField: 'Yaoyao' as const,
            },
          ],
        }),
  })

/** C6: the Mega Radish of every 3rd and 6th throw of the summoned Yuegui, 20 frames after it */
const megaRadish = (c: SimContext) => {
  if (c.constellation('Yaoyao') < 6) return
  c.hit(20, {
    path: ['constellation6', 'dmg'],
    tag: 'other',
    element: 'dendro',
    applies: true,
    durability: 25,
    icd: 'none',
    label: 'Mega Radish (C6)',
  })
}

/**
 * The summoned Yuegui throws every 60 frames from its first think (29 frames after its summon), while
 * it lasts (600 frames from the summon, `end`); `n` is the throw number
 */
const skillThrow =
  (s: YaoyaoState, end: number, n: number, snapshotAt: number) =>
  (c: SimContext): void => {
    if (c.now >= end) return
    // under Adeptal Legacy its radishes are the burst's (Elemental Burst DMG), with its stats
    if (inBurst(s, c.now + 13))
      throwRadish(
        c,
        ['burst', 'radish'],
        'yaoyaoRadishBurst',
        'Radish (Moonjade, Yuegui)',
        'YaoyaoRadishBurst',
        snapshotAt
      )
    else
      throwRadish(
        c,
        ['skill', 'dmg'],
        'yaoyaoRadishSkill',
        'Radish (Yuegui)',
        'YaoyaoRadishSkill',
        snapshotAt
      )
    if (n === 2 || n === 5) megaRadish(c)
    c.at(60, skillThrow(s, end, n + 1, snapshotAt))
  }

/** A jumping Yuegui of Moonjade Descent: throws every 60 frames while the burst lasts */
const jumpThrow =
  (s: YaoyaoState, tok: number) =>
  (c: SimContext): void => {
    if (s.burstTok !== tok || c.now >= tok + BURST_DUR) return
    throwRadish(
      c,
      ['burst', 'radish'],
      'yaoyaoRadishBurst',
      'Radish (Moonjade, Yuegui)',
      'YaoyaoRadishBurst'
    )
    c.at(60, jumpThrow(s, tok))
  }

/** A1: every 36 frames while the burst lasts, a radish on an enemy if she is dashing or jumping */
const a1Tick =
  (s: YaoyaoState, tok: number) =>
  (c: SimContext): void => {
    if (s.burstTok !== tok || c.now >= tok + BURST_DUR) return
    if (s.air.some(([a, b]) => a <= c.now && c.now < b))
      c.at(12, (c2) =>
        throwRadish(
          c2,
          ['burst', 'radish'],
          'yaoyaoRadishBurst',
          'Radish (A1, in the air)',
          'YaoyaoRadishBurst'
        )
      )
    c.at(36, a1Tick(s, tok))
  }

export const kit: KitModel = {
  characterKey: 'Yaoyao',
  element: 'dendro',
  source: `${GCSIM}/yaoyao`,
  init: (): YaoyaoState => ({ air: [] }),
  act(ctx, s: YaoyaoState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          yaoyaoNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${normalNode(i, j)}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(24, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'extraAttack',
          icdGroup: 'PoleExtraAttack',
          label: 'Charge',
        })
        return {
          frames: 55,
          framesInto: {
            normal: 49,
            skill: 49,
            burst: 50,
            dash: 24,
            jump: 24,
            swap: 49,
          },
        }
      case 'skill': {
        // Yuegui: summoned 63 frames after the cast; its first throw 92 frames after the cast
        // (a throw every 60 frames until 663). The radish lands on an enemy (assumed: the active
        // member is above 70% HP and an enemy is in reach, so no heal-at-self throws).
        ctx.at(92, skillThrow(s, ctx.now + 663, 0, ctx.now + 63))
        // C4: Elemental Mastery for 8 s after the skill (a sheet conditional)
        if (ctx.constellation('Yaoyao') >= 4)
          ctx.buff('Yaoyao', ['Yaoyao', 'c4AfterSkillBurst'], 'on', 0, C4_DUR, {
            hitlag: 'recipient',
          })
        // (C1's Dendro DMG and A4's heals need the radish to explode on the active character, as in
        // gcsim, where it lands on the enemy: not modelled)
        return {
          cooldown: { key: 'skill', frames: 900, delay: 15 },
          frames: 52,
          framesInto: { dash: 49, jump: 48, swap: 50 },
        }
      }
      case 'burst': {
        const tok = ctx.now
        s.burstTok = tok
        // Moonjade Descent's hit at 16 frames
        ctx.hit(16, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Moonjade Descent',
        })
        // three jumping Yuegui, at 104, 162 and 221 frames: each throws 29 frames after it appears
        for (const spawn of [104, 162, 221])
          ctx.at(spawn, (c) => {
            if (s.burstTok === tok) c.at(29, jumpThrow(s, tok))
          })
        // A1 (assumed: ascension 1+): a radish every 36 frames while she is dashing or jumping
        ctx.at(36, a1Tick(s, tok))
        // C4: Elemental Mastery for 8 s after the burst
        if (ctx.constellation('Yaoyao') >= 4)
          ctx.buff('Yaoyao', ['Yaoyao', 'c4AfterSkillBurst'], 'on', 0, C4_DUR, {
            hitlag: 'recipient',
          })
        // (the hit's 1.2-frame halt pauses her)
        ctx.hit(16, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 2,
          label: 'Yaoyao burst hitlag',
        })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 1200 },
            frames: 63,
            framesInto: { normal: 58, skill: 57, dash: 58, jump: 57, swap: 56 },
          },
          { hitmarks: [16], hitlag: [2] }
        )
      }
      case 'plunge':
        // gcsim has no plunge for Yaoyao
        ctx.note(
          'Yaoyao: the plunge is not in gcsim (not modelled: no damage, default frames).'
        )
        return { frames: 30 }
      case 'dash':
        // Loli body: a 21-frame dash, which can jump after 4 frames
        s.air.push([ctx.now, ctx.now + 21])
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump': {
        // the template's jump (Loli body): longer right after a dash
        const jump = templateJump('loli', 'polearm', previous, ctx)
        s.air.push([ctx.now, ctx.now + jump.frames])
        return jump
      }
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(_ctx, s: YaoyaoState) {
    // leaving the field ends Moonjade Descent (and its Yuegui)
    s.burstTok = undefined
  },
}
