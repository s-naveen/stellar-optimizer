import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { RotationAction } from '../parse'
import type {
  ActionResult,
  KitModel,
  NormalStateStart,
  SimContext,
} from '../types'
import {
  atkSpdAdjust,
  GCSIM,
  type NormalHit,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/skirk, main as of 2026-11-10. */

/*
 * Assumptions: Serpent's Subtlety starts at 100 (gcsim's default); A1 and A4 are unlocked (the sim
 * has no ascension); the hold E has its minimum length (the rotation gives no hold time). As for
 * every burst here (gcsim's ignore_burst_energy), Havoc: Ruin is cast even below 50 Subtlety.
 * Not modelled: plunges (gcsim has none) and C6's damage-taken trigger (the enemy does not attack).
 */

const skirkNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [2],
    toNormal: 19,
    toCharged: 20,
    toAbil: 13,
    frames: 27,
  },
  {
    hitmarks: [5],
    hitlag: [2],
    toNormal: 18,
    toCharged: 21,
    toAbil: 7,
    frames: 25,
  },
  {
    hitmarks: [6, 20],
    hitlag: [2, 0],
    toNormal: 37,
    toCharged: 30,
    toAbil: 22,
    frames: 43,
  },
  {
    hitmarks: [9],
    hitlag: [3],
    toNormal: 19,
    toCharged: 20,
    toAbil: 11,
    frames: 23,
  },
  {
    hitmarks: [33],
    hitlag: [4],
    toNormal: 67,
    toCharged: 48,
    toAbil: 35,
    frames: 72,
  },
]

/** The Seven-Phase Flash's normal attacks (Cryo) */
const skirkSkillNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [2],
    toNormal: 12,
    toCharged: 13,
    toAbil: 12,
    frames: 30,
  },
  {
    hitmarks: [11],
    hitlag: [2],
    toNormal: 21,
    toCharged: 12,
    toAbil: 11,
    frames: 43,
  },
  {
    hitmarks: [11, 23],
    hitlag: [2, 0],
    toNormal: 31,
    toCharged: 34,
    toAbil: 23,
    frames: 42,
  },
  {
    hitmarks: [11, 27],
    hitlag: [2, 0],
    toNormal: 33,
    toCharged: 40,
    toAbil: 27,
    frames: 60,
  },
  {
    hitmarks: [25],
    hitlag: [4],
    toNormal: 51,
    toCharged: 42,
    toAbil: 25,
    frames: 72,
  },
]

/** The Seven-Phase Flash lasts 754 frames; Serpent's Subtlety drains 7 per second in it */
const FLASH_FRAMES = 754
const SS_DRAIN = 7 / 60
const A4_FRAMES = 20 * 60
/** gcsim's N1 windup, skipped out of a normal attack (and, outside the flash, out of the burst) */
const WINDUP = 2

/** A1: Void Rifts last 1054 frames, at most 3, one per 2.5 s */
const RIFT_FRAMES = 1054
const RIFT_ICD = 150
const RIFT_MAX = 3
/** Each absorbed rift: +8 Subtlety, and pauses the drain for 2 ticks of 0.15 s (max 6 ticks) */
const RIFT_SS = 8
const PAUSE_TICK = 9
const PAUSE_MAX = 6
/** Havoc: Extinction's animation absorbs rifts created during it */
const EXTINCTION_ANIM = 41
/** C6: Havoc: Sever stacks last 15 s (max 3); the flash N3/N5 trigger has a 0.2 s (+2f) ICD */
const C6_FRAMES = 15 * 60
const C6_ICD = 14
/** Reactions that create a Void Rift (Cryo Crystallize: a crystallize of Cryo) */
const RIFT_REACTIONS = [
  'frozen',
  'superconduct',
  'stellarConduct',
  'cryoSwirl',
  'stellarSwirl',
]

interface SkirkState {
  /** Serpent's Subtlety at `ssAt`; it drains while the Seven-Phase Flash lasts (to `skillEnd`) */
  ss: number
  ssAt: number
  /** The Seven-Phase Flash runs from `skillFrom` to `skillEnd` (exclusive) */
  skillFrom: number
  skillEnd: number
  /** The flash is on (until its exit), and the running flash's id (its exit timer) */
  flashOn: boolean
  flashGen: number
  /** The last normal attack was in the flash, and its last step's index */
  prevNASkill: boolean
  prevNAIndex: number
  /** A4: each party member's stack runs until this frame */
  a4Until: Record<string, number>
  /** A1: the Void Rifts on the field (their creation frames), and the creation ICD */
  rifts: number[]
  riftIcdUntil: number
  /** Rifts created before this frame are absorbed at once (Extinction's or hold E's animation) */
  absorbAnimUntil: number
  /**
   * Havoc: Extinction's "All Shall Wither": its rift count (the Normal Attack bonus), its end (the
   * flash's end or 12.5 s), the hits left (10) and its 0.1 s ICD; and the C2 window's id
   */
  extinctionVoids: number
  extinctionUntil: number
  extinctionLeft: number
  extinctionIcdUntil: number
  c2Gen: number
  /** C6: Havoc: Sever stacks (their gain frames), and the flash N3/N5 trigger's ICD */
  sever: number[]
  severIcdUntil: number
}

