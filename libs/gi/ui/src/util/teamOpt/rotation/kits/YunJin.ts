import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext, SimCountedBuff, SimHit } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yunjin, main as of 2026-11-10. */

/** Normal attacks: hitmarks per hit instance (N3 and N4 hit twice); the cancels from the last one */
const yunjinNormals: NormalHit[] = [
  {
    hitmarks: [15],
    hitlag: [6],
    toNormal: 20,
    toCharged: 25,
    toAbil: 15,
    frames: 25,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 22,
    toCharged: 29,
    toAbil: 13,
    frames: 29,
  },
  {
    hitmarks: [8, 23],
    hitlag: [0, 6],
    toNormal: 31,
    toCharged: 32,
    toAbil: 23,
    frames: 32,
  },
  {
    hitmarks: [11, 23],
    hitlag: [0, 2],
    toNormal: 45,
    toCharged: 46,
    toAbil: 23,
    frames: 46,
  },
  {
    hitmarks: [15],
    hitlag: [6],
    toNormal: 67,
    toCharged: 67,
    toAbil: 15,
    frames: 67,
  },
]

/** The sheet's normal nodes: by string step, then by hit instance */
const yunjinNodes = [[0], [1], [2, 3], [4, 5], [6]]

/** Cliffbreaker's Banner: 12 s, 30 normal attack hits per member */
const BURST_STACKS = 30
const BURST_DURATION = 720
const BURST_HIT = 35

interface YunJinState {
  /** Flying Cloud Flag Formation: until this frame, and each member's normal hits left */
  formationUntil: number
  stacks: Map<CharacterKey, number>
}

function hitlag(ctx: SimContext, at: number, frames: number, label: string) {
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: frames,
    label,
  })
}

export const kit: KitModel = {
  characterKey: 'YunJin',
  element: 'geo',
  source: `${GCSIM}/yunjin`,
  init: (): YunJinState => ({ formationUntil: -1, stacks: new Map() }),
  // C6: a member under the Formation (stacks left) has Normal ATK SPD +12%
  normalAttackSpeed: (ctx, s: YunJinState, attacker) =>
    ctx.constellation('YunJin') >= 6 &&
    ctx.now <= s.formationUntil &&
    (s.stacks.get(attacker) ?? 0) > 0
      ? 0.12
      : 0,
  onHit(ctx, s: YunJinState, hit) {
    // the Formation's stacks: one per normal attack hit of the member
    if (hit.tag === 'normal' && !hit.path[0].startsWith('_')) {
      const n = s.stacks.get(hit.characterKey) ?? 0
      if (n > 0 && hit.t <= s.formationUntil)
        s.stacks.set(hit.characterKey, n - 1)
    }
    // C4: Yun Jin triggering Crystallize or Lunar-Crystallize: DEF +20% for 12 s
    if (
      ctx.constellation('YunJin') >= 4 &&
      hit.characterKey === 'YunJin' &&
      hit.path[0] === '_reaction' &&
      (hit.path[1] === 'crystallize' || hit.path[1] === 'lunarCrystallize')
    )
      ctx.buff('YunJin', ['YunJin', 'c4'], 'on', 0, 721, {
        hitlag: 'recipient',
      })
  },
  act(ctx, s: YunJinState, action, previous) {
    const c = ctx.constellation('YunJin')
    switch (action.kind) {
      case 'normal':
        return normalString(
          yunjinNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${yunjinNodes[i][j]}`],
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
          frames: 59,
          framesInto: { skill: 58, burst: 58, dash: 29, jump: 29, swap: 57 },
        }
      case 'skill': {
        // Opening Flourish: the tap's hit at 13f; a hold is gcsim's hold=1, Charge Level 1 (the hit
        // at 50f). (Charge Level 2, a 2 s hold, has no rotation syntax.) A shield until the hit
        const cd = c >= 1 ? 443 : 9 * 60
        if (!action.hold) {
          ctx.hit(13, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'geo',
            applies: true,
            durability: 50,
            icd: 'none',
            label: 'Opening Flourish',
          })
          // 0.06 s halt + defense halt
          hitlag(ctx, 13, 8, 'Opening Flourish hitlag')
          return withHitlag(
            {
              cooldown: { key: 'skill', frames: cd, delay: 11 },
              frames: 62,
              framesInto: { dash: 49, jump: 48, swap: 59 },
            },
            { hitmarks: [13], hitlag: [8] }
          )
        }
        ctx.hit(50, {
          path: ['skill', 'dmg1'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Opening Flourish (Level 1)',
        })
        // 0.09 s halt + defense halt
        hitlag(ctx, 50, 9, 'Opening Flourish hitlag')
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: cd, delay: 48 },
            frames: 97,
            framesInto: { normal: 96, dash: 85, jump: 85, swap: 95 },
          },
          { hitmarks: [50], hitlag: [9] }
        )
      }
      case 'burst':
        // Cliffbreaker's Banner: the hit at 35f (6 m around her); the Formation (30 normal hits
        // per member, 12 s) and C2 from then
        ctx.hit(BURST_HIT, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'burst',
          blunt: true,
          poiseDamage: 200,
          label: "Cliffbreaker's Banner",
        })
        ctx.at(BURST_HIT, (c2) => {
          s.formationUntil = c2.now + BURST_DURATION
          for (const m of c2.members) s.stacks.set(m, BURST_STACKS)
          // C2: the party's Normal Attack DMG +15% for 12 s (its own condition beyond the
          // Formation's 30 hits)
          if (c >= 2)
            c2.buff('YunJin', ['YunJin', 'c2'], 'on', 0, BURST_DURATION + 1, {
              hitlag: 'recipient',
            })
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 57,
          framesInto: { dash: 42, jump: 41, swap: 55 },
        }
      case 'dash':
        // template dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Girl body): 34f after a dash, 31f otherwise
        return templateJump('girl', 'polearm', previous, ctx)
      case 'plunge':
        // gcsim has no plunging attack for YunJin
        ctx.note('YunJin: plunging attacks are not in gcsim; not modelled.')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  // The burst's buff: a party member's next 30 normal attack hits within 12 s of the burst
  // (the damage is DEF-based, the sheet's condition for it is the burst's)
  countedBuffs(hits) {
    const covered = new Set<number>()
    const used = new Map<string, number>()
    // the Formation lasts 12 s on each member's clock: their hitlag since the burst extends it
    const pauses = new Map<string, number>()
    let from = -1
    let until = -1
    hits.forEach((h: SimHit, i) => {
      if (
        h.characterKey === 'YunJin' &&
        h.path[0] === 'burst' &&
        h.path[1] === 'dmg'
      ) {
        from = h.t
        until = h.t + BURST_DURATION
        used.clear()
        pauses.clear()
        return
      }
      if (h.path.join('.') === '_marker.hitlag' && h.t >= from) {
        pauses.set(
          h.characterKey,
          (pauses.get(h.characterKey) ?? 0) + (h.animationPause ?? 0)
        )
        return
      }
      if (h.tag !== 'normal' || h.t > until + (pauses.get(h.characterKey) ?? 0))
        return
      const n = used.get(h.characterKey) ?? 0
      if (n >= BURST_STACKS) return
      used.set(h.characterKey, n + 1)
      covered.add(i)
    })
    const buffs: SimCountedBuff[] = [
      {
        owner: 'YunJin',
        path: ['YunJin', 'skill'],
        value: 'on',
        hits: covered,
      },
    ]
    return { buffs, extraHits: [] }
  },
}
