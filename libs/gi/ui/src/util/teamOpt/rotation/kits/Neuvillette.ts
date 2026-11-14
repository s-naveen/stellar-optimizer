import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/neuvillette, main as of 2026-11-10. */

/** N1..N3 from gcsim's attack.go (hitmarks, cancels) */
const neuvNormals: NormalHit[] = [
  { hitmarks: [19], toNormal: 29, toCharged: 20, toAbil: 19, frames: 36 },
  { hitmarks: [16], toNormal: 31, toCharged: 22, toAbil: 16, frames: 33 },
  { hitmarks: [32], toNormal: 62, toCharged: 51, toAbil: 32, frames: 62 },
]

/** Sourcewater Droplets last 878 frames */
const DROPLET_LIFE = 878
/** Equitable Judgment's legal evaluation (frames) by the droplets it picks up: 0 to 3 */
const LEGAL_EVAL = [209, 152, 98, 0]
/** The judgment lasts 173 frames (C6: +60 per droplet absorbed while it lasts) */
const JUDGMENT = 173
/** Animation lengths (gcsim's AnimationLength): after them he is idle (a Charged Attack winds up) */
const ANIMATION = { skill: 42, burst: 135, charged: 1200, dash: 19 }

/**
 * Past Draconic Glories (A1): each of these reactions, triggered by anyone on the enemy, counts
 * once for 30 s (gcsim's a1 events: Bloom, Lunar-Bloom, Electro-Charged, Lunar-Charged,
 * Lunar-Crystallize, Frozen, Hydro Swirl, Vaporize, Hydro Crystallize — the crystallize marker's
 * element is the aura it consumed).
 */
const A1_REACTIONS = [
  'bloom',
  'lunarBloom',
  'electroCharged',
  'lunarCharged',
  'lunarCrystallize',
  'frozen',
  'hydroSwirl',
  'vaporize',
]
const A1_DUR = 30 * 60
/** Equitable Judgment drains 8% of max HP every 30 frames from 40 frames in, while HP > 50% */
const DRAIN_FIRST = 40
const hpChanged = (c: SimContext) =>
  c.hit(0, {
    path: ['_marker', 'hpChange'],
    tag: 'other',
    element: 'hydro',
    label: 'HP changed',
  })

interface NeuvilletteState {
  /** A1: each reaction's counted until (frame) */
  a1: Record<string, number>
  /** C1's base A1 stack was set */
  c1Set: boolean
  /** His HP as a ratio of his max HP (Equitable Judgment's drain, the droplets' healing) */
  hp: number
  /** Sourcewater Droplets: spawned at `at`, gone at `end` (frames) */
  droplets: { at: number; end: number }[]
  /** Spiritbreath Thorn's 10 s ICD: until (frame) */
  thornUntil: number
  /** Equitable Judgment's C6 projectile ICD (2 s): until (frame) */
  c6Until: number
  /** Swapped out since its last action: the next action starts from a swap (a windup) */
  away: boolean
  /** His last action's animation ends (frame): idle after it */
  animEnd: number
  /** C4's droplet ICD (4 s, active on its expiry frame): until (frame) */
  c4Until: number
}

/** His HP ratio: the party's tracked HP, or the kit's own model (his drains and droplets only) */
const hpRatio = (c: SimContext, s: NeuvilletteState) =>
  c.healthTracked ? (c.hpRatio('Neuvillette') ?? 1) : s.hp

/** A4: Hydro DMG +0.6% per % of his current HP above 30% (the sheet's state: 1 to 50) */
function a4State(c: SimContext, s: NeuvilletteState) {
  const state = Math.min(50, Math.round(hpRatio(c, s) * 100 - 30))
  c.state('Neuvillette', ['Neuvillette', 'a4Hp'], state >= 1 ? `${state}` : '')
}

/** A droplet absorbed: it heals him 16% of his Max HP 5 frames later (C4: then a new droplet) */
function absorbDroplet(c: SimContext, s: NeuvilletteState, delay: number) {
  c.at(delay + 5, (c2) => {
    if (c2.healthTracked) c2.healPercent('Neuvillette', 0.16, ['Neuvillette'])
    else {
      if (s.hp < 1) hpChanged(c2)
      s.hp = Math.min(1, s.hp + 0.16)
      a4State(c2, s)
      c4Droplet(c2, s)
    }
  })
}

/** C4: healed on the field, a Sourcewater Droplet appears (once per 4 s) */
function c4Droplet(c: SimContext, s: NeuvilletteState) {
  if (c.constellation('Neuvillette') < 4 || c.onField !== 'Neuvillette') return
  if (c.now < s.c4Until) return
  s.c4Until = c.now + 241
  s.droplets.push({ at: c.now, end: c.now + DROPLET_LIFE })
}