const inFlash = (s: SkirkState, t: number) => t >= s.skillFrom && t < s.skillEnd

/** Serpent's Subtlety at frame t */
const ssNow = (s: SkirkState, t: number) => {
  if (s.skillEnd <= s.ssAt || t < s.ssAt) return s.ss
  if (t >= s.skillEnd) return 0
  return Math.max(0, s.ss - SS_DRAIN * (t - s.ssAt))
}

/** The flash ends (Subtlety out, its 754 frames, or a swap-out): 8 s cooldown, Subtlety drained */
function exitFlash(c: SimContext, s: SkirkState) {
  if (!s.flashOn) return
  s.flashOn = false
  s.skillEnd = Math.min(s.skillEnd, c.now)
  s.ss = 0
  s.ssAt = c.now
  s.flashGen++
  c.setCooldown('skill', 8 * 60, 'Skirk')
  // C2's ATK and Extinction's "All Shall Wither" end with the flash
  s.c2Gen++
  c.state('Skirk', ['Skirk', 'c2AfterBurst'], '')
  s.extinctionUntil = Math.min(s.extinctionUntil, c.now)
}

/** The flash's exit timer: rechecks the end, which absorbed rifts can push back */
function flashTimer(c: SimContext, s: SkirkState, gen: number) {
  if (s.flashGen !== gen) return
  if (c.now >= s.skillEnd) exitFlash(c, s)
  else c.at(s.skillEnd - c.now, (c2) => flashTimer(c2, s, gen))
}

/** Absorb every live Void Rift (A1): Subtlety, a drain pause, C1 blades and C6 stacks per rift */
function absorbRifts(c: SimContext, s: SkirkState) {
  const count = s.rifts.filter((t) => t + RIFT_FRAMES >= c.now).length
  s.rifts = []
  onAbsorb(c, s, count)
  return count
}

function onAbsorb(c: SimContext, s: SkirkState, count: number) {
  if (count <= 0) return
  const cons = c.constellation('Skirk')
  const flash = inFlash(s, c.now)
  const ss = Math.min(100, ssNow(s, c.now) + RIFT_SS * count)
  // the drain is paused while the pause ticks last (approximated as one block from now)
  const paused = flash ? Math.max(0, s.ssAt - c.now) : 0
  const ticks = Math.min(PAUSE_MAX, Math.ceil(paused / PAUSE_TICK) + 2 * count)
  s.ss = ss
  s.ssAt = c.now + (flash ? ticks * PAUSE_TICK : 0)
  if (flash)
    s.skillEnd = Math.min(
      s.skillFrom + FLASH_FRAMES,
      s.ssAt + Math.ceil(ss / SS_DRAIN)
    )
  for (let i = 0; i < count; i++) {
    // C1: a crystal blade per rift (500% ATK, Charged Attack DMG)
    if (cons >= 1)
      c.hit(3, {
        path: ['constellation1', 'dmg'],
        tag: 'charged',
        element: 'cryo',
        applies: true,
        durability: 25,
        icd: 'SkirkCons',
        label: 'Far to Fall (C1)',
      })
    // C6: a Havoc: Sever stack per rift (max 3, 15 s each)
    if (cons >= 6) {
      s.sever.push(c.characterFrame('Skirk'))
      if (s.sever.length > 3) s.sever.shift()
    }
  }
}

const liveSever = (c: SimContext, s: SkirkState) => {
  const now = c.characterFrame('Skirk')
  s.sever = s.sever.filter((t) => t + C6_FRAMES >= now)
  return s.sever.length
}

/**
 * Skirk's normal string (gcsim's Attack / AttackSkill): N1's 2 frames of windup are skipped out of
 * a normal attack (outside the flash also out of the burst); outside the flash its hit stays put.
 * Hits are character tasks, so an earlier hit's hitlag delays the later ones.
 */
