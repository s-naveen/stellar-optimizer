import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/zhongli, main as of 2026-11-10. */

/*
 * Assumptions: A1 (Fortify) and A4 (the Max HP bonuses) are unlocked (the sim has no ascension, and
 * Fortify only changes the shield); a stele resonates with the party's other Geo constructs (all
 * taken to stand within 8 m of it), not with Zhongli's other steles (gcsim; KQM evidence), and its
 * ticks use the snapshot of the latest stele; the Jade Shield lasts its full 20 s (it is never
 * broken). Not modelled: the shield's healing (C6, needs incoming damage) and plunges (gcsim has
 * none).
 */

const zhongliNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 18,
    toCharged: 30,
    toAbil: 11,
    frames: 30,
  },
  {
    hitmarks: [9],
    hitlag: [5],
    toNormal: 13,
    toCharged: 30,
    toAbil: 9,
    frames: 30,
  },
  {
    hitmarks: [8],
    hitlag: [5],
    toNormal: 19,
    toCharged: 28,
    toAbil: 8,
    frames: 28,
  },
  {
    hitmarks: [16],
    hitlag: [5],
    toNormal: 34,
    toCharged: 33,
    toAbil: 16,
    frames: 34,
  },
  // (the last hit's cancels into skill, burst, dash and jump are at 5 frames; swap at 4)
  {
    hitmarks: [11, 18, 23, 29],
    toNormal: 27,
    toCharged: 31,
    toAbil: 5,
    frames: 31,
  },
  {
    hitmarks: [29],
    hitlag: [5],
    toNormal: 54,
    toCharged: 54,
    toAbil: 29,
    frames: 54,
  },
]

/** A Stone Stele stands for 1860 frames (31 s), and ticks every 120 frames */
const STELE_FRAMES = 1860
/** The Jade Shield's resist shred: 1200 frames of shield, each shred 60 frames */
const SHRED_FRAMES = 1200 + 60

interface ZhongliState {
  /** Stone Steles (the ones standing are those not yet expired or replaced) */
  steles: { src: number; expiry: number }[]
  /** Every stele registered as a Geo construct, with its full expiry (the engine's count keeps
   * a replaced one until then) */
  registered: number[]
  /** The latest stele's snapshot: every stele's ticks use it (gcsim's steleSnapshot) */
  snap?: { t: number; onField: CharacterKey }
}

/** The offensive stats a gcsim snapshot fixes, as of `snap` */
const snapshotStats = (snap: { t: number; onField: CharacterKey }) =>
  (
    [
      'atk',
      'hp',
      'critRate_',
      'critDMG_',
      'all_dmg_',
      'geo_dmg_',
      'skill_dmg_',
    ] as const
  ).map((stat) => ({ stat, path: ['total', stat], ...snap }))

/** A Stone Stele appears: its initial hit now, and its ticks every 120 frames while it stands */
function newStele(ctx: SimContext, s: ZhongliState, max: number) {
  const now = ctx.now
  const standing = s.steles.filter((x) => x.expiry > now)
  // at the maximum, the newest is replaced (gcsim's construct refresh replaces the last one of
  // its type)
  const kept = standing.length >= max ? standing.slice(0, max - 1) : standing
  s.steles = [...kept, { src: now, expiry: now + STELE_FRAMES }]
  s.registered = [
    ...s.registered.filter((end) => end > now),
    now + STELE_FRAMES,
  ]
  ctx.construct(STELE_FRAMES)
  s.snap = { t: now, onField: ctx.onField }
  ctx.hit(0, {
    characterKey: 'Zhongli',
    path: ['skill', 'stele'],
    tag: 'skill',
    element: 'geo',
    applies: true,
    durability: 50,
    icd: 'skill',
    blunt: true,
    poiseDamage: 200,
    label: 'Stone Stele',
  })
  ctx.at(120, steleTick(s, now))
}

