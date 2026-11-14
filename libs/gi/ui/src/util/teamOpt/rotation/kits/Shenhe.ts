import type {
  ActionResult,
  KitModel,
  SimContext,
  SimCountedBuff,
  SimHit,
} from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/shenhe, main as of 2026-11-10. */

/** The normal attack string (gcsim's attackHitmarks and attackFrames) */
const shenheNormals: NormalHit[] = [
  {
    hitmarks: [14],
    hitlag: [5],
    toNormal: 23,
    toCharged: 22,
    toAbil: 14,
    frames: 23,
  },
  {
    hitmarks: [17],
    hitlag: [5],
    toNormal: 17,
    toCharged: 29,
    toAbil: 17,
    frames: 29,
  },
  {
    hitmarks: [19],
    hitlag: [5],
    toNormal: 32,
    toCharged: 33,
    toAbil: 19,
    frames: 33,
  },
  {
    hitmarks: [14, 18],
    hitlag: [0, 5],
    toNormal: 25,
    toCharged: 27,
    toAbil: 18,
    frames: 27,
  },
  {
    hitmarks: [26],
    hitlag: [10],
    toNormal: 49,
    toCharged: 49,
    toAbil: 26,
    frames: 49,
  },
]

/** Burst DoT ticks' offsets (gcsim's burstTickOffset) */
const burstTickOffset = [0, 2, 4, 0, 2, 4, 0, 2, 4]

interface QuillState {
  /** The last press or hold's Icy Quill: from `start` to `until` (frames), `stacks` for each member */
  start: number
  until: number
  stacks: number
  /** The stacks each member has used since then */
  used: Record<string, number>
  /** C4: Skyfrost Mantra stacks, and until when they last (60 s from the last gain) */
  mantra: number
  mantraUntil: number
}

interface ShenheState {
  quill: QuillState
  /** When each skill charge being recharged is back (frames, in order) */
  recharge: number[]
}

const freshQuill = (): QuillState => ({
  start: -1,
  until: -1,
  stacks: 0,
  used: {},
  mantra: 0,
  mantraUntil: -1,
})

/**
 * Icy Quill, hit by hit: a press or hold sets it (from one frame before its own hit, so the
 * hit itself is under it). A Cryo hit of a member under it gets the bonus while that member has
 * stacks: burst, skill, plunge (and normal and charged, which don't use a stack from C6) use one.
 * Each boosted hit is a C4 Skyfrost Mantra stack. Returns whether the hit is boosted.
 */
function quillHit(q: QuillState, hit: SimHit, c: number): boolean {
  if (
    hit.characterKey === 'Shenhe' &&
    hit.path[0] === 'skill' &&
    (hit.path[1] === 'press' || hit.path[1] === 'hold')
  ) {
    const press = hit.path[1] === 'press'
    q.start = hit.t - 1
    q.until = q.start + (press ? 600 : 900)
    q.stacks = press ? 5 : 7
    q.used = {}
  }
  if (hit.element !== 'cryo' || hit.t < q.start || hit.t >= q.until)
    return false
  const used = q.used[hit.characterKey] ?? 0
  if (used >= q.stacks) return false
  let useStack: boolean
  switch (hit.tag) {
    case 'burst':
    case 'skill':
    case 'plunge':
      useStack = true
      break
    case 'normal':
    case 'charged':
      useStack = c < 6
      break
    default:
      return false
  }
  if (useStack) q.used[hit.characterKey] = used + 1
  if (c >= 4) {
    if (hit.t >= q.mantraUntil) q.mantra = 0
    q.mantra = Math.min(50, q.mantra + 1)
    q.mantraUntil = hit.t + 3600
  }
  return true
}

/**
 * The skill's charges (C1: 2, each recharged in turn): the frames until the next skill can
 * start, after a skill that spends one with `cd` frames of recharge, starting `delay` in
 */
function spendCharge(
  ctx: SimContext,
  s: ShenheState,
  cd: number,
  delay: number
): number {
  const max = ctx.constellation('Shenhe') >= 1 ? 2 : 1
  s.recharge = s.recharge.filter((t) => t > ctx.now)
  const last = s.recharge.length ? s.recharge[s.recharge.length - 1] : ctx.now
  s.recharge.push(Math.max(ctx.now + delay, last) + cd)
  return s.recharge.length < max ? 0 : s.recharge[0] - ctx.now
}

/** C4: the Skyfrost Mantra stacks go into this skill's DMG (consumed as it lands) */
function mantraBonus(ctx: SimContext, s: ShenheState, landsAt: number) {
  const stacks = s.quill.mantraUntil > ctx.now ? s.quill.mantra : 0
  s.quill.mantra = 0
  s.quill.mantraUntil = -1
  if (ctx.constellation('Shenhe') >= 4 && stacks > 0)
    ctx.buff('Shenhe', ['Shenhe', 'c4'], `${stacks}`, landsAt, 1)
}