function skirkString(
  ctx: SimContext,
  s: SkirkState,
  flash: boolean,
  count: number,
  previous: RotationAction | undefined
): ActionResult {
  const table = flash ? skirkSkillNormals : skirkNormals
  const n = Math.max(1, count)
  const first = ctx.normalSequence(table.length, n)
  const normalStarts: NormalStateStart[] = []
  let start = 0
  let last: ActionResult = { frames: 0 }
  for (let step = 0; step < n; step++) {
    const i = (first + step) % table.length
    const remove =
      i === 0 &&
      (step > 0 ||
        previous?.kind === 'normal' ||
        (!flash && previous?.kind === 'burst'))
        ? WINDUP
        : 0
    normalStarts.push({ offset: start, index: i })
    const hit = table[i]
    const hitShift = flash ? remove : 0
    const hitmarks = hit.hitmarks.map((h) => h - hitShift)
    let pause = 0
    hitmarks.forEach((h, j) => {
      const at = start + h + pause
      ctx.hit(at, {
        path: [flash ? 'skill' : 'normal', `${i}`],
        tag: 'normal',
        element: flash ? 'cryo' : 'physical',
        applies: true,
        icd: 'normal',
        label: `${flash ? 'Flash ' : ''}N${i + 1}`,
      })
      if (flash && cs6Step(i)) ctx.at(at, (c2) => severOnHit(c2, s))
      if (hit.hitlag?.[j])
        ctx.hit(at, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: hit.hitlag[j],
          label: 'Melee hitlag',
        })
      pause += hit.hitlag?.[j] ?? 0
    })
    const speed = ctx.normalAttackSpeed?.(step > 0) ?? ctx.attackSpeed
    const adj = (f: number) => Math.max(0, atkSpdAdjust(f, speed) - remove)
    last = withHitlag(
      {
        frames: adj(hit.frames),
        framesInto: {
          normal: adj(hit.toNormal),
          charged: adj(hit.toCharged),
          skill: adj(hit.toAbil),
          burst: adj(hit.toAbil),
          dash: adj(hit.toAbil),
          jump: adj(hit.toAbil),
          swap: adj(hit.toAbil),
          // gcsim's CanQueueAfter: the last hitmark in its own table (= toAbil), not adjusted
          wait: hit.toAbil - remove,
        },
      },
      { ...hit, hitmarks }
    )
    if (step < n - 1) start += last.framesInto!.normal!
  }
  s.prevNASkill = flash
  s.prevNAIndex = (first + n - 1) % table.length
  return {
    normalStarts,
    frames: start + last.frames,
    framesInto: Object.fromEntries(
      Object.entries(last.framesInto!).map(([k, v]) => [k, start + v!])
    ),
  }
}

/** C6: flash N3 and N5 hits consume a Havoc: Sever stack for 3 coordinated attacks */
const cs6Step = (i: number) => i === 2 || i === 4

function severOnHit(c: SimContext, s: SkirkState) {
  if (c.constellation('Skirk') < 6) return
  const now = c.characterFrame('Skirk')
  // (gcsim pops a stack before its ICD check, so N3's 2nd hit wastes one; the game text spends
  // one stack per N3 / N5: the ICD is checked first here)
  if (now < s.severIcdUntil) return
  if (!liveSever(c, s)) return
  s.sever.shift()
  s.severIcdUntil = now + C6_ICD
  for (const d of [3, 6, 9])
    c.hit(d, {
      path: ['constellation6', 'normalDmg'],
      tag: 'normal',
      element: 'cryo',
      applies: true,
      durability: 25,
      icd: 'normal',
      label: 'Havoc: Sever (Normal, C6)',
    })
}

