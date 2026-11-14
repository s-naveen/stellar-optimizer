import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { KitModel, SimContext } from '../types'
import {
  KQMSIM,
  kitFramesInto,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/prune, main as of 2026-11-10. */

// Hitmarks are damage frames (no travel)
const pruneNormals: NormalHit[] = [
  {
    hitmarks: [19],
    hitlag: [6],
    toNormal: 23,
    toCharged: 47,
    toAbil: 19,
    frames: 47,
  },
  {
    hitmarks: [24],
    hitlag: [6],
    toNormal: 49,
    toCharged: 50,
    toAbil: 24,
    frames: 54,
  },
  {
    hitmarks: [42],
    hitlag: [6],
    toNormal: 63,
    toCharged: 84,
    toAbil: 42,
    frames: 84,
  },
]

/** The convert window: 364 frames from the swirl (assumed on Ring-A-Ding-Ding's hit, frame 26) */
const convertFrames = 364

interface PruneState {
  a1Ready: number
  c4Ready: number
  rally: Map<CharacterKey, object>
  rallySnapshot?: { t: number; onField: CharacterKey }
  convertEle?: 'pyro' | 'hydro' | 'electro' | 'cryo'
  recastToken: number
  hexToken: number
  c6Token: number
  c6Active: boolean
  burstEnd: number
  c2Stacks: number

  /** The convert window is open until this frame */
  recastUntil: number
  /** Swapped out since the last action */
  away: boolean
}

function rally(c: SimContext, s: PruneState) {
  s.rallySnapshot = { t: c.now, onField: c.onField }
  c.buff('Prune', ['Prune', 'a4Rally'], 'on', 0, 300, { hitlag: 'recipient' })
  for (const member of c.members.filter((m) => m !== 'Prune')) {
    const token = {}
    s.rally.set(member, token)
    c.atCharacter(member, 300, () => {
      if (s.rally.get(member) === token) s.rally.delete(member)
    })
  }
}
function c6(c: SimContext, s: PruneState) {
  const token = ++s.c6Token
  s.c6Active = true
  c.state('Prune', ['Prune', 'c6RallyReaction'], 'on')
  c.atCharacter('Prune', 330, (at) => {
    if (s.c6Token === token) {
      s.c6Active = false
      at.state('Prune', ['Prune', 'c6RallyReaction'], '')
    }
  })
  const poll = (at: SimContext) => {
    if (s.c6Token !== token) return
    for (const member of at.members.filter((m) => m !== 'Prune'))
      at.buff(
        'Prune',
        ['Prune', 'c6Recipient'],
        s.c6Active && member === at.onField && s.rally.has(member) ? 'on' : '',
        0,
        30,
        { recipient: member }
      )
    if (s.c6Active) at.at(30, poll)
  }
  poll(c)
}

export const kit: KitModel = {
  characterKey: 'Prune',
  element: 'anemo',
  source: `${KQMSIM}/prune`,
  init: (): PruneState => ({
    a1Ready: -1,
    c4Ready: -1,
    rally: new Map(),
    recastToken: 0,
    hexToken: 0,
    c6Token: 0,
    c6Active: false,
    burstEnd: -1,
    c2Stacks: 0,
    recastUntil: -1,
    away: false,
  }),
  onStart(ctx) {
    ctx.state('Prune', ['Prune', 'timeline'], 'on')
    ctx.state('Prune', ['Prune', 'c6Recipient'], '')
    ctx.state('Prune', ['Prune', 'hexRecipient'], '')
    ctx.note('Prune: energy refunds and multiple enemies are not validated.')
  },
  onHit(ctx, s: PruneState, hit) {
    if (hit.path[0] === '_reaction') {
      const reaction = hit.path[1]
      const swirl = reaction.endsWith('Swirl')
      if (
        hit.characterKey === 'Prune' &&
        swirl &&
        hit.reactionSource?.label === 'Witchlure Bell' &&
        ctx.now >= s.a1Ready
      ) {
        s.a1Ready = ctx.now + 72
        const ele =
          reaction === 'stellarSwirl'
            ? 'cryo'
            : (reaction.slice(0, -5) as 'pyro' | 'hydro' | 'electro' | 'cryo')
        ctx.hit(45, {
          path: ['passive1', `${ele}Dmg`],
          tag: 'burst',
          element: ele,
          applies: false,
          blunt: true,
          poiseDamage: 20,
          label: 'Banehunter Oathhammer (A1)',
        })
      }
      if (
        hit.characterKey === 'Prune' &&
        swirl &&
        hit.reactionSource?.label === 'Ring-A-Ding-Ding!' &&
        !s.convertEle
      ) {
        s.convertEle =
          reaction === 'stellarSwirl'
            ? 'cryo'
            : (reaction.slice(0, -5) as NonNullable<PruneState['convertEle']>)
        s.recastUntil = ctx.now + convertFrames + 2
        const token = ++s.recastToken
        ctx.atCharacter('Prune', convertFrames + 2, () => {
          if (s.recastToken === token) s.recastUntil = -1
        })
      }
      if (s.rally.has(hit.characterKey)) {
        if (ctx.constellation('Prune') >= 6) c6(ctx, s)
        if (
          HEXEREI_CHARACTERS.includes(hit.characterKey) &&
          ctx.members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2
        ) {
          ctx.state('Prune', ['Prune', 'lockRallyReaction'], 'on')
          const token = ++s.hexToken
          ctx.atCharacter('Prune', 300, (at) => {
            if (s.hexToken === token)
              at.state('Prune', ['Prune', 'lockRallyReaction'], '')
          })
          // Native's Hexerei team bonus only follows ordinary Swirl events.
          if (swirl && reaction !== 'stellarSwirl')
            ctx.buff('Prune', ['Prune', 'hexRecipient'], 'on', 0, 300, {
              recipient: hit.characterKey,
              hitlag: 'recipient',
            })
        }
      }
      return
    }
    if (
      s.rally.has(hit.characterKey) &&
      s.rallySnapshot &&
      ['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag)
    ) {
      const move = hit.tag === 'plunge' ? 'plunging' : hit.tag
      hit.statSnapshots = [
        ...(hit.statSnapshots ?? []),
        {
          characterKey: 'Prune',
          stat: `${move}_dmg_` as 'skill_dmg_',
          path: ['display', 'passive2', `${move}_dmg_`],
          ...s.rallySnapshot,
        },
      ]
    }
    if (hit.characterKey !== 'Prune') return
    const hammer =
      ['passive1', 'constellation4'].includes(hit.path[0]) ||
      hit.label === 'Clang Clang! Witch-tribution Comes!'
    if (!hammer && hit.label !== 'Witchlure Bell') return
    if (hammer) rally(ctx, s)
    if (ctx.constellation('Prune') >= 2 && ctx.now < s.burstEnd) {
      s.c2Stacks = Math.min(6, s.c2Stacks + 1)
      const count = s.c2Stacks
      ctx.at(1, (c) =>
        c.buff(
          'Prune',
          ['Prune', 'c2Stack'],
          String(count),
          0,
          Math.max(0, s.burstEnd - c.now),
          { hitlag: 'recipient' }
        )
      )
    }
    if (
      (hit.path[0] === 'passive1' ||
        hit.label === 'Clang Clang! Witch-tribution Comes!') &&
      ctx.constellation('Prune') >= 4 &&
      ctx.now >= s.c4Ready
    ) {
      s.c4Ready = ctx.now + 6
      ctx.hit(63, {
        path: ['constellation4', `${hit.element}Dmg`],
        tag: hit.tag,
        element: hit.element,
        applies: false,
        blunt: true,
        poiseDamage: 15,
        label: 'Banehunter Oathhammer Ricochet (C4)',
        statSnapshots: [
          {
            stat: 'atk',
            path: ['total', 'atk'],
            t: ctx.now,
            onField: ctx.onField,
          },
          {
            stat: 'critRate_',
            path: ['premod', 'critRate_'],
            t: ctx.now,
            onField: ctx.onField,
          },
          {
            stat: 'critDMG_',
            path: ['premod', 'critDMG_'],
            t: ctx.now,
            onField: ctx.onField,
          },
        ],
      })
    }
  },
  // For 6 s after her E swirls an element, E is Clang Clang! Witch-tribution Comes! (its own frames)
  variant(ctx, s: PruneState, action) {
    return action.kind === 'skill' && ctx.now < s.recastUntil && s.convertEle
      ? { key: 'clang', label: 'Clang Clang! Witch-tribution Comes!' }
      : undefined
  },
  act(ctx, s: PruneState, action, previous) {
    const swapped = s.away
    s.away = false
    switch (action.kind) {
      case 'normal':
        return normalString(
          pruneNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'anemo',
              applies: true,
              icd: 'normal',
              blunt: true,
              poiseDamage: [54.7, 54.3, 76.5][i],
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // the Charged Attack has 10 frames of windup, unless it follows a swap (or starts the rotation)
        const windup = previous && !swapped ? 10 : 0
        ctx.hit(46 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: 'Charge Attack',
        })
        return {
          frames: 116 - windup,
          framesInto: {
            normal: 96 - windup,
            charged: 97 - windup,
            skill: 97 - windup,
            burst: 97 - windup,
            dash: 46 - windup,
            jump: 46 - windup,
            swap: 95 - windup,
          },
        }
      }
      case 'skill': {
        if (ctx.now < s.recastUntil && s.convertEle) {
          const ele = s.convertEle
          s.recastUntil = -1
          s.recastToken++
          ctx.hit(30, {
            path: ['skill', `clang${ele}Dmg`],
            tag: 'skill',
            element: ele,
            applies: true,
            icd: 'none',
            blunt: true,
            poiseDamage: 75,
            label: 'Clang Clang! Witch-tribution Comes!',
          })
          ctx.hit(30, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 7,
            label: 'Prune convert hitlag',
          })
          return withHitlag(
            {
              frames: 82,
              framesInto: {
                normal: 65,
                charged: 76,
                skill: 69,
                burst: 67,
                dash: 67,
                jump: 66,
                swap: 65,
                wait: 30,
              },
            },
            { hitmarks: [30], hitlag: [7] }
          )
        }
        s.convertEle = undefined
        ctx.hit(26, {
          path: ['skill', 'ringDmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 25,
          label: 'Ring-A-Ding-Ding!',
        })
        ctx.hit(26, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 2,
          label: 'Prune skill hitlag',
        })
        const result = withHitlag(
          {
            cooldown: { key: 'skill', frames: 900, delay: 25 },
            frames: 59,
            // the next E is the convert when a swirl happened: its cancel is at 28 frames
            framesInto: {
              normal: 56,
              skill: 28,
              burst: 28,
              dash: 28,
              jump: 29,
              swap: 27,
              // gcsim's CanQueueAfter (the swap cancel): where a written wait starts
              wait: 27,
            },
          },
          { hitmarks: [26], hitlag: [2] }
        )
        return {
          ...result,
          duration: (next) =>
            next === 'skill' && !s.convertEle
              ? 43
              : kitFramesInto(result, next),
        }
      }
      case 'burst': {
        ctx.hit(34, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 25,
          label: 'The Bell Tolls! The Hunt Is On!',
        })
        // Witchlure Bell: from 137 frames, every 117 frames while the burst lasts (813 frames; C6 +240)
        const end = ctx.now + (ctx.constellation('Prune') >= 6 ? 1053 : 813)
        s.burstEnd = end
        s.c2Stacks = 0
        ctx.buff('Prune', ['Prune', 'c2Stack'], '0', 57, end - ctx.now - 57, {
          hitlag: 'recipient',
        })
        const bell = (c: SimContext) => {
          if (c.now >= end) return
          c.hit(0, {
            path: ['burst', 'bellDmg'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            durability: 25,
            label: 'Witchlure Bell',
          })
          c.at(117, bell)
        }
        ctx.at(137, bell)
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 82,
          framesInto: { normal: 73, skill: 72, dash: 74, jump: 73, swap: 71 },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('loli', 'catalyst', previous, ctx)
      case 'plunge':
        // not in gcsim (no plunge frames): not modelled
        ctx.note('Prune: the plunge is not in gcsim; not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: PruneState, action, now) =>
    action.kind === 'skill'
      ? now < s.recastUntil
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(_ctx, s: PruneState) {
    s.away = true
  },
  onHitlag(ctx, s: PruneState, frames) {
    if (ctx.now < s.recastUntil) s.recastUntil += frames
  },
}