function press(ctx: SimContext, s: ShenheState): ActionResult {
  ctx.hit(4, {
    path: ['skill', 'press'],
    tag: 'skill',
    element: 'cryo',
    applies: true,
    label: 'Spring Spirit Summoning (press)',
  })
  mantraBonus(ctx, s, 4)
  // A4: the team's Skill and Burst DMG, 10 s from the quill (3 frames in)
  ctx.buff('Shenhe', ['Shenhe', 'asc4'], 'press', 3, 600)
  return {
    cooldown: { key: 'skill', frames: spendCharge(ctx, s, 600, 2) },
    frames: 38,
    framesInto: {
      normal: 27,
      skill: 27,
      burst: 27,
      dash: 21,
      jump: 21,
      swap: 27,
    },
  }
}

function hold(ctx: SimContext, s: ShenheState): ActionResult {
  ctx.hit(33, {
    path: ['skill', 'hold'],
    tag: 'skill',
    element: 'cryo',
    applies: true,
    durability: 50,
    label: 'Spring Spirit Summoning (hold)',
  })
  mantraBonus(ctx, s, 33)
  // A4: the team's Normal, Charged and Plunging DMG, 15 s from the quill (32 frames in)
  ctx.buff('Shenhe', ['Shenhe', 'asc4Hold'], 'hold', 32, 900)
  return {
    cooldown: { key: 'skill', frames: spendCharge(ctx, s, 900, 32) },
    frames: 78,
    framesInto: {
      normal: 45,
      skill: 45,
      burst: 45,
      dash: 38,
      jump: 39,
      swap: 44,
    },
  }
}

export const kit: KitModel = {
  characterKey: 'Shenhe',
  element: 'cryo',
  source: `${GCSIM}/shenhe`,
  init: (): ShenheState => ({ quill: freshQuill(), recharge: [] }),
  act(ctx, s: ShenheState, action, previous) {
    ctx.note(
      'Shenhe: the burst field is assumed to cover the active member (A1, C2 and the RES shred).'
    )
    const c = ctx.constellation('Shenhe')
    switch (action.kind) {
      case 'normal':
        return normalString(
          shenheNormals,
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
      case 'charged':
        ctx.hit(25, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 81,
          framesInto: {
            normal: 48,
            skill: 49,
            burst: 49,
            dash: 25,
            jump: 25,
            swap: 46,
          },
        }
      case 'skill':
        return action.hold ? hold(ctx, s) : press(ctx, s)
      case 'burst': {
        ctx.hit(78, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          label: "Divine Maiden's Deliverance",
        })
        // the DoT: 6 ticks of 2 hits (9 at C2), from 82 frames into the field (47 frames in)
        // (gcsim snapshots the DoT when the field appears)
        const ticks = c >= 2 ? 9 : 6
        // (its snapshot task runs before the field's first A1 tick on that frame)
        const snapshot = { t: ctx.now + 46, onField: ctx.onField }
        for (let i = 0; i < ticks; i++)
          for (let j = 0; j < 2; j++)
            ctx.hit(129 + 117 * i + j * (30 + burstTickOffset[i]), {
              path: ['burst', 'dot'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              icd: 'burst',
              label: "Divine Maiden's Deliverance (DoT)",
              statSnapshots: [
                { stat: 'atk', path: ['total', 'atk'], ...snapshot },
                {
                  stat: 'cryo_dmg_',
                  path: ['total', 'cryo_dmg_'],
                  ...snapshot,
                },
              ],
            })
        // the field: 12 s (18 s at C2), its RES shred and A1 (C2 and A1 use the same field state),
        // refreshed for 0.6 s every 18 frames while it lasts: up to 0.6 s after its last check
        const duration = c >= 2 ? 1080 : 720
        const covered = 18 * Math.floor((duration - 1) / 18) + 36
        ctx.buff('Shenhe', ['Shenhe', 'burst'], 'burst', 47, covered)
        ctx.buff('Shenhe', ['Shenhe', 'asc1'], 'field', 47, covered)
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 100,
          framesInto: { normal: 99, dash: 78, jump: 79, swap: 98 },
        }
      }
      case 'dash':
        // the template's dash (Lady body)
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // the template's jump (Lady body): longer right after a dash
        return templateJump('lady', 'polearm', previous, ctx)
      default:
        // gcsim has no plunge for Shenhe: no damage
        return { frames: 30 }
    }
  },
  onHit(ctx, s: ShenheState, hit) {
    quillHit(s.quill, hit, ctx.constellation('Shenhe'))
  },
  // Icy Quill's bonus is a hit count (each member's stacks): the hits it boosts
  countedBuffs(hits, c) {
    const q = freshQuill()
    const covered = new Set<number>()
    hits.forEach((hit, i) => {
      if (quillHit(q, hit, c)) covered.add(i)
    })
    const buffs: SimCountedBuff[] = [
      {
        owner: 'Shenhe',
        path: ['Shenhe', 'quill'],
        value: 'quill',
        hits: covered,
      },
    ]
    return { buffs, extraHits: [] }
  },
}
