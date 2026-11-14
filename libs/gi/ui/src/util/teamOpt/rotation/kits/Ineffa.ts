import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ineffa, main as of 2026-11-10. */

/*
 * Assumptions: A1 and A4 are unlocked (the sim has no ascension). The Lunar-Charged cloud comes
 * from the engine's reaction markers: A1's Birgitta hit needs it up at the discharge, C6's hit
 * follows a Lunar-Charged reaction hit while C1's buff is up. Not modelled: the shields' HP, C4's
 * energy, and plunges (gcsim has none).
 */

const ineffaNormals: NormalHit[] = [
  {
    hitmarks: [9],
    hitlag: [8],
    toNormal: 12,
    toCharged: 27,
    toAbil: 9,
    frames: 35,
  },
  {
    hitmarks: [17],
    hitlag: [8],
    toNormal: 19,
    toCharged: 39,
    toAbil: 17,
    frames: 46,
  },
  {
    hitmarks: [10, 21],
    hitlag: [0, 8],
    toNormal: 33,
    toCharged: 39,
    toAbil: 21,
    frames: 48,
  },
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 52,
    toCharged: 55,
    toAbil: 27,
    frames: 55,
  },
]

interface IneffaState {
  /** Birgitta: the summon that is out (`birgittaSrc`), and when it leaves */
  birgittaSrc: number
  birgittaEnd: number
  /** C2: the burst's hit landed at `c2At`; the Punishment Edit is still to come */
  c2At: number
  c2Pending: boolean
  /** The Lunar-Charged cloud is up until this frame (5.5 s after the last Lunar-Charged reaction) */
  lcUntil: number
  /** C1's buff (20 s after a shield) lasts until this frame */
  c1Until: number
  /** C6's hit is on cooldown until this frame */
  c6Icd: number
}

/** Birgitta is summoned: a discharge 42 frames later, then one every 119 frames for 20 s */
function summonBirgitta(ctx: SimContext, s: IneffaState) {
  const src = ctx.now
  s.birgittaSrc = src
  s.birgittaEnd = src + 20 * 60
  const discharge = (c: SimContext) => {
    // a later summon (the burst's) ends this chain
    if (s.birgittaSrc !== src || c.now >= s.birgittaEnd) return
    c.hit(0, {
      characterKey: 'Ineffa',
      path: ['skill', 'birgittaDmg'],
      tag: 'skill',
      element: 'electro',
      applies: true,
      icd: 'none',
      label: 'Birgitta Discharge',
    })
    // A1: with the Lunar-Charged cloud up at the discharge, Birgitta follows up 38 frames later
    // (a direct Lunar-Charged hit, no element application)
    if (c.now < s.lcUntil)
      c.hit(38, {
        characterKey: 'Ineffa',
        path: ['passive1', 'dmg'],
        tag: 'other',
        element: 'electro',
        label: 'Birgitta (A1, Lunar-Charged)',
      })
    c.at(119, discharge)
  }
  ctx.at(42, discharge)
}

/** C2's Punishment Edit (a direct Lunar-Charged hit: no element application) */
const c2Hit: Parameters<SimContext['hit']>[1] = {
  characterKey: 'Ineffa',
  path: ['constellation2', 'dmg'],
  tag: 'other',
  element: 'electro',
  label: 'Punishment Edit (C2, Lunar-Charged)',
}

export const kit: KitModel = {
  characterKey: 'Ineffa',
  moonsign: 1,
  element: 'electro',
  source: `${GCSIM}/ineffa`,
  init: (): IneffaState => ({
    birgittaSrc: -1e9,
    birgittaEnd: -1e9,
    c2At: -1e9,
    c2Pending: false,
    lcUntil: -1e9,
    c1Until: -1e9,
    c6Icd: -1e9,
  }),
  act(ctx, s: IneffaState, action, previous) {
    const now = ctx.now
    const c = ctx.constellation('Ineffa')
    switch (action.kind) {
      case 'normal':
        return normalString(
          ineffaNormals,
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
        ctx.hit(23, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          label: 'Charged Attack',
        })
        return {
          frames: 60,
          framesInto: {
            normal: 45,
            skill: 45,
            burst: 45,
            dash: 23,
            jump: 23,
            swap: 43,
          },
        }
      case 'skill':
        ctx.hit(26, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Cleaning Mode: Carrier Frequency',
        })
        // Birgitta is summoned 42 frames after the hit
        ctx.at(68, (c2) => summonBirgitta(c2, s))
        // the shield (4 frames in) starts C1's Lunar-Charged buff
        if (c >= 1) {
          s.c1Until = now + 4 + 20 * 60
          ctx.buff('Ineffa', ['Ineffa', 'c1AfterShield'], 'on', 4, 20 * 60)
        }
        return {
          cooldown: { key: 'skill', frames: 16 * 60, delay: 1 },
          frames: 32,
          framesInto: { swap: 31 },
        }
      case 'burst': {
        ctx.hit(111, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Supreme Instruction: Cyclonic Exterminator',
        })
        // the burst dismisses Birgitta, and summons her again with its hit
        s.birgittaEnd = now
        ctx.at(111, (c2) => summonBirgitta(c2, s))
        // C2: the Punishment Edit comes at the next hit on the enemy, or 60 frames after the hit
        if (c >= 2) {
          s.c2At = now + 111
          s.c2Pending = true
          ctx.at(111 + 60, (c2) => {
            if (!s.c2Pending) return
            s.c2Pending = false
            c2.hit(0, c2Hit)
          })
        }
        // C2's shield (37 frames in) also starts C1's buff
        if (c >= 2) {
          s.c1Until = Math.max(s.c1Until, now + 37 + 20 * 60)
          ctx.buff('Ineffa', ['Ineffa', 'c1AfterShield'], 'on', 37, 20 * 60)
        }
        // A4: the team's EM for 20 s after the burst
        ctx.buff('Ineffa', ['Ineffa', 'a4AfterBurst'], 'on', 0, 20 * 60)
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 130,
          framesInto: {
            normal: 127,
            skill: 127,
            dash: 105,
            jump: 106,
            swap: 126,
          },
        }
      }
      case 'plunge':
        ctx.note('Ineffa: plunging attacks are not in gcsim; not modelled')
        return { frames: 30 }
      case 'dash':
        // template dash (Girl body)
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Girl body): 34 frames after a dash, else 31
        return templateJump('girl', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: IneffaState, hit) {
    if (hit.path[0] === '_reaction' && hit.path[1] === 'lunarCharged')
      s.lcUntil = hit.t + 330
    // C6 (needs C1's buff): a Lunar-Charged reaction hit calls a hit 10 frames later, every 3.5 s
    if (
      hit.path[0] === 'reaction' &&
      hit.path[1] === 'lunarcharged' &&
      ctx.constellation('Ineffa') >= 6 &&
      hit.t < s.c1Until &&
      hit.t >= s.c6Icd
    ) {
      s.c6Icd = hit.t + 210
      ctx.hit(10, {
        characterKey: 'Ineffa',
        path: ['constellation6', 'dmg'],
        tag: 'other',
        element: 'electro',
        label: 'A Dawning Morn for You (C6, Lunar-Charged)',
      })
    }
    // C2: the Punishment Edit also goes off at the next real hit on the enemy (not markers)
    if (s.c2Pending && hit.t > s.c2At && !hit.path[0].startsWith('_')) {
      s.c2Pending = false
      ctx.hit(0, c2Hit)
    }
  },
}