export const kit: KitModel = {
  characterKey: 'Neuvillette',
  element: 'hydro',
  source: `${GCSIM}/neuvillette`,
  init: (): NeuvilletteState => ({
    a1: {},
    c1Set: false,
    hp: 1,
    droplets: [],
    thornUntil: -1,
    c6Until: -1,
    away: false,
    animEnd: -1,
    c4Until: -1,
  }),
  onStart(ctx, s: NeuvilletteState) {
    a4State(ctx, s)
  },
  // his HP from any source (healing, Furina's Salon, his own drain) moves A4; C4 on a heal
  onHpChange(ctx, s: NeuvilletteState, change) {
    if (change.characterKey !== 'Neuvillette') return
    a4State(ctx, s)
    if (change.kind === 'heal' && change.amount > 0) c4Droplet(ctx, s)
  },
  act(ctx, s: NeuvilletteState, action, previous) {
    const swapped = s.away
    s.away = false
    // C1: the A1 starts with one stack, always
    if (!s.c1Set) {
      s.c1Set = true
      if (ctx.constellation('Neuvillette') >= 1)
        ctx.buff('Neuvillette', ['Neuvillette', 'a1Stacks'], '1', 0, 1e7, 3)
    }
    switch (action.kind) {
      case 'normal': {
        const result = normalString(
          neuvNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'hydro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
        s.animEnd = ctx.now + result.frames
        return result
      }
      case 'charged': {
        // Equitable Judgment: a windup of 14 frames out of dash, jump, swap or idle (gcsim's
        // CurrentState); otherwise it is rolled into the previous action's cancel
        const windup =
          swapped ||
          previous === undefined ||
          previous.kind === 'dash' ||
          previous.kind === 'jump' ||
          ctx.now >= s.animEnd
            ? 14
            : 0
        s.animEnd = ctx.now + ANIMATION.charged
        const c = ctx.constellation('Neuvillette')
        // the legal evaluation starts 3 frames after the windup and picks up to 3 droplets alive
        const start = windup + 3
        const alive = (t: number) =>
          s.droplets
            .filter((d) => d.at <= ctx.now + t && ctx.now + t < d.end)
            .sort((x, y) => x.end - y.end)
        const picked = alive(start).slice(0, 3)
        s.droplets = s.droplets.filter((d) => !picked.includes(d))
        for (const _droplet of picked) absorbDroplet(ctx, s, start)
        // C4: his own droplet heals spawn a droplet (once per 4 s), for C6 to absorb
        if (c >= 4 && picked.length && ctx.now + start + 5 >= s.c4Until) {
          s.c4Until = ctx.now + start + 5 + 241
          s.droplets.push({
            at: ctx.now + start + 5,
            end: ctx.now + start + 5 + DROPLET_LIFE,
          })
        }
        const first = start + LEGAL_EVAL[picked.length]
        // gcsim's judgment: waves 6 frames in, then 22, then every 25 while it lasts, and one at
        // its end. C6: every 18 frames, within its last second, it absorbs a droplet (+1 s)
        let dur = JUDGMENT
        const waves: number[] = []
        const absorbed: number[] = []
        {
          let tick = 6
          let n = 1
          let check = 0
          for (;;) {
            if (c >= 6 && check <= dur && check <= tick) {
              const left = alive(first + check)
              if (dur - check <= 60 && left.length) {
                s.droplets = s.droplets.filter((d) => d !== left[0])
                absorbed.push(check)
                dur += 60
                // (its heal, 5 frames later: C4's droplet, once per 4 s)
                const healAt = ctx.now + first + check + 5
                if (c >= 4 && healAt >= s.c4Until) {
                  s.c4Until = healAt + 241
                  s.droplets.push({ at: healAt, end: healAt + DROPLET_LIFE })
                }
              }
              check += 18
              continue
            }
            if (tick > dur) break
            waves.push(tick)
            tick += n === 1 ? 22 : 25
            n++
          }
          if (waves[waves.length - 1] !== dur) waves.push(dur)
        }
        for (const t of absorbed) absorbDroplet(ctx, s, first + t)
        // the judgment drains 8% of his max HP every 30 frames while his HP is above 50%
        for (let d = DRAIN_FIRST; d <= dur; d += 30)
          ctx.at(first + d, (c2) => {
            if (c2.healthTracked) c2.drainHp('Neuvillette', 0.08, 0.5)
            else if (s.hp > 0.5) {
              s.hp -= 0.08
              hpChanged(c2)
              a4State(c2, s)
            }
          })
        for (const w of waves) {
          const t = first + w
          ctx.hit(t, {
            path: ['charged', 'judgmentDmg'],
            tag: 'charged',
            element: 'hydro',
            applies: true,
            icd: 'charged',
            label: 'Equitable Judgment',
          })
          // C6: a wave fires two currents 29 frames later (2 s ICD, active on its expiry frame)
          if (c >= 6 && ctx.now + t >= s.c6Until) {
            s.c6Until = ctx.now + t + 121
            for (let k = 0; k < 2; k++)
              ctx.hit(t + 29, {
                path: ['constellation6', 'currentDmg'],
                tag: 'charged',
                element: 'hydro',
                applies: true,
                icd: 'NeuvilletteC6',
                label: 'Equitable Judgment (C6)',
              })
          }
        }
        // the judgment's end, then the endLag of the next action; a written wait starts at the
        // earliest cancel (windup + 3)
        const base = first + dur
        if (!ctx.healthTracked)
          ctx.note(
            'Neuvillette: his HP (A4) follows his own drains and droplets only; heals and drains from other members are not counted without HP tracking'
          )
        return {
          frames: base + 51,
          framesInto: {
            normal: base + 51,
            charged: base + 30,
            skill: base,
            burst: base,
            dash: base,
            jump: base,
            swap: base + 27,
            wait: start,
          },
        }
      }
      case 'skill': {
        // O Tears, I Shall Repay: 3 droplets on the hit (frame 23)
        ctx.hit(23, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'O Tears, I Shall Repay',
        })
        for (let k = 0; k < 3; k++)
          s.droplets.push({
            at: ctx.now + 23,
            end: ctx.now + 23 + DROPLET_LIFE,
          })
        s.animEnd = ctx.now + ANIMATION.skill
        // Spiritbreath Thorn 37 frames after the hit (60 from the cast), at most once per 10 s (a
        // status active on its expiry frame)
        ctx.at(23, (c) => {
          if (c.now < s.thornUntil) return
          s.thornUntil = c.now + 601
          c.hit(37, {
            path: ['skill', 'thornDmg'],
            tag: 'skill',
            element: 'hydro',
            // (gcsim: durability 0, it does not apply Hydro)
            applies: false,
            durability: 0,
            icd: 'none',
            label: 'Spiritbreath Thorn',
          })
          // (not a deployable in gcsim: its hit pauses him, by the default defense halt, when he
          // is on the field, whatever action he is in)
          c.at(37, (c2) => {
            if (c2.onField !== 'Neuvillette') return
            c2.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 4,
              extendsAction: true,
              label: 'Spiritbreath Thorn hitlag',
            })
          })
        })
        return {
          cooldown: { key: 'skill', frames: 720, delay: 20 },
          frames: 42,
          framesInto: { charged: 21, burst: 30, dash: 29, jump: 32, swap: 29 },
        }
      }
      case 'burst': {
        // O Tides, I Have Returned: the hit at 95 (3 droplets), then waterfalls at 135 (2) and 154 (1)
        const hits: [number, 'skillDmg' | 'waterfallDmg', number][] = [
          [95, 'skillDmg', 3],
          [135, 'waterfallDmg', 2],
          [154, 'waterfallDmg', 1],
        ]
        for (const [t, node, drops] of hits) {
          ctx.hit(t, {
            path: ['burst', node],
            tag: 'burst',
            element: 'hydro',
            applies: true,
            icd: 'burst',
            label:
              node === 'skillDmg' ? 'O Tides, I Have Returned' : 'Waterfall',
          })
          for (let k = 0; k < drops; k++)
            s.droplets.push({
              at: ctx.now + t,
              end: ctx.now + t + DROPLET_LIFE,
            })
        }
        s.animEnd = ctx.now + ANIMATION.burst
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 135,
          framesInto: {
            charged: 133,
            skill: 127,
            dash: 127,
            jump: 128,
            swap: 120,
          },
        }
      }
      case 'dash':
        // gcsim's template for this body (Male): 19 frames, 3 to the jump
        s.animEnd = ctx.now + ANIMATION.dash
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump': {
        // gcsim's template: 28 frames, 37 right after a dash
        const result = templateJump('male', 'catalyst', previous, ctx)
        s.animEnd = ctx.now + result.frames
        return result
      }
      case 'plunge':
        ctx.note('Neuvillette: gcsim has no plunge, not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: NeuvilletteState, hit) {
    // A1: a reaction not counted yet (or running out) counts for 30 s from now
    if (hit.path[0] !== '_reaction') return
    const key =
      hit.path[1] === 'crystallize' && hit.element === 'hydro'
        ? 'crystallizeHydro'
        : hit.path[1]
    if (key !== 'crystallizeHydro' && !A1_REACTIONS.includes(key)) return
    const until = s.a1[key] ?? -1
    // (only the time the reaction was not counted yet is a new stack window)
    const from = Math.max(ctx.now, until)
    const end = ctx.now + A1_DUR
    s.a1[key] = end
    if (end > from)
      ctx.buff(
        'Neuvillette',
        ['Neuvillette', 'a1Stacks'],
        '1',
        from - ctx.now,
        end - from,
        3
      )
  },
  // his hitlag pauses his animation (its end moves; the thorn can land during his next action)
  onHitlag(ctx, s: NeuvilletteState, frames) {
    if (ctx.now < s.animEnd) s.animEnd += frames
  },
  onSwapOut(_ctx, s: NeuvilletteState) {
    s.away = true
  },
}
