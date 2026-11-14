import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext } from '../types'
import { atkSpdAdjust, GCSIM, templateJump, withHitlag } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/itto, main as of 2026-11-10. */

/** gcsim's slash types for Charged Attacks: CA0 (Saichimonji), CA1 / CA2 (Kesagiri), CAF (final) */
const SAICHI = 0
const LEFT = 1
const RIGHT = 2
const FINAL = 3
const CA_HITMARKS = [89, 51, 24, 71]

/** The Raging Oni King (Royal Descent) state lasts 660 + 90 + 45 frames */
const BURST_DURATION = 795

interface NormalRow {
  hit: number
  toNormal: number
  toCharged: number
  toAbil: number
  frames: number
}

/** Each normal hit's poise damage (gcsim) */
const attackPoise = [82.9, 77.9, 98.3, 124.5]

/** Normal attacks with 0 Superlative Superstrength stacks (their cancels into CA0), then with 1+ (CA1/CAF) */
const ittoNormals: Record<'zero' | 'some', NormalRow[]> = {
  zero: [
    { hit: 23, toNormal: 33, toCharged: 41, toAbil: 23, frames: 41 },
    { hit: 25, toNormal: 36, toCharged: 51, toAbil: 25, frames: 51 },
    { hit: 16, toNormal: 43, toCharged: 57, toAbil: 16, frames: 57 },
    { hit: 48, toNormal: 83, toCharged: 83, toAbil: 48, frames: 83 },
  ],
  some: [
    { hit: 23, toNormal: 33, toCharged: 23, toAbil: 23, frames: 33 },
    { hit: 25, toNormal: 36, toCharged: 27, toAbil: 25, frames: 36 },
    { hit: 16, toNormal: 43, toCharged: 21, toAbil: 16, frames: 43 },
    { hit: 48, toNormal: 83, toCharged: 52, toAbil: 48, frames: 83 },
  ],
}

interface IttoState {
  /** Superlative Superstrength stacks (0-5) */
  sss: number
  /** The last Charged Attack's slash (-1: none; any other action resets it) */
  slash: number
  /** The Raging Oni King state ends at this frame of Itto's clock (inclusive; -1: not on) */
  burstEnd: number
  /** Counts Royal Descent casts: C4 goes with the latest one */
  burstSeq: number
  c4Pending: boolean
  /** Ushi: counts casts, and when the current one leaves */
  ushiSeq: number
  ushiEnd: number
  /** Stacks consumed in this Charged Attack chain (its slashes' hitlag), and A1's stacks */
  comboHits: number
  a1Stacks: number
  burstSnapshotAt: number
  /** The normal combo kept through a dash or the skill (gcsim's savedNormalCounter) */
  savedNormal: number
  /** The dash or skill state lasts until this frame (a normal attack then keeps the combo) */
  keepComboUntil: number
  /** C6: the next Charged Attack does not consume a stack (expected 50%: every other one) */
  c6Proc: boolean
  c6Chance: number
}

/** Itto is in the Raging Oni King state `d` frames from now */
const inBurst = (ctx: SimContext, s: IttoState, d = 0) =>
  ctx.characterFrame('AratakiItto') + d <= s.burstEnd

/** C6: whether the next Charged Attack keeps its stack (deterministic 50%: every other one) */
function rollC6(ctx: SimContext, s: IttoState) {
  if (ctx.constellation('AratakiItto') < 6) {
    s.c6Proc = false
    return
  }
  s.c6Chance += 0.5
  s.c6Proc = s.c6Chance >= 1 - 1e-9
  if (s.c6Proc) s.c6Chance -= 1
}

function addStacks(s: IttoState, n: number) {
  s.sss = Math.max(0, Math.min(5, s.sss + n))
}

/** The slash a Charged Attack performs next (gcsim's SlashType.Next; C6's no-consume continues) */
function nextSlash(prev: number, stacks: number, c6Proc: boolean): number {
  if (prev === LEFT || prev === RIGHT) {
    if (stacks === 1 && !c6Proc) return FINAL
    return prev === LEFT ? RIGHT : LEFT
  }
  if (stacks === 1) return c6Proc ? LEFT : FINAL
  if (stacks > 1) return LEFT
  return SAICHI
}