/** A stele's tick: its own hit, and one resonance hit per other Geo construct of the party */
function steleTick(s: ZhongliState, src: number): (c: SimContext) => void {
  return (c) => {
    const me = s.steles.find((x) => x.src === src)
    if (!me || c.now >= me.expiry) return
    const own = s.registered.filter((end) => end > c.now).length
    const others = Math.max(0, c.constructs - own)
    for (let k = 0; k <= others; k++)
      c.hit(0, {
        characterKey: 'Zhongli',
        path: ['skill', 'resonance'],
        tag: 'skill',
        element: 'geo',
        applies: true,
        icd: 'skill',
        blunt: true,
        label: k === 0 ? 'Stone Stele (tick)' : 'Stone Stele (resonance)',
        ...(s.snap ? { statSnapshots: snapshotStats(s.snap) } : {}),
      })
    c.at(120, steleTick(s, src))
  }
}

export const kit: KitModel = {
  characterKey: 'Zhongli',
  element: 'geo',
  source: `${GCSIM}/zhongli`,
  init: (): ZhongliState => ({ steles: [], registered: [] }),
  act(ctx, s: ZhongliState, action, previous) {
    const c = ctx.constellation('Zhongli')
    const maxStele = c >= 1 ? 2 : 1
    switch (action.kind) {
      case 'normal':
        return normalString(
          zhongliNormals,
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
        ctx.hit(4, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'extra',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        // (deployable: the enemy alone takes its hitlag)
        ctx.hit(4, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 0,
          enemyAnimationPause: 8,
          label: 'Charged Attack enemy hitlag',
        })
        return {
          frames: 47,
          framesInto: { skill: 33, burst: 33, dash: 4, jump: 4, swap: 31 },
        }
      case 'skill':
        if (action.hold) {
          // Stone Stele (Hold): Geo DMG at 48 frames, a stele if there is room, and the Jade Shield
          ctx.hit(48, {
            path: ['skill', 'holdDMG'],
            tag: 'skill',
            element: 'geo',
            applies: true,
            icd: 'skill',
            blunt: true,
            poiseDamage: 142.9,
            // (gcsim: stats at the cast)
            snapshotDelay: 0,
            label: 'Stone Stele (Hold)',
          })
          if (s.steles.filter((x) => x.expiry > ctx.now + 48).length < maxStele)
            ctx.at(48, (c2) => newStele(c2, s, maxStele))
          ctx.buff('Zhongli', ['Zhongli', 'skill'], 'on', 48, SHRED_FRAMES, {
            hitlag: 'enemy',
          })
          return {
            cooldown: { key: 'skill', frames: 720, delay: 47 },
            frames: 96,
            framesInto: { dash: 55, jump: 55 },
          }
        }
        // Dominus Lapidis (press): a stele 24 frames in, with its initial hit
        ctx.at(24, (c2) => newStele(c2, s, maxStele))
        return {
          cooldown: { key: 'skill', frames: 240, delay: 22 },
          frames: 38,
          framesInto: { normal: 37, dash: 23, jump: 23, swap: 37 },
        }
      case 'burst':
        // Planet Befall: Geo DMG at 101 frames (Durability 100); C2: a Jade Shield "when it
        // descends" (gcsim grants it at the cast)
        ctx.hit(101, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 100,
          icd: 'none',
          blunt: true,
          poiseDamage: 500,
          label: 'Planet Befall',
        })
        if (c >= 2)
          ctx.buff('Zhongli', ['Zhongli', 'skill'], 'on', 101, SHRED_FRAMES, {
            hitlag: 'enemy',
          })
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 139,
          framesInto: { dash: 123, jump: 123, swap: 138 },
        }
      case 'dash':
        // template dash (Male body)
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // template jump (Male body): 37 frames after a dash, else 28
        return templateJump('male', 'polearm', previous, ctx)
      case 'plunge':
        ctx.note('Zhongli: plunging attacks are not in gcsim; not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
}
