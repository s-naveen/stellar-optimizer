import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/jahoda, main as of 2026-11-10. */

const jahodaNormals: NormalHit[] = [
  { hitmarks: [14], toNormal: 30, toCharged: 30, toAbil: 14, frames: 35 },
  { hitmarks: [15, 29], toNormal: 48, toCharged: 47, toAbil: 29, frames: 52 },
  { hitmarks: [40], toNormal: 88, toCharged: 89, toAbil: 40, frames: 99 },
]

/** Arrow travel time (gcsim's default): the damage lands this many frames after the hitmark */
const TRAVEL = 10
/** Meowball travel time (default) */
const MEOWBALL_TRAVEL = 13

type AbsorbEle = 'pyro' | 'hydro' | 'electro' | 'cryo'
const absorbEles: AbsorbEle[] = ['pyro', 'hydro', 'electro', 'cryo']

const meowNode: Record<AbsorbEle, string> = {
  pyro: 'meowDmgPyro',
  hydro: 'meowDmgHydro',
  electro: 'meowDmgElectro',
  cryo: 'meowDmgCryo',
}
const robotNode: Record<AbsorbEle, string> = {
  pyro: 'robotDmgPyro',
  hydro: 'robotDmgHydro',
  electro: 'robotDmgElectro',
  cryo: 'robotDmgCryo',
}

interface JahodaState {
  burstToken: number
  /** Shadow Pursuit started at this frame (-1: not in it) */
  pursuit: number
  /** The element the flask absorbs (Meowball's element) */
  flaskEle?: AbsorbEle
  gauge: number
  nextFill: number
  drainAt: number
  bounceCredit: number
  /** The Meowball's token: a new Shadow Pursuit cancels the ticks of the last one */
  meowSrc: number
}

/** Actual enemy aura, retaining the flask's original element at the front of its priority. */
function absorbedElement(
  c: SimContext,
  preferred?: AbsorbEle
): AbsorbEle | undefined {
  if (c.target.distance > c.target.radius + 5) return undefined
  const ele = c.absorb(
    preferred
      ? [preferred, ...absorbEles.filter((e) => e !== preferred)]
      : absorbEles
  )
  return ele && absorbEles.includes(ele as AbsorbEle)
    ? (ele as AbsorbEle)
    : undefined
}
const cancelFrames = {
  normal: 43,
  charged: 42,
  burst: 42,
  dash: 41,
  jump: 48,
  swap: 41,
  skill: 48,
  wait: 44,
}
function pursuitFrames(
  s: JahodaState,
  src: number,
  next?: keyof typeof cancelFrames
) {
  const drain =
    s.pursuit === src ? Math.min(s.nextFill + 4, src + 364) : s.drainAt
  return drain - src + (next ? (cancelFrames[next] ?? 48) : 48)
}
/** C1 bounces accumulate 50% probability, preserving real hits and ICD applications. */
function meowTick(
  c: SimContext,
  s: JahodaState,
  src: number,
  end: number,
  ele: AbsorbEle
) {
  if (src !== s.meowSrc || c.now >= end) return
  c.hit(MEOWBALL_TRAVEL, {
    characterKey: 'Jahoda',
    path: ['skill', meowNode[ele]],
    tag: 'skill',
    element: ele,
    applies: true,
    icd: 'none',
    label: 'Meowball',
  })
  if (c.constellation('Jahoda') >= 1) s.bounceCredit += 0.5
  if (s.bounceCredit >= 1) {
    s.bounceCredit--
    c.hit(MEOWBALL_TRAVEL + 45, {
      characterKey: 'Jahoda',
      path: ['skill', meowNode[ele]],
      tag: 'skill',
      element: ele,
      applies: true,
      icd: 'Jahoda_Constellation_1',
      icdGroup: 'JahodaCons',
      label: 'Meowball (C1 bounce)',
    })
  }
  c.at(116, (c2) => meowTick(c2, s, src, end, ele))
}

