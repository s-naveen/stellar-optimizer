import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xiao, main as of 2026-11-10. */

const xiaoNormals: NormalHit[] = [
  {
    hitmarks: [4, 17],
    hitlag: [0, 5],
    toNormal: 25,
    toCharged: 26,
    toAbil: 17,
    frames: 26,
  },
  {
    hitmarks: [15],
    hitlag: [5],
    toNormal: 22,
    toCharged: 27,
    toAbil: 15,
    frames: 27,
  },
  {
    hitmarks: [15],
    hitlag: [5],
    toNormal: 26,
    toCharged: 38,
    toAbil: 15,
    frames: 38,
  },
  {
    hitmarks: [14, 31],
    hitlag: [2, 5],
    toNormal: 39,
    toCharged: 42,
    toAbil: 31,
    frames: 42,
  },
  {
    hitmarks: [16],
    hitlag: [5],
    toNormal: 24,
    toCharged: 30,
    toAbil: 16,
    frames: 30,
  },
  {
    hitmarks: [39],
    hitlag: [6],
    toNormal: 79,
    toCharged: 79,
    toAbil: 39,
    frames: 79,
  },
]

/** Bane of All Evil: 15 s, plus its 57-frame start */
const BANE_FRAMES = 957

interface XiaoState {
  /** Bane of All Evil (Q) is up: its normals, charged and plunge are Anemo */
  inQ: boolean
  /** The cast of the current Bane of All Evil (its timers check it) */
  qTok: number
  /** A4: Lemniscatic Wind Cycling stacks, and the cast whose 7 s they run on */
  a4Stacks: number
  a4Tok: number
}

function endBurst(ctx: SimContext, s: XiaoState) {
  s.inQ = false
  ctx.state('Xiao', ['Xiao', 'inBurst'], '')
  ctx.state('Xiao', ['Xiao', 'a1BurstStack'], '')
}

export const kit: KitModel = {
  characterKey: 'Xiao',
  element: 'anemo',
  source: `${GCSIM}/xiao`,
  init: (): XiaoState => ({
    inQ: false,
    qTok: -1,
    a4Stacks: 0,
    a4Tok: -1,
  }),
  // Lemniscatic Wind Cycling: 2 charges (3 at C1), recharged one after another
  charges: (cons) => ({ skill: cons >= 1 ? 3 : 2 }),
  act(ctx, s: XiaoState, action, previous) {
    const inQ = s.inQ
    // Bane of All Evil makes normal, charged and plunging attacks Anemo (the sheet's inBurst)
    const element = inQ ? 'anemo' : 'physical'
    switch (action.kind) {
      case 'normal':
        return normalString(
          xiaoNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element,
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(16, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element,
          applies: true,
          // gcsim: charged attacks share the normal attacks' ICD during Bane of All Evil
          icd: inQ ? 'normal' : 'ExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 45,
          framesInto: { skill: 38, burst: 37, dash: 16, jump: 16, swap: 43 },
        }
      case 'skill': {
        ctx.hit(4, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          icd: 'XiaoDash',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Lemniscatic Wind Cycling',
        })
        // A4 (assumed unlocked): each use adds a stack for the next uses, 15 frames after the cast
        // (up to 3); a new stack refreshes the 7 s of them all (on his clock: gcsim's hitlag)
        ctx.at(15, (c) => {
          const tok = c.now
          s.a4Stacks = Math.min(3, s.a4Stacks + 1)
          s.a4Tok = tok
          c.state('Xiao', ['Xiao', 'a4SkillStack'], `${s.a4Stacks}`)
          c.atCharacter('Xiao', 420, (c2) => {
            if (s.a4Tok !== tok) return
            s.a4Stacks = 0
            c2.state('Xiao', ['Xiao', 'a4SkillStack'], '')
          })
        })
        return {
          cooldown: { key: 'skill', frames: 600 },
          frames: 37,
          framesInto: { normal: 24, skill: 24, burst: 24, dash: 35, swap: 35 },
        }
      }
      case 'burst': {
        // Bane of All Evil has no damage of its own (its HP drain is not damage). It lasts 15 s and
        // its 57-frame start on his clock (gcsim's hitlag), or until he leaves the field.
        const tok = ctx.now
        s.inQ = true
        s.qTok = tok
        ctx.state('Xiao', ['Xiao', 'inBurst'], 'inBurst')
        // A1: +5% DMG, and 5% more every 3 s (up to 25%)
        ctx.state('Xiao', ['Xiao', 'a1BurstStack'], '0')
        for (let k = 1; k < 5; k++)
          ctx.at(180 * k, (c) => {
            if (s.inQ && s.qTok === tok)
              c.state('Xiao', ['Xiao', 'a1BurstStack'], `${k}`)
          })
        ctx.atCharacter('Xiao', BANE_FRAMES, (c) => {
          if (s.qTok === tok && s.inQ) endBurst(c, s)
        })
        for (let at = 117; at < BANE_FRAMES; at += 60)
          ctx.at(at, (c) => {
            if (!s.inQ || s.qTok !== tok) return
            c.hit(0, {
              path: ['_marker', 'hpLoss'],
              tag: 'other',
              element: 'anemo',
              label: 'Bane of All Evil (HP loss)',
            })
          })
        return {
          cooldown: { key: 'burst', frames: 1080, delay: 29 },
          frames: 82,
          framesInto: { dash: 59, jump: 60, swap: 66 },
        }
      }
      case 'plunge': {
        const assisted = ctx.hasBuff('Xianyun', ['Xianyun', '_airborne'])
        // Xiao's plunge without Xianyun (gcsim's default table): the low plunge hits at 46 frames
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element,
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        if (assisted)
          return {
            frames: 73,
            framesInto: {
              normal: 59,
              skill: 58,
              burst: 58,
              dash: 59,
              jump: 60,
              swap: 62,
            },
          }
        return {
          frames: 62,
          framesInto: { normal: 60, skill: 59, dash: 60, jump: 61 },
        }
      }
      case 'dash':
        // a Boy's dash (gcsim's template by body type)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // During Bane of All Evil, Xiao's jump can plunge at 5 frames (his burst jump)
        if (inQ) return { frames: 58, framesInto: { plunge: 5 } }
        // otherwise the template's jump (Boy body): longer right after a dash. gcsim's plain jump
        // only lets a wait start at the low plunge's 5 frames; a plunge waits for the whole jump.
        {
          const jump = templateJump('boy', 'polearm', previous, ctx)
          return { frames: jump.frames, framesInto: { wait: 5 } }
        }
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: XiaoState) {
    // Bane of All Evil (and A1) end when he leaves the field
    if (s.inQ) endBurst(ctx, s)
  },
}
