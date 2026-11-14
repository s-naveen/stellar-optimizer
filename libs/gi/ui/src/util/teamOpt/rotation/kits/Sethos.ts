import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/sethos, main as of 2026-11-10. */

/** Normal attacks and aimed shots: gcsim's default travel time (frames after the hitmark) */
const TRAVEL = 10

/** Normal attack string (N1..N3; N2 has two hits): hitmarks, cancels (the aimed shot's too) */
const sethosNormals: NormalHit[] = [
  {
    hitmarks: [10 + TRAVEL],
    toNormal: 17,
    toCharged: 15,
    toAbil: 10,
    frames: 19,
  },
  {
    hitmarks: [12 + TRAVEL, 15 + TRAVEL],
    toNormal: 32,
    toCharged: 28,
    toAbil: 15,
    frames: 35,
  },
  {
    hitmarks: [39 + TRAVEL],
    toNormal: 63,
    toCharged: 39,
    toAbil: 39,
    frames: 69,
  },
]

/** The sheet's normal nodes of each hit of the string (N2's two hits are '1' and '2') */
const normalNodes = [['0'], ['1', '2'], ['3']]
/** During the burst, the Dusk Bolt nodes of the same hits */
const duskNodes = [['dusk_0'], ['dusk_1', 'dusk_2'], ['dusk_3']]

interface SethosState {
  /** The burst's buff (Dusk Bolts; no aimed shots) lasts until this frame (Sethos's clock) */
  burstEnd: number
  /** C2's three independent stacks (consuming / regaining / burst), each until (Sethos's clock) */
  c2: Record<'consuming' | 'regaining' | 'burst', number>
  /** A4's Scorching Sandshade: 'ready' until a Shadowpiercing Shot hits, then 5 s or 4 shots */
  a4: 'ready' | 'running' | 'off'
  a4Until: number
  a4Count: number
  /** A4's 15 s regain timer runs (from the first hit) */
  a4Icd: boolean
  /** When Sethos's skill hit lands, for its energy refund (C2's regaining stack) */
  skillHitAt: number
}

/**
 * The Shadowpiercing Shot (gcsim's default aim, the Charge Level 2 shot) with A1's tally full:
 * 20 Energy cut its 368-frame charge by 0.285 s each (342 frames). The kit does not track Energy:
 * the rotation is assumed to bring 20 or more to each shot (2 particles plus the reaction refund
 * of the skill before it, or the start of a rotation).
 */
const A1_SKIP = Math.trunc(0.285 * 20 * 60)
const SHADOW_FIRE = 368 - A1_SKIP

const sethosClock = (ctx: SimContext) => ctx.characterFrame('Sethos')

/** C2: 15% Electro DMG per stack (2 at most), each source's stack lasting 10 s on its own */
function c2Stack(
  ctx: SimContext,
  s: SethosState,
  src: keyof SethosState['c2']
) {
  if (ctx.constellation('Sethos') < 2) return
  const until = sethosClock(ctx) + 600
  s.c2[src] = until
  c2Refresh(ctx, s)
  ctx.atCharacter('Sethos', 600, (c) => {
    if (s.c2[src] === until) c2Refresh(c, s)
  })
}
function c2Refresh(ctx: SimContext, s: SethosState) {
  const now = sethosClock(ctx)
  const n = Object.values(s.c2).filter((t) => now < t).length
  ctx.state('Sethos', ['Sethos', 'c2Stacks'], n ? `${Math.min(n, 2)}` : '')
}

const a4Active = (ctx: SimContext, s: SethosState) =>
  s.a4 === 'ready' || (s.a4 === 'running' && sethosClock(ctx) <= s.a4Until)

/** A4 on a Shadowpiercing Shot's hit (gcsim's makeA4cb) */
function a4OnHit(ctx: SimContext, s: SethosState) {
  if (!a4Active(ctx, s)) return
  if (s.a4 === 'ready') {
    s.a4 = 'running'
    s.a4Until = sethosClock(ctx) + 300
    s.a4Count = 0
    if (!s.a4Icd) {
      s.a4Icd = true
      ctx.atCharacter('Sethos', 900, () => {
        s.a4 = 'ready'
        s.a4Count = 0
        s.a4Icd = false
      })
    }
  }
  if (++s.a4Count >= 4) s.a4 = 'off'
}

const REFUND_REACTIONS = new Set([
  'overloaded',
  'electroCharged',
  'lunarCharged',
  'superconduct',
  'stellarConduct',
  'quicken',
  'aggravate',
])