/** The pursuit ends with a full flask: Filled Treasure Flask (2 frames after the drain) */
function fullDrain(c: SimContext, s: JahodaState, src: number) {
  if (s.pursuit !== src) return
  s.pursuit = -1
  s.drainAt = c.now
  c.setCooldown('skill', 930, 'Jahoda')
  const full = s.gauge >= 100
  c.hit(full ? 2 : 4, {
    characterKey: 'Jahoda',
    path: ['skill', full ? 'filledDmg' : 'unfilledDmg'],
    tag: 'skill',
    element: 'anemo',
    applies: true,
    icd: 'skill',
    label: full ? 'Filled Treasure Flask' : 'Unfilled Treasure Flask',
  })
  if (full && c.moonsign >= 2 && s.flaskEle) {
    if (c.constellation('Jahoda') >= 6)
      c.buff('Jahoda', ['Jahoda', 'c6FlaskFull'], 'on', 0, 20 * 60, {
        hitlag: 'recipient',
      })
    // Ascendant Gleam: Meowball ticks from 129 frames after the drain, every 116 frames, while
    // its 1173 frames last
    const end = c.now + 1173
    const token = c.now
    s.meowSrc = token
    const ele = s.flaskEle
    c.at(129, (c2) => meowTick(c2, s, token, end, ele))
  }
}

