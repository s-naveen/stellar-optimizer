import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/rosaria, main as of 2026-11-10. */

const rosariaNormals: NormalHit[] = [
  {
    hitmarks: [9],
    hitlag: [8],
    toNormal: 19,
    toCharged: 24,
    toAbil: 9,
    frames: 24,
  },
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 23,
    toCharged: 27,
    toAbil: 13,
    frames: 27,
  },
  {
    hitmarks: [19, 28],
    hitlag: [0, 6],
    toNormal: 31,
    toCharged: 34,
    toAbil: 28,
    frames: 34,
  },
  {
    hitmarks: [32],
    hitlag: [9],
    toNormal: 44,
    toCharged: 52,
    toAbil: 32,
    frames: 52,
  },
  {
    hitmarks: [26, 40],
    hitlag: [4, 8],
    toNormal: 66,
    toCharged: 66,
    toAbil: 40,
    frames: 66,
  },
]

/** C1's buff: 4 s on Rosaria's clock (gcsim's NewBaseWithHitlag) */
const C1_DURATION = 240
/** Her hits whose CRIT triggers C1 (gcsim's c1CB: normal, charged, skill and burst hits) */
const C1_TAGS = new Set(['normal', 'charged', 'skill', 'burst'])

interface RosariaState {
  particleReady: number
  /** C1's ATK SPD ends (world frame, ignoring later hitlag) */
  c1End: number
  a4Snapshot?: { t: number; onField: SimContext['onField'] }
  a4Ends: Map<CharacterKey, number>
}