export const kit: KitModel = {
  characterKey: 'Skirk',
  element: 'cryo',
  source: `${GCSIM}/skirk`,
  init: (): SkirkState => ({
    ss: 100,
    ssAt: 0,
    skillFrom: -1e9,
    skillEnd: -1e9,
    flashOn: false,
    flashGen: 0,
    prevNASkill: false,
    prevNAIndex: 0,
    a4Until: {},
    rifts: [],
    riftIcdUntil: -1e9,
    absorbAnimUntil: -1e9,
    extinctionVoids: 0,
    extinctionUntil: -1e9,
    extinctionLeft: 0,
    extinctionIcdUntil: -1e9,
    c2Gen: 0,
    sever: [],
    severIcdUntil: -1e9,
  }),
  act(ctx, s: SkirkState, action, previous) {
    const now = ctx.now
    const c = ctx.constellation('Skirk')
    switch (action.kind) {
      case 'normal':
        return skirkString(ctx, s, inFlash(s, now), action.count ?? 1, previous)
      case 'charged': {
        // in the flash, or right after a flash N1-N4 (gcsim: still in the normal attack state)
        const flashCA =
          inFlash(s, now) ||
          (previous?.kind === 'normal' && s.prevNASkill && s.prevNAIndex < 4)
        if (flashCA) {
          for (const d of [28, 37, 46]) {
            ctx.hit(d, {
              path: ['skill', 'chargedDmg'],
              tag: 'charged',
              element: 'cryo',
              applies: true,
              icd: 'ExtraAttack',
              label: 'Flash Charged Attack',
            })
            // A1: a flash CA hit absorbs the Void Rifts
            ctx.at(d, (c2) => absorbRifts(c2, s))
          }
          return {
            frames: 54,
            framesInto: {
              charged: 53,
              burst: 43,
              dash: 27,
              jump: 28,
              swap: 42,
            },
          }
        }
        for (const d of [27, 34])
          ctx.hit(d, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'ExtraAttack',
            label: 'Charged Attack',
          })
        return {
          frames: 53,
          framesInto: {
            normal: 43,
            charged: 43,
            skill: 43,
            burst: 43,
            dash: 27,
            jump: 28,
            swap: 42,
          },
        }
      }
      case 'skill': {
        if (inFlash(s, now))
          return {
            frames: 0,
            failed: 'Skirk: Havoc: Warp cannot be used in Seven-Phase Flash',
          }
        if (action.hold) {
          // Hold E: no flash, +45 (+10 at C2) 18 frames in, and the rifts are absorbed then; 8 s
          // cooldown (no damage in gcsim)
          ctx.at(18, (c2) => {
            s.ss = Math.min(100, ssNow(s, c2.now) + 45 + (c >= 2 ? 10 : 0))
            s.ssAt = c2.now
            absorbRifts(c2, s)
          })
          return {
            cooldown: { key: 'skill', frames: 8 * 60, delay: 18 },
            frames: 18,
            framesInto: { swap: 15 },
          }
        }
        // Seven-Phase Flash (tap): +45 Serpent's Subtlety (+10 at C2) 19 frames in, then the flash
        // lasts until the Subtlety runs out or 754 frames. Its cooldown starts when it ends.
        // (Seven-Phase Flash has no damage of its own)
        ctx.at(19, (c2) => {
          const ss = Math.min(100, ssNow(s, c2.now) + 45 + (c >= 2 ? 10 : 0))
          s.ss = ss
          s.ssAt = c2.now
          s.skillFrom = c2.now
          s.skillEnd = c2.now + Math.min(FLASH_FRAMES, Math.ceil(ss / SS_DRAIN))
          s.flashOn = true
          const gen = ++s.flashGen
          c2.at(s.skillEnd - c2.now, (c3) => flashTimer(c3, s, gen))
        })
        return {
          frames: 43,
          framesInto: {
            normal: 21,
            charged: 21,
            burst: 31,
            dash: 29,
            jump: 30,
            swap: 29,
            wait: 21,
          },
        }
      }
      case 'burst': {
        if (inFlash(s, now)) {
          // Havoc: Extinction: absorbs the rifts (also those created in its animation); the next
          // 10 normal attack hits get a DMG bonus by the rift count (onBeforeHit).
          // C2: +70% ATK 39 frames later for 12.5 s, ended with the flash
          s.extinctionVoids = absorbRifts(ctx, s)
          s.absorbAnimUntil = now + EXTINCTION_ANIM
          s.extinctionUntil = now + 750
          s.extinctionLeft = 10
          ctx.at(39, (c2) => {
            if (c >= 2 && inFlash(s, c2.now)) {
              const gen = ++s.c2Gen
              c2.state('Skirk', ['Skirk', 'c2AfterBurst'], 'on')
              c2.at(750, (c3) => {
                if (s.c2Gen === gen)
                  c3.state('Skirk', ['Skirk', 'c2AfterBurst'], '')
              })
            }
          })
          return {
            cooldown: { key: 'burst', frames: 15 * 60 },
            frames: 41,
            framesInto: {
              normal: 39,
              charged: 39,
              dash: 40,
              jump: 40,
              swap: 39,
            },
          }
        }
        // Havoc: Ruin: each point of Serpent's Subtlety above 50 (max 12, 22 at C2) adds to the
        // hits (the sheet's burstSerpentOver state, for the 160 frames of the Ruin)
        const cur = ssNow(s, now)
        if (cur < 50)
          ctx.note(
            "Skirk: Havoc: Ruin was cast below 50 Serpent's Subtlety (bursts ignore their cost here, as gcsim's ignore_burst_energy)."
          )
        const over = Math.floor(
          Math.min(Math.max(cur - 50, 0), 12 + (c >= 2 ? 10 : 0))
        )
        if (over > 0)
          ctx.buff('Skirk', ['Skirk', 'burstSerpentOver'], `${over}`, 0, 160)
        for (const d of [109, 111, 114, 125, 135])
          ctx.hit(d, {
            path: ['burst', 'skillDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Havoc: Ruin (Slash)',
          })
        ctx.hit(158, {
          path: ['burst', 'finalDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          icd: 'burst',
          label: 'Havoc: Ruin (Final Slash)',
        })
        // C6: every Havoc: Sever stack is spent for a 750% ATK coordinated attack
        if (c >= 6) {
          const stacks = liveSever(ctx, s)
          s.sever = []
          for (let i = 0; i < stacks; i++)
            ctx.hit(12, {
              path: ['constellation6', 'burstDmg'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              durability: 25,
              icd: 'burst',
              label: 'Havoc: Sever (Burst, C6)',
            })
        }
        // the Subtlety is spent 7 frames in
        ctx.at(7, (c2) => {
          s.ss = 0
          s.ssAt = c2.now
        })
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 151,
          framesInto: {
            normal: 100,
            charged: 102,
            skill: 102,
            dash: 102,
            jump: 102,
            swap: 101,
          },
        }
      }
      case 'plunge':
        ctx.note('Skirk: plunging attacks are not in gcsim; not modelled')
        return { frames: 30 }
      case 'dash':
        // template dash (Girl body), or the flash's dash (11 frames)
        return inFlash(s, now)
          ? { frames: 11, framesInto: { jump: 4 } }
          : { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Girl body): 34 frames after a dash, else 31
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onBeforeHit(ctx, s: SkirkState, hit) {
    // "All Shall Wither": every 0.1 s (her clock), a Normal Attack hit gets the Extinction's DMG
    // bonus for the rifts it absorbed, 10 times, until the flash ends or 12.5 s
    if (hit.characterKey !== 'Skirk' || hit.tag !== 'normal') return
    if (hit.t >= s.extinctionUntil || s.extinctionLeft <= 0) return
    const now = ctx.characterFrame('Skirk')
    if (now < s.extinctionIcdUntil) return
    s.extinctionIcdUntil = now + 6
    s.extinctionLeft--
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Skirk',
        path: ['Skirk', 'burstVoidAbsorb'],
        value: `${Math.min(3, s.extinctionVoids)}`,
      },
    ]
  },
  onHit(ctx, s: SkirkState, hit) {
    // A1: Frozen, Superconduct, Stellar-Conduct, Cryo Swirl, Stellar Swirl and Cryo Crystallize
    // reactions by the party create a Void Rift (2.5 s ICD on her clock, max 3 on the field).
    // One created in Extinction's animation is absorbed at once.
    if (hit.path[0] === '_reaction') {
      const r = hit.path[1]
      if (
        !RIFT_REACTIONS.includes(r) &&
        !(r === 'crystallize' && hit.element === 'cryo')
      )
        return
      const now = ctx.characterFrame('Skirk')
      if (now < s.riftIcdUntil) return
      s.riftIcdUntil = now + RIFT_ICD
      if (hit.t < s.absorbAnimUntil) {
        onAbsorb(ctx, s, 1)
        s.extinctionVoids = Math.min(3, s.extinctionVoids + 1)
        return
      }
      s.rifts.push(hit.t)
      if (s.rifts.length > RIFT_MAX) s.rifts.shift()
      return
    }
    // A4: a Hydro member's Hydro hit or another Cryo member's Cryo hit gives a stack for 20 s
    // (the sheet counts stacks as overlapping windows, so each member's stack is one run of
    // windows)
    if (hit.characterKey === 'Skirk' || (hit.path[0]?.startsWith('_') ?? false))
      return
    if (hit.element !== 'cryo' && hit.element !== 'hydro') return
    if (getCharEle(hit.characterKey) !== hit.element) return
    const end = s.a4Until[hit.characterKey] ?? -1e9
    if (hit.t >= end)
      ctx.buff('Skirk', ['Skirk', 'a4DeathStacks'], '1', 0, A4_FRAMES)
    else
      ctx.buff(
        'Skirk',
        ['Skirk', 'a4DeathStacks'],
        '1',
        end - hit.t,
        hit.t + A4_FRAMES - end
      )
    s.a4Until[hit.characterKey] = Math.max(end, hit.t + A4_FRAMES)
  },
  onSwapOut(ctx: SimContext, s: SkirkState) {
    // leaving the field ends the flash (its Subtlety is drained)
    exitFlash(ctx, s)
  },
}