export const kit: KitModel = {
  characterKey: 'Jahoda',
  moonsign: 1,
  element: 'anemo',
  source: `${KQMSIM}/jahoda`,
  init: (): JahodaState => ({
    pursuit: -1,
    flaskEle: undefined,
    gauge: 0,
    nextFill: -1,
    drainAt: -1e9,
    bounceCredit: 0,
    meowSrc: -1,
    burstToken: 0,
  }),
  onStart(ctx) {
    if (ctx.constellation('Jahoda') >= 1)
      ctx.note(
        'Jahoda: C1 bounce probability is accumulated for reproducible single-target hits. Energy refunds and multiple enemies are not validated.'
      )
  },
  // E again during Shadow Pursuit drains the Treasure Flask early (its own frames)
  variant(_ctx, s: JahodaState, action) {
    return action.kind === 'skill' && s.pursuit >= 0
      ? {
          key: 'drain',
          label: 'Drain the Treasure Flask',
          mode: 'Shadow Pursuit',
        }
      : undefined
  },
  act(ctx, s: JahodaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          jahodaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d + TRAVEL, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // Fully-Charged Aimed Shot (the arrow lands 10 frames after its hitmark)
        ctx.hit(85 + TRAVEL, {
          path: ['charged', 'fullyAimed'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 85 }
      case 'skill': {
        if (s.pursuit >= 0) {
          fullDrain(ctx, s, s.pursuit)
          return { frames: 48, framesInto: cancelFrames }
        }
        const src = ctx.now
        s.pursuit = src
        s.flaskEle = undefined
        s.gauge = 0
        s.meowSrc = -1
        s.nextFill = src + 37
        const fill = (at: SimContext) => {
          if (s.pursuit !== src) return
          const ele = absorbedElement(at, s.flaskEle)
          if (ele) {
            s.gauge += !s.flaskEle || ele === s.flaskEle ? 20 : 10
            s.flaskEle ??= ele
          }
          if (s.gauge >= 100) at.at(4, (drain) => fullDrain(drain, s, src))
          else {
            s.nextFill = at.now + 30
            at.atCharacter('Jahoda', 30, fill)
          }
        }
        ctx.at(30, (at) => at.atCharacter('Jahoda', 7, fill))
        ctx.at(364, (at) => fullDrain(at, s, src))
        const initial = {
          frames: 89,
          framesInto: {
            ...Object.fromEntries(
              Object.entries(cancelFrames).map(([kind, frames]) => [
                kind,
                41 + frames,
              ])
            ),
            skill: 42,
            // gcsim's CanQueueAfter: a written wait starts at 41 while the pursuit goes on (the
            // action after it still waits for the pursuit: actionReadyAt)
            wait: 41,
          },
        }
        // E -> E can drain early. Every other action waits for actual aura-dependent filling.
        return {
          ...initial,
          duration: (next) =>
            next === 'skill'
              ? 42
              : next === 'wait'
                ? 41
                : pursuitFrames(s, src, next as keyof typeof cancelFrames),
        } as ActionResult
      }
      case 'burst': {
        ctx.hit(43, {
          characterKey: 'Jahoda',
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Hidden Aces: Seven Tools of the Hunter',
        })
        const token = ++s.burstToken
        for (let i = 0; i < 778; i += 87)
          ctx.at(12 + i, (c) => {
            if (token !== s.burstToken) return
            const healthy =
              !c.healthTracked || (c.hpRatio(c.onField) ?? 0) > 0.7
            if (healthy) {
              c.buff('Jahoda', ['Jahoda', 'a4Heal'], 'on', 0, 360, {
                recipient: c.onField,
                hitlag: 'recipient',
              })
              c.buff('Jahoda', ['Jahoda', 'a4Recipient'], 'on', 0, 360, {
                recipient: c.onField,
                hitlag: 'recipient',
              })
              if (c.healthTracked) {
                const lowest = c.members
                  .filter((m) => (c.hpRatio(m) ?? 0) > 0)
                  .reduce(
                    (low, m) =>
                      (c.hpRatio(m) ?? 1) < (c.hpRatio(low) ?? 1) ? m : low,
                    c.members[0]
                  )
                c.hit(0, {
                  path: ['_heal', 'burst', 'lowestHeal'],
                  tag: 'other',
                  element: 'anemo',
                  healTargets: [lowest],
                  label: 'Purrsonal Assistance (Additional Heal)',
                })
              }
            }
            c.hit(0, {
              path: ['_heal', 'burst', 'robotHeal'],
              tag: 'other',
              element: 'anemo',
              label: 'Purrsonal Assistance (Heal)',
            })
          })
        if (ctx.moonsign >= 2) {
          // the robots: 2, +1 for an Electro A1 (the highest element), every 140 frames (126 for
          // a Cryo A1); C2 gives the second element the same. Each robot attacks 41 frames after
          // it absorbs (6 + 41 per robot) and the burst lasts 790 frames
          const ranked = absorbEles
            .filter((e) => ctx.partyCount(e) > 0)
            .sort((a, b) => ctx.partyCount(b) - ctx.partyCount(a))
          const a1: AbsorbEle | undefined = ranked[0]
          const c2: AbsorbEle | undefined =
            ctx.constellation('Jahoda') >= 2 ? ranked[1] : undefined
          let robots = 2
          let interval = 140
          for (const e of [a1, c2]) {
            if (e === 'electro') robots++
            if (e === 'cryo') interval = 126
          }
          const robotAttack = (
            at: SimContext,
            ele: AbsorbEle,
            snapshot: NonNullable<SimHit['statSnapshots']>[number]
          ) => {
            if (token !== s.burstToken || at.now >= end) return
            at.hit(0, {
              characterKey: 'Jahoda',
              path: ['burst', robotNode[ele]],
              tag: 'burst',
              element: ele,
              applies: true,
              statSnapshots: [snapshot],
              icd: `JahodaBurst_${ele}`,
              icdGroup: 'JahodaBurst',
              label: 'Purrsonal Coordinated Assistance Robot',
            })
            at.at(interval, (again) => robotAttack(again, ele, snapshot))
          }
          const absorbRobot = (at: SimContext) => {
            if (token !== s.burstToken || at.now >= end) return
            const ele = absorbedElement(at)
            if (!ele) at.at(Math.trunc(interval / 3), absorbRobot)
            else
              at.at(41, (attack) =>
                robotAttack(attack, ele, {
                  stat: 'atk',
                  path: ['total', 'atk'],
                  t: at.now,
                  onField: at.onField,
                })
              )
          }
          const end = ctx.now + 790
          for (let r = 0; r < robots; r++) ctx.at(6 + 41 * r, absorbRobot)
        }
        return {
          cooldown: { key: 'burst', frames: 1080, delay: 1 },
          frames: 55,
          framesInto: { normal: 48, skill: 53, dash: 54, jump: 54, swap: 36 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Jahoda
        ctx.note(
          'Jahoda: the plunging attack is not modelled (gcsim has none).'
        )
        return { frames: 30 }
      case 'dash':
        // (the default length for a body type not known here)
        return { frames: 20, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('girl', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // After a wait inside the pursuit, her next action (other than the draining E) still waits for
  // the pursuit to end and its cancel (gcsim's Frames: pursuit duration + cancel)
  actionReadyAt: (ctx, s: JahodaState, action) => {
    if (action.kind === 'skill' || action.kind === 'wait') return ctx.now
    const cancel =
      cancelFrames[action.kind as keyof typeof cancelFrames] ??
      cancelFrames.skill
    if (s.pursuit >= 0) return Math.max(ctx.now + 1, s.nextFill)
    return Math.max(ctx.now, s.drainAt + cancel)
  },
  // A second Elemental Skill during the pursuit is the drain: no wait for the cooldown then
  cooldownKey: (s: JahodaState, action) => {
    if (action.kind === 'burst') return 'burst'
    if (action.kind !== 'skill') return undefined
    return s.pursuit >= 0 ? undefined : 'skill'
  },
}