/** The windup skipped at the start of a Charged Attack, by what it follows (gcsim's windupFrames) */
function windupFrames(
  ctx: SimContext,
  previous: RotationAction | undefined,
  prev: number,
  cur: number
): number {
  if (previous?.kind === 'normal') {
    if (cur === SAICHI) {
      // the last normal hit: N1 14, N2 and N3 21, N4 none
      const last = (ctx.normalSequence(4, 0) + 3) % 4
      return last === 0 ? 14 : last === 1 || last === 2 ? 21 : 0
    }
    return cur === LEFT || cur === FINAL ? 10 : 0
  }
  if (previous?.kind === 'charged') {
    if (cur === SAICHI) return prev === FINAL ? 14 : 0
    if (cur === LEFT)
      return prev === SAICHI || prev === FINAL ? 17 : prev === RIGHT ? 28 : 0
    if (cur === FINAL)
      return prev === SAICHI || prev === FINAL
        ? 17
        : prev === LEFT || prev === RIGHT
          ? 25
          : 0
    return 0
  }
  if (previous?.kind === 'skill')
    return cur === SAICHI ? 14 : cur === LEFT || cur === FINAL ? 17 : 0
  if (previous?.kind === 'plunge')
    return cur === SAICHI ? 11 : cur === LEFT || cur === FINAL ? 10 : 0
  return 0
}

/** A normal attack string (up to N4). Each hit is an attack of its own: its gains come first */
function normals(
  ctx: SimContext,
  s: IttoState,
  count: number,
  continuing: boolean
): ActionResult {
  let start = 0
  let last: NormalRow = ittoNormals.zero[0]
  let lastStart = 0
  let lastSpeed = 0
  let lastLag = 9
  const n = Math.max(1, count)
  const first = ctx.normalSequence(4, n)
  for (let step = 0; step < n; step++) {
    const i = (first + step) % 4
    const burst = inBurst(ctx, s, start)
    // Superlative Superstrength: N2 +1, N4 +2, and in the Raging Oni King state N1 and N3 +1
    // (gcsim adds them as the attack starts: they decide its frames)
    if (i === 1) addStacks(s, 1)
    if (i === 3) addStacks(s, 2)
    if (burst && (i === 0 || i === 2)) addStacks(s, 1)
    const row = (s.sss > 0 ? ittoNormals.some : ittoNormals.zero)[i]
    ctx.hit(start + row.hit, {
      path: ['normal', `${i}`],
      tag: 'normal',
      element: burst ? 'geo' : 'physical',
      applies: true,
      icd: 'normal',
      blunt: true,
      poiseDamage: attackPoise[i],
      label: `N${i + 1}`,
      ...(burst
        ? {
            statSnapshots: [
              {
                stat: 'atk' as const,
                path: ['display', 'burst', 'defConv'],
                t: s.burstSnapshotAt,
                onField: 'AratakiItto' as const,
              },
            ],
          }
        : {}),
    })
    last = row
    lastStart = start
    const lag = i < 2 ? 9 : 10
    lastLag = lag
    ctx.hit(start + row.hit, {
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: lag,
      label: 'Melee hitlag',
    })
    // ATK SPD is fixed as the attack starts: the burst's +10% needs a normal attack state then
    const inNormal = step > 0 || continuing
    lastSpeed = ctx.normalAttackSpeed(inNormal) + (burst && inNormal ? 0.1 : 0)
    if (step < n - 1)
      start += Math.max(row.hit, atkSpdAdjust(row.toNormal, lastSpeed)) + lag
  }
  s.savedNormal = (first + n) % 4
  const ls = lastStart
  const cancel = (frames: number) =>
    ls + Math.max(last.hit, atkSpdAdjust(frames, lastSpeed)) + lastLag
  return {
    frames:
      ls + Math.max(last.hit, atkSpdAdjust(last.frames, lastSpeed)) + lastLag,
    framesInto: {
      normal: cancel(last.toNormal),
      charged: cancel(last.toCharged),
      skill: cancel(last.toAbil),
      burst: cancel(last.toAbil),
      dash: cancel(last.toAbil),
      jump: cancel(last.toAbil),
      swap: cancel(last.toAbil),
      // a wait queues at the hit (gcsim's CanQueueAfter), before its hitlag
      wait: ls + last.hit,
    },
  }
}