export const kit: KitModel = {
  characterKey: 'Sethos',
  element: 'electro',
  source: `${GCSIM}/sethos`,
  init: (): SethosState => ({
    burstEnd: -1,
    c2: { consuming: -1, regaining: -1, burst: -1 },
    a4: 'ready',
    a4Until: -1,
    a4Count: 0,
    a4Icd: false,
    skillHitAt: -1,
  }),
  act(ctx, s: SethosState, action, previous) {
    const inBurst = (c: SimContext) => sethosClock(c) <= s.burstEnd
    switch (action.kind) {
      case 'normal':
        return normalString(
          sethosNormals,
          action.count ?? 1,
          (i, d, j) => {
            // each arrow is a Dusk Bolt if the burst is up when it is fired (gcsim: the arrow is
            // queued at the hitmark, snapshotted there, and lands TRAVEL later)
            const fire = d - TRAVEL
            ctx.at(fire, (c) => {
              const dusk = inBurst(c)
              c.hit(TRAVEL, {
                path: dusk
                  ? ['burst', duskNodes[i][j]]
                  : ['normal', normalNodes[i][j]],
                tag: dusk ? 'charged' : 'normal',
                element: dusk ? 'electro' : 'physical',
                applies: true,
                icd: dusk ? 'burst' : 'none',
                label: dusk ? `Dusk Bolt ${i + 1}` : `N${i + 1}`,
                snapshotDelay: 0,
              })
            })
          },
          ctx
        )
      case 'charged': {
        if (inBurst(ctx))
          return { frames: 0, failed: 'Sethos: cannot aim while in burst' }
        ctx.atCharacter('Sethos', SHADOW_FIRE, (c) => {
          c.hit(TRAVEL, {
            path: ['charged', 'shadow'],
            tag: 'charged',
            element: 'electro',
            applies: true,
            durability: 50,
            icd: 'none',
            label: 'Shadowpiercing Shot',
            snapshotDelay: 0,
            // A4's bonus is decided when the shot is fired
            states: [
              {
                owner: 'Sethos',
                path: ['Sethos', 'a4Sandshade'],
                value: a4Active(c, s) ? 'on' : '',
              },
            ],
          })
          // A1 consumes the tallied Energy as the shot is fired: C2's consuming stack
          c2Stack(c, s, 'consuming')
          c.at(TRAVEL, (c2) => a4OnHit(c2, s))
        })
        return {
          frames: 379 - A1_SKIP,
          framesInto: {
            dash: SHADOW_FIRE,
            jump: SHADOW_FIRE,
            wait: SHADOW_FIRE,
          },
        }
      }
      case 'skill':
        ctx.hit(13, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Ancient Rite: Thunderous Roar of Sand',
        })
        s.skillHitAt = ctx.now + 13
        ctx.note(
          'Sethos: Energy is not tracked (each Shadowpiercing Shot assumes a full A1 tally of 20); C4 needs two enemies pierced (single target: not reached).'
        )
        return {
          cooldown: { key: 'skill', frames: 8 * 60, delay: 10 },
          frames: 38,
          framesInto: {
            normal: 28,
            skill: 32,
            burst: 28,
            dash: 27,
            jump: 27,
            swap: 30,
            // gcsim's CanQueueAfter is the walk cancel
            wait: 25,
          },
        }
      case 'burst':
        // (a buff only: no damage of its own) 8 s on Sethos's clock, ended by leaving the field
        s.burstEnd = sethosClock(ctx) + 8 * 60
        c2Stack(ctx, s, 'burst')
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 50,
        }
      case 'dash':
        // (Boy body: the template's dash)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(_ctx, s: SethosState) {
    s.burstEnd = -1
  },
  onHit(ctx, s: SethosState, hit) {
    // the skill's Energy refund on an Electro reaction it triggers: C2's regaining stack
    // (a Hyperbloom has no marker of its own: its damage lands 60 frames after the core is hit)
    if (
      hit.characterKey === 'Sethos' &&
      ((hit.path[0] === '_reaction' &&
        hit.t === s.skillHitAt &&
        REFUND_REACTIONS.has(hit.path[1])) ||
        (hit.path[0] === 'reaction' &&
          hit.path[1] === 'hyperbloom' &&
          hit.t === s.skillHitAt + 60))
    ) {
      s.skillHitAt = -1
      c2Stack(ctx, s, 'regaining')
    }
  },
}