export const kit: KitModel = {
  characterKey: 'Rosaria',
  element: 'cryo',
  source: `${GCSIM}/rosaria`,
  init: (): RosariaState => ({
    particleReady: -1,
    c1End: -1,
    a4Ends: new Map(),
  }),
  act(ctx, s: RosariaState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // C1 (assumed: a CRIT on her first hit, as her CRIT Rate makes likely): the following normal
        // states start with +10% ATK SPD (gcsim adds it only while already in a normal attack)
        const c1 = ctx.constellation('Rosaria') >= 1
        let stepStart = 0
        let trigger = Number.POSITIVE_INFINITY
        const speedCtx: SimContext = c1
          ? {
              ...ctx,
              normalAttackSpeed: (continuing) => {
                const at = ctx.now + stepStart
                const on =
                  at < s.c1End || (trigger <= at && at < trigger + C1_DURATION)
                return (
                  ctx.normalAttackSpeed(continuing) +
                  (continuing && on ? 0.1 : 0)
                )
              },
            }
          : ctx
        return normalString(
          rosariaNormals,
          action.count ?? 1,
          (i, d, j) => {
            if (j === 0) stepStart = d - rosariaNormals[i].hitmarks[0]
            trigger = Math.min(trigger, ctx.now + d)
            // the third string's two hits share one node; the fifth's two hits have one each
            const node = i === 4 ? (j ? '5' : '4') : `${i}`
            ctx.hit(d, {
              path: ['normal', node],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            })
          },
          speedCtx
        )
      }
      case 'charged':
        ctx.hit(22, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'charged',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 69,
          framesInto: { dash: 22, jump: 22, swap: 66 },
        }
      case 'skill': {
        ctx.hit(24, {
          path: ['skill', 'hit1'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          label: 'Ravaging Confession (1)',
          states: [
            {
              owner: 'Rosaria',
              path: ['Rosaria', 'RosariaA1'],
              value: ctx.hasBuff('Rosaria', ['Rosaria', 'RosariaA1'])
                ? 'on'
                : '',
            },
          ],
        })
        ctx.hit(42, {
          path: ['skill', 'hit2'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          label: 'Ravaging Confession (2)',
        })
        // A1: the first hit from behind (assumed): CRIT Rate +12% for 5 s
        ctx.buff('Rosaria', ['Rosaria', 'RosariaA1'], 'on', 24, 300, {
          hitlag: 'recipient',
        })
        for (const [t, pause] of [
          [24, 4],
          [42, 9],
        ])
          ctx.hit(t, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: pause,
            label: 'Rosaria skill hitlag',
          })
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 360, delay: 23 },
            frames: 51,
            // (a wait starts at the earliest cancel, gcsim's CanQueueAfter)
            framesInto: { dash: 38, jump: 40, swap: 50, wait: 38 },
          },
          { hitmarks: [24, 38], hitlag: [4, 9] }
        )
      }
      case 'burst': {
        ctx.hit(15, {
          path: ['burst', 'hit1'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          label: 'Rites of Termination (1)',
        })
        ctx.atCharacter('Rosaria', 56, (at) =>
          at.hit(0, {
            path: ['burst', 'hit2'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            label: 'Rites of Termination (2)',
          })
        )
        ctx.hit(15, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          label: 'Rosaria burst hitlag',
        })
        // the Ice Lance's blasts: every 2 s, from its landing (56 frames), for 8 s (+4 s at C2)
        const c = ctx.constellation('Rosaria')
        const dur = c >= 2 ? 750 : 510
        ctx.atCharacter('Rosaria', 56, (at) => {
          const snapshot = { t: at.now, onField: at.onField }
          for (let i = 120; i < dur; i += 120)
            at.hit(i, {
              path: ['burst', 'dotDmg'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              label: 'Rites of Termination (DoT)',
              statSnapshots: [
                { stat: 'atk', path: ['total', 'atk'], ...snapshot },
                {
                  stat: 'critRate_',
                  path: ['display', 'passive1', 'critRate'],
                  ...snapshot,
                },
              ],
            })
        })
        // A4: the party's CRIT Rate for 10 s (assumed ascended)
        s.a4Snapshot = { t: ctx.now, onField: ctx.onField }
        for (const member of ctx.members)
          if (member !== 'Rosaria')
            s.a4Ends.set(member, ctx.characterFrame(member) + 600)
        ctx.buff('Rosaria', ['Rosaria', 'RosariaA4'], 'on', 0, 600, {
          hitlag: 'recipient',
        })
        // (C6's Physical RES shred is applied by each Rites hit: see onHit)
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 70,
            framesInto: { dash: 57, jump: 59, swap: 69 },
          },
          { hitmarks: [15], hitlag: [4] }
        )
      }
      case 'plunge':
        // gcsim's Low Plunge (it only allows plunges in its Xianyun-airborne state; modelled as a plain one)
        ctx.hit(42, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 78,
          framesInto: { normal: 59, skill: 60, burst: 59, dash: 77, swap: 66 },
        }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // the template's jump (Lady body): longer right after a dash
        return templateJump('lady', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: RosariaState, hit) {
    if (hit.characterKey === 'Rosaria' && !hit.path[0].startsWith('_')) {
      const c = ctx.constellation('Rosaria')
      // C1 (a CRIT Hit assumed; gcsim: only while she is on the field): ATK SPD and Normal Attack
      // DMG +10% for 4 s, from after this hit (gcsim's attack callback)
      if (c >= 1 && C1_TAGS.has(hit.tag) && ctx.onField === 'Rosaria') {
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: 'Rosaria',
            path: ['Rosaria', 'RosariaC1'],
            value: ctx.hasBuff('Rosaria', ['Rosaria', 'RosariaC1']) ? 'on' : '',
          },
        ]
        ctx.buff('Rosaria', ['Rosaria', 'RosariaC1'], 'on', 0, C1_DURATION, {
          hitlag: 'recipient',
        })
        s.c1End = ctx.now + C1_DURATION
      }
      // C6: every Rites of Termination hit lowers the enemy's Physical RES by 20% for 10 s
      if (c >= 6 && hit.tag === 'burst') {
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: 'Rosaria',
            path: ['Rosaria', 'DilucC6'],
            value: ctx.hasBuff('Rosaria', ['Rosaria', 'DilucC6']) ? 'on' : '',
          },
        ]
        ctx.buff('Rosaria', ['Rosaria', 'DilucC6'], 'on', 0, 600, {
          hitlag: 'enemy',
        })
      }
    }
    if (!hit.path[0].startsWith('_') && s.a4Snapshot)
      for (const recipient of hit.contributors ?? [hit.characterKey]) {
        if (
          recipient === 'Rosaria' ||
          ctx.characterFrame(recipient) >= (s.a4Ends.get(recipient) ?? -1)
        )
          continue
        hit.statSnapshots = [
          ...(hit.statSnapshots ?? []),
          {
            characterKey: 'Rosaria',
            recipient,
            stat: 'critRate_',
            path: ['display', 'passive2', 'nodeA4OptTarget'],
            ...s.a4Snapshot,
          },
        ]
      }
    if (
      hit.characterKey !== 'Rosaria' ||
      hit.tag !== 'skill' ||
      ctx.now < s.particleReady
    )
      return
    s.particleReady = ctx.now + 36
    ctx.hit(100, {
      path: ['_particle', 'cryo'],
      tag: 'other',
      element: 'cryo',
      weight: 3,
      label: 'Ravaging Confession (particles)',
    })
  },
}