export const kit: KitModel = {
  characterKey: 'AratakiItto',
  element: 'geo',
  source: `${GCSIM}/itto`,
  init: (): IttoState => ({
    sss: 0,
    comboHits: 0,
    a1Stacks: 0,
    burstSnapshotAt: 0,
    slash: -1,
    burstEnd: -1,
    burstSeq: 0,
    c4Pending: false,
    ushiSeq: 0,
    ushiEnd: -1,
    savedNormal: 0,
    keepComboUntil: -1,
    c6Proc: false,
    c6Chance: 0,
  }),
  onStart(ctx, s: IttoState) {
    rollC6(ctx, s)
    if (ctx.constellation('AratakiItto') >= 6)
      ctx.note(
        "Itto C6: Kesagiri's 50% chance to keep its stack is taken as every other Charged Attack."
      )
  },
  act(ctx, s: IttoState, action, previous) {
    const prevSlash = s.slash
    if (action.kind !== 'charged') {
      s.slash = -1
      s.comboHits = 0
      s.a1Stacks = 0
    }
    switch (action.kind) {
      case 'normal': {
        // the combo is kept through a dash or the skill (in their state)
        if (
          (previous?.kind === 'dash' || previous?.kind === 'skill') &&
          ctx.now <= s.keepComboUntil
        )
          ctx.normalSequence(4, s.savedNormal)
        return normals(ctx, s, action.count ?? 1, previous?.kind === 'normal')
      }
      case 'charged': {
        // N4 (with no stacks) into CA0 is not allowed, nor CA0 into CA0
        if (
          previous?.kind === 'normal' &&
          ctx.normalSequence(4, 0) === 0 &&
          s.sss === 0
        )
          return {
            frames: 0,
            failed: 'Itto: no Charged Attack after N4 with no stacks',
          }
        // (the slash survives a wait: gcsim clears it on another action or a swap)
        const prev = prevSlash
        const cur = nextSlash(prev, s.sss, s.c6Proc)
        if (prev === SAICHI && cur === SAICHI)
          return {
            frames: 0,
            failed: 'Itto: Saichimonji Slash cannot follow Saichimonji Slash',
          }
        // a new Charged Attack chain (after nothing, CA0 or CAF) restarts A1 and the hitlag count
        if (prev !== LEFT && prev !== RIGHT) {
          s.comboHits = 0
          s.a1Stacks = 0
        }
        const w = windupFrames(ctx, previous, prev, cur)
        const burst = inBurst(ctx, s)
        const hitAt = CA_HITMARKS[cur] - w
        const path =
          cur === SAICHI
            ? ['charged', 'sSlash']
            : cur === FINAL
              ? ['charged', 'akFinal']
              : ['charged', 'akSlash']
        ctx.hit(hitAt, {
          path,
          tag: 'charged',
          element: burst ? 'geo' : 'physical',
          applies: true,
          icd: 'normal',
          blunt: true,
          poiseDamage:
            cur === SAICHI
              ? 120
              : cur === FINAL || s.comboHits === 0
                ? 143.4
                : 81.7,
          label:
            cur === SAICHI
              ? 'Saichimonji Slash'
              : cur === FINAL
                ? 'Arataki Kesagiri Final Slash'
                : 'Arataki Kesagiri Combo Slash',
          ...(burst
            ? {
                statSnapshots: [
                  {
                    stat: 'atk' as const,
                    path: ['display', 'burst', 'defConv'],
                    t: s.burstSnapshotAt,
                    onField: 'AratakiItto' as const,
                  },
                ],
              }
            : {}),
        })
        // the combo slashes' hitlag falls with the stacks consumed so far in the chain
        const lag =
          cur === LEFT || cur === RIGHT
            ? s.comboHits === 0
              ? 8
              : s.comboHits === 1
                ? 7
                : 6
            : 10
        // each Charged Attack spends a stack (C6: every other one keeps it)
        if (!s.c6Proc && s.sss > 0) {
          addStacks(s, -1)
          s.comboHits++
        }
        rollC6(ctx, s)
        s.slash = cur
        ctx.hit(hitAt, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: lag,
          label: 'Melee hitlag',
        })
        // A1: each combo slash adds 10% ATK SPD (3 at most) to what follows it in the chain; gcsim
        // reads the ATK SPD as the slash starts, so it counts only from a Charged Attack state.
        // The burst's +10% counts from a normal attack state
        if (cur === SAICHI) s.a1Stacks = 0
        else if (cur !== FINAL) s.a1Stacks = Math.min(3, s.a1Stacks + 1)
        const speed =
          ctx.attackSpeed +
          (previous?.kind === 'charged' ? 0.1 * s.a1Stacks : 0) +
          (previous?.kind === 'normal' && burst ? 0.1 : 0)
        const finish = (result: ActionResult) =>
          withHitlag(
            {
              ...result,
              framesInto: {
                ...Object.fromEntries(
                  Object.entries(result.framesInto ?? {}).map(
                    ([kind, frames]) => [kind, atkSpdAdjust(frames!, speed)]
                  )
                ),
                // a wait queues at the hit (CanQueueAfter, not sped up), before its hitlag
                wait: hitAt,
              },
            },
            { hitmarks: [hitAt], hitlag: [lag] }
          )
        // what the next action waits for, from the slash it leaves (the next CA depends on stacks)
        const after = nextSlash(cur, s.sss, s.c6Proc)
        switch (cur) {
          case SAICHI:
            return finish({
              frames: 131 - w,
              framesInto: {
                normal: 131 - w,
                charged: 131 - w,
                skill: 131 - w,
                burst: 131 - w,
                dash: 89 - w,
                jump: 89 - w,
                swap: 130 - w,
              },
            })
          case LEFT:
            return finish({
              frames: 104 - w,
              framesInto: {
                normal: 104 - w,
                charged: (after === FINAL ? 60 : 57) - w,
                skill: 51 - w,
                burst: 51 - w,
                dash: 51 - w,
                jump: 51 - w,
                swap: 51 - w,
              },
            })
          case RIGHT:
            return finish({
              frames: 77 - w,
              framesInto: {
                normal: 77 - w,
                charged: (after === FINAL ? 32 : 29) - w,
                skill: 24 - w,
                burst: 24 - w,
                dash: 24 - w,
                jump: 24 - w,
                swap: 24 - w,
              },
            })
          default:
            return finish({
              frames: 109 - w,
              framesInto: {
                normal: 109 - w,
                charged: 109 - w,
                skill: 76 - w,
                burst: 76 - w,
                dash: 71 - w,
                jump: 71 - w,
                swap: 76 - w,
              },
            })
        }
      }
      case 'skill': {
        // the combo is kept through the skill when it follows a normal attack or the skill
        if (previous?.kind !== 'normal' && previous?.kind !== 'skill')
          s.savedNormal = 0
        s.keepComboUntil = ctx.now + 42
        // Masatsu Zetsugi: Akaushi Burst! hits 18 frames in (14 release + 4 travel; deployable:
        // no hitlag on Itto) and Ushi appears: a Geo construct for 6 s. Ushi always hits (+1
        // stack); a Ushi it replaces leaves (+1). (Ushi taking hits needs enemy attacks)
        const id = ++s.ushiSeq
        ctx.hit(18, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          icd: 'skill',
          blunt: true,
          poiseDamage: 250,
          label: 'Masatsu Zetsugi: Akaushi Burst!',
          snapshotDelay: 14,
          ...(inBurst(ctx, s)
            ? {
                statSnapshots: [
                  {
                    stat: 'atk' as const,
                    path: ['display', 'burst', 'defConv'],
                    t: s.burstSnapshotAt,
                    onField: 'AratakiItto' as const,
                  },
                ],
              }
            : {}),
        })
        ctx.hit(18, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 0,
          enemyAnimationPause: 2,
          label: 'Ushi enemy hitlag (deployable)',
        })
        ctx.at(18, (c2) => {
          addStacks(s, 1)
          if (s.ushiEnd > c2.now) addStacks(s, 1)
          s.ushiEnd = c2.now + 6 * 60
          c2.construct(6 * 60)
        })
        // when it leaves on its own (+1), unless a later Ushi has replaced it
        ctx.at(18 + 6 * 60, () => {
          if (s.ushiSeq === id) addStacks(s, 1)
        })
        return {
          cooldown: { key: 'skill', frames: 600, delay: 14 },
          frames: 42,
          framesInto: {
            normal: 42,
            charged: 28,
            skill: 28,
            burst: 42,
            dash: 28,
            jump: 28,
            swap: 41,
          },
        }
      }
      case 'burst': {
        // Royal Descent: the Raging Oni King state for 795 frames of Itto's clock (ATK from DEF
        // at the cast, Geo infusion, ATK SPD). It has no hit of its own
        const c = ctx.constellation('AratakiItto')
        s.burstEnd = ctx.characterFrame('AratakiItto') + BURST_DURATION
        s.burstSnapshotAt = ctx.now
        const id = ++s.burstSeq
        ctx.state('AratakiItto', ['AratakiItto', 'burst'], 'on')
        s.c4Pending = c >= 4
        // the state ends (C4: nearby party members get +20% DEF and ATK for 10 s)
        ctx.atCharacter('AratakiItto', BURST_DURATION + 1, (c2) => {
          if (s.burstSeq !== id) return
          c2.state('AratakiItto', ['AratakiItto', 'burst'], '')
          c4(c2, s)
        })
        // C1: 2 stacks 75 frames in, then 1 every 0.5 s for 1.5 s
        if (c >= 1) {
          ctx.at(75, () => addStacks(s, 2))
          for (const t of [135, 165, 195]) ctx.at(t, () => addStacks(s, 1))
        }
        // C2: each Geo party member (Itto included, up to 3) cuts this cooldown by 1.5 s
        const reduce =
          c >= 2 ? Math.min(3, ctx.partyCount('geo')) * (1.5 * 60) : 0
        return {
          cooldown: { key: 'burst', frames: 18 * 60 - reduce },
          frames: 91,
          framesInto: {
            normal: 91,
            charged: 91,
            skill: 91,
            burst: 91,
            dash: 84,
            jump: 85,
            swap: 90,
          },
        }
      }
      case 'dash':
        // the combo is kept through a dash after a normal attack or the skill
        if (previous?.kind !== 'normal' && previous?.kind !== 'skill')
          s.savedNormal = 0
        s.keepComboUntil = ctx.now + 19
        // template dash (Male body): 19 frames, 3 into a jump
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // template jump (Male body): 28 frames, 37 after a dash
        return templateJump('male', 'claymore', previous, ctx)
      case 'plunge':
        // low plunge (gcsim's low_plunge, which needs an airborne state in gcsim); the optional
        // collision hit is not modelled
        ctx.hit(37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: inBurst(ctx, s, 37) ? 'geo' : 'physical',
          applies: true,
          poiseDamage: 150,
          label: 'Low Plunge',
        })
        return {
          frames: 83,
          framesInto: {
            normal: 49,
            charged: 49,
            skill: 48,
            burst: 49,
            dash: 37,
            swap: 60,
          },
        }
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: IttoState) {
    // leaving the field ends the Raging Oni King state, and C4 applies then
    s.slash = -1
    if (inBurst(ctx, s)) {
      s.burstEnd = -1
      ctx.state('AratakiItto', ['AratakiItto', 'burst'], '')
      c4(ctx, s)
    }
  },
}

/** C4: when the Raging Oni King state ends, the party gets +20% DEF and ATK for 10 s */
function c4(ctx: SimContext, s: IttoState) {
  if (!s.c4Pending) return
  s.c4Pending = false
  ctx.buff('AratakiItto', ['AratakiItto', 'constellation4'], 'on', 0, 601, {
    hitlag: 'recipient',
  })
}
