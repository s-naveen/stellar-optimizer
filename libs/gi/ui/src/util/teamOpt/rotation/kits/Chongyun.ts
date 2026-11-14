import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/chongyun, main as of 2026-11-10. */

const chongyunNormals: NormalHit[] = [
  {
    hitmarks: [26],
    hitlag: [10],
    toNormal: 30,
    toCharged: 30,
    toAbil: 26,
    frames: 30,
  },
  {
    hitmarks: [24],
    hitlag: [9],
    toNormal: 36,
    toCharged: 36,
    toAbil: 24,
    frames: 36,
  },
  {
    hitmarks: [41],
    hitlag: [11],
    toNormal: 57,
    toCharged: 57,
    toAbil: 41,
    frames: 57,
  },
  {
    hitmarks: [53],
    hitlag: [11],
    toNormal: 101,
    toCharged: 101,
    toAbil: 53,
    frames: 101,
  },
]

interface ChongyunState {
  /** Cast frame of the latest Layered Frost: an older field's expiry blade does not fire */
  src?: number
  /** The latest field: it appears at fieldStart and lasts until fieldEnd */
  fieldStart: number
  fieldEnd: number
  linger: number
  snapshot?: { t: number; onField: CharacterKey }
  enemyDamage: number
  enemyHit: boolean
}

function infuseField(ctx: SimContext, member: CharacterKey, duration: number) {
  if (ctx.constellation('Chongyun') >= 2)
    ctx.modifyCooldown('Chongyun', -0.15, duration, member)
  if (
    !['sword', 'claymore', 'polearm'].includes(getCharStat(member).weaponType)
  )
    return
  ctx.infuse('cryo', 0, duration, member)
  ctx.modifyAttackSpeed('Chongyun', 0.08, duration, member)
  ctx.buff('Chongyun', ['Chongyun', 'skill'], 'activeInArea', 0, duration, {
    recipient: member,
    hitlag: 'recipient',
  })
}

/** Layered Frost's A4 blade (on the field's expiry), with its Cryo RES -10% for 8 s */
const a4Blade = (c: SimContext, snapshot?: ChongyunState['snapshot']) => {
  c.hit(0, {
    path: ['passive2', 'dmg'],
    tag: 'skill',
    element: 'cryo',
    applies: true,
    durability: 25,
    icd: 'none',
    label: 'Spirit Blade (A4, field expiry)',
    blunt: true,
    poiseDamage: 100,
    states: [
      {
        owner: 'Chongyun',
        path: ['Chongyun', 'asc4'],
        value: c.hasBuff('Chongyun', ['Chongyun', 'asc4']) ? 'hit' : '',
      },
    ],
    statSnapshots: snapshot
      ? [{ stat: 'atk', path: ['total', 'atk'], ...snapshot }]
      : undefined,
  })
  c.buff('Chongyun', ['Chongyun', 'asc4'], 'hit', 0, 480, { hitlag: 'enemy' })
}

export const kit: KitModel = {
  characterKey: 'Chongyun',
  element: 'cryo',
  source: `${GCSIM}/chongyun`,
  init: (): ChongyunState => ({
    fieldStart: -1e9,
    fieldEnd: -1e9,
    linger: 180,
    enemyDamage: 0,
    enemyHit: false,
  }),
  onStart(ctx) {
    if (ctx.constellation('Chongyun') >= 6 && !ctx.damageTracked)
      ctx.note(
        'Chongyun C6: without damage evaluation, assumes full health and an enemy damaged by the first hit. Enemy HP thresholds require the damage evaluator.'
      )
  },
  onBeforeHit(ctx, s: ChongyunState, hit) {
    if (ctx.constellation('Chongyun') < 6) return
    if (hit.path[0].startsWith('_')) return
    if (hit.characterKey === 'Chongyun' && hit.tag === 'burst') {
      // Expected damage gives an expected enemy HP timeline. The default target
      // matches the fixed-build reference; outcomes close to this threshold
      // still require a joint HP/crit distribution rather than a mean.
      const enemyRatio = ctx.damageTracked
        ? Math.max(0, 1 - s.enemyDamage / (ctx.target.maxHp ?? 999999999))
        : s.enemyHit
          ? 1 - Number.EPSILON
          : 1
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'Chongyun',
          path: ['Chongyun', 'c6'],
          value: enemyRatio < (ctx.hpRatio('Chongyun') ?? 1) ? 'on' : '',
        },
      ]
    }
    s.enemyHit = true
  },
  observesDamage: (ctx) => ctx.constellation('Chongyun') >= 6,
  onDamage(_ctx, s: ChongyunState, _hit, outcomes) {
    s.enemyDamage += (outcomes ?? []).reduce(
      (sum, o) => sum + o.damage * o.probability,
      0
    )
  },
  onPartySwap(ctx, s: ChongyunState, _from, to) {
    if (ctx.now >= s.fieldStart && ctx.now < s.fieldEnd)
      infuseField(ctx, to, s.linger)
  },
  act(ctx, s: ChongyunState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          chongyunNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
              blunt: true,
              poiseDamage: [105, 95, 121, 152][i],
            })
            // C1: the 4th hit also summons 3 Cryo blades (50% ATK each), 5 frames apart
            if (i === 3 && ctx.constellation('Chongyun') >= 1)
              for (let b = 0; b < 3; b++)
                ctx.hit(d + 5 * b, {
                  path: ['constellation1', 'dmg'],
                  tag: 'other',
                  element: 'cryo',
                  applies: true,
                  icd: 'none',
                  label: `C1 Spirit Blade ${b + 1}`,
                })
          },
          ctx
        )
      case 'charged':
        // gcsim has no charged attack for Chongyun (its ChargeAttack is not implemented)
        ctx.note(
          'Chongyun: the charged attack is not in gcsim (not modelled: no damage, default frames).'
        )
        return { frames: 30 }
      case 'skill': {
        const src = ctx.now
        // the previous field is still up: it expires now, its blade lands 45 frames after this
        // cast's hitmark (gcsim's A4 replacement), and the older expiry task is dropped
        const fieldUp = ctx.now >= s.fieldStart && ctx.now < s.fieldEnd
        const previousSnapshot = s.snapshot
        const snapshot = { t: ctx.now, onField: ctx.onField }
        s.snapshot = snapshot
        s.src = src
        if (fieldUp)
          ctx.at(36 + 45, (at) => {
            if (s.src === src) a4Blade(at, previousSnapshot)
          })
        // Spirit Blade: Chonghua's Layered Frost (hitmark 36, Cryo, Durability 50)
        ctx.hit(36, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'skill',
          label: "Spirit Blade: Chonghua's Layered Frost",
          blunt: true,
          poiseDamage: 150,
          statSnapshots: [{ stat: 'atk', path: ['total', 'atk'], ...snapshot }],
        })
        const index =
          ctx.calculate('Chongyun', ['total', 'skillIndex']) ??
          (ctx.constellation('Chongyun') >= 5 ? 12 : 9)
        s.linger = Math.trunc(60 * Math.min(3, 2 + index / 10))
        ctx.atCharacter('Chongyun', 36, (at) => {
          if (s.src !== src) return
          s.fieldStart = at.now
          s.fieldEnd = at.now + 600
        })
        for (let delay = 36; delay <= 636; delay += 60)
          ctx.at(delay, (at) => {
            if (s.src === src) infuseField(at, at.onField, s.linger)
          })
        ctx.hit(36, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 6,
          label: 'Layered Frost hitlag',
        })
        // its expiry (655 frames after the cast) brings the A4 blade, if still the latest field
        ctx.at(655, (c) => {
          if (s.src === src) a4Blade(c, snapshot)
        })
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 900, delay: 34 },
            frames: 52,
            framesInto: { burst: 51, dash: 35, jump: 35, swap: 49 },
          },
          { hitmarks: [36], hitlag: [6] }
        )
      }
      case 'burst': {
        // Spirit Blade: Cloud-Parting Star (3 blades, + a 4th at C6), Cryo, ICD none
        for (const delay of [50, 59, 67])
          ctx.hit(delay, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Spirit Blade (Cloud-Parting Star)',
            blunt: true,
            poiseDamage: 100,
          })
        // C6 adds a fourth blade. Its HP-dependent bonus is checked on impact.
        if (ctx.constellation('Chongyun') >= 6)
          ctx.hit(77, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Spirit Blade (C6)',
            blunt: true,
            poiseDamage: 100,
          })
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 79,
          framesInto: { normal: 64, skill: 64, dash: 64, jump: 66 },
        }
      }
      case 'plunge':
        // gcsim's plunges need the team airborne (Xianyun's burst): assumed here; a high plunge
        ctx.note(
          "Chongyun: a plunge needs the team airborne (Xianyun's burst), assumed; modelled as a High Plunge."
        )
        // (gcsim's optional collision hit, a plunge parameter, is not modelled)
        ctx.hit(47, {
          path: ['plunging', 'high'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'High Plunge',
        })
        return {
          frames: 87,
          framesInto: { normal: 58, skill: 59, burst: 58, dash: 47, swap: 71 },
        }
      case 'dash':
        // Boy body: a 21-frame dash, which can jump after 2 frames
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // Boy body: 31 frames, 34 after a dash
        return templateJump('boy', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
