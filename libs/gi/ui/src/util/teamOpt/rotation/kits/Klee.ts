import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/klee. */

/**
 * A normal hit, with its swap cancel (normalString gives skill, burst, dash and jump the same
 * one as toAbil)
 */
interface KleeNormal extends NormalHit {
  swap: number
}

/** Hits include the 10-frame travel of the damage */
const kleeNormals: KleeNormal[] = [
  {
    hitmarks: [25],
    toNormal: 23,
    toCharged: 23,
    toAbil: 6,
    frames: 34,
    swap: 15,
  },
  {
    hitmarks: [31],
    toNormal: 27,
    toCharged: 25,
    toAbil: 2,
    frames: 41,
    swap: 21,
  },
  {
    hitmarks: [44],
    toNormal: 46,
    toCharged: 47,
    toAbil: 34,
    frames: 72,
    swap: 34,
  },
]

/** Native applies hitmark lag to every normal, but cancel lag only to N1. */
const kleeNormalsLag: KleeNormal[] = kleeNormals.map((hit, i) => ({
  ...hit,
  hitmarks: hit.hitmarks.map((t) => t + 9),
  ...(i === 0
    ? {
        toNormal: hit.toNormal + 9,
        toCharged: hit.toCharged + 9,
        frames: hit.frames + 9,
        swap: hit.swap + 9,
      }
    : {}),
}))

/** Sparks'n'Splash waves, from the burst's start */
const kleeWaves = [186, 294, 401, 503, 610, 718]

interface KleeState {
  badges: Partial<Record<string, number>>
  normalCounter: number
  /** The burst's end (undefined: not bursting; leaving the field ends it) */
  burstEnd?: number
  sparks: number
  sparkUntil: number
  sparkReady: number
  /** C1: the chance of the next roll (10%, +8% per failure) */
  c1Chance: number
}

/** Hexerei: Secret Rite (2 Hexerei members) */
const secretRite = (ctx: SimContext) =>
  ctx.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length >= 2

/**
 * C1 (Chained Reactions): a roll on each normal attack, charged attack, Jumpy Dumpty and burst;
 * a hit summons a spark (120% of a Sparks'n'Splash hit) `delay` frames later, snapshotted now.
 * Hexerei: Klee's ATK +60% for 12 s (the sheet's lockC1, gated on her Witch's Homework).
 */
function c1(ctx: SimContext, s: KleeState, delay: number) {
  if (ctx.constellation('Klee') < 1) return
  if (ctx.random() > s.c1Chance) {
    s.c1Chance += 0.08
    return
  }
  s.c1Chance = 0.1
  ctx.hit(delay, {
    path: ['constellation1', 'chainedReactionsDmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    durability: 25,
    icd: 'burst',
    snapshotDelay: 0,
    label: "Sparks'n'Splash (C1)",
  })
  ctx.buff('Klee', ['Klee', 'lockC1'], 'on', 0, 720)
}

/** C4 (Sparkly Explosion): on leaving the field during the burst, or (Hexerei) at its end */
function c4(ctx: SimContext) {
  if (ctx.constellation('Klee') < 4) return
  ctx.hit(0, {
    path: ['constellation4', 'sparklyExplosionDmg'],
    tag: 'other',
    element: 'pyro',
    applies: true,
    durability: 50,
    label: 'Sparkly Explosion (C4)',
  })
}

function sparkCount(ctx: SimContext, s: KleeState) {
  if (ctx.characterFrame('Klee') >= s.sparkUntil) s.sparks = 0
  return s.sparks
}

/** The pinned native defaults to Klee's Hexerei upgrade unlocked, even in a solo party. */
function addSpark(ctx: SimContext, s: KleeState) {
  if (sparkCount(ctx, s) >= 3) return
  s.sparks++
  s.sparkUntil = ctx.characterFrame('Klee') + 1800
}

const capturedStats = (
  t: number,
  onField: SimContext['onField']
): SimHit['statSnapshots'] => [
  { stat: 'atk', path: ['total', 'atk'], t, onField },
  { stat: 'critRate_', path: ['premod', 'critRate_'], t, onField },
  { stat: 'critDMG_', path: ['premod', 'critDMG_'], t, onField },
  { stat: 'eleMas', path: ['premod', 'eleMas'], t, onField },
  { stat: 'pyro_dmg_', path: ['premod', 'pyro_dmg_'], t, onField },
]

/** A single realized burst instance; extra instances are drawn separately. */
function wave(
  c: SimContext,
  delay: number,
  weight: number,
  t: number,
  onField: SimContext['onField']
) {
  c.hit(delay, {
    path: ['burst', 'dmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    icd: 'burst',
    weight,
    label: "Sparks'n'Splash",
    statSnapshots: capturedStats(t, onField),
  })
}

/** Snapshot the charge at the native capture frame, before its projectile travels. */
function chargeHit(
  ctx: SimContext,
  s: KleeState,
  delay: number,
  coordinated: boolean
) {
  const spark = sparkCount(ctx, s) > 0
  if (spark && (ctx.constellation('Klee') < 6 || ctx.random() < 0.5)) s.sparks--
  ctx.hit(delay, {
    path: spark ? ['passive1', 'dmg'] : ['charged', 'dmg'],
    tag: 'charged',
    element: 'pyro',
    applies: true,
    blunt: true,
    poiseDamage: 180,
    label: `${spark ? 'Charged Attack (Explosive Spark)' : 'Charged Attack'}${coordinated ? ' (Coordinated)' : ''}`,
    states: [
      {
        owner: 'Klee',
        path: ['Klee', 'lockBadge'],
        value: String(
          Object.values(s.badges).filter(
            (end) => end! > ctx.characterFrame('Klee')
          ).length
        ),
      },
    ],
    statSnapshots: [
      { stat: 'atk', path: ['total', 'atk'], t: ctx.now, onField: ctx.onField },
      {
        stat: 'critRate_',
        path: ['premod', 'critRate_'],
        t: ctx.now,
        onField: ctx.onField,
      },
      {
        stat: 'critDMG_',
        path: ['premod', 'critDMG_'],
        t: ctx.now,
        onField: ctx.onField,
      },
      {
        stat: 'eleMas',
        path: ['premod', 'eleMas'],
        t: ctx.now,
        onField: ctx.onField,
      },
      {
        stat: 'pyro_dmg_',
        path: ['premod', 'pyro_dmg_'],
        t: ctx.now,
        onField: ctx.onField,
      },
    ],
  })
}

export const kit: KitModel = {
  sampled: true,
  characterKey: 'Klee',
  element: 'pyro',
  source: `${KQMSIM}/klee`,
  charges: () => ({ skill: 2 }),
  init: (): KleeState => ({
    badges: {},
    normalCounter: 0,
    sparks: 0,
    sparkUntil: -1,
    sparkReady: -1,
    c1Chance: 0.1,
  }),
  onHit(ctx, s: KleeState, hit) {
    if (hit.characterKey !== 'Klee' || hit.path[0].startsWith('_')) return
    const frame = ctx.characterFrame('Klee')
    // Only normals and Dumpty bounces have the native A1 callback. Mines do not.
    if (
      (hit.tag === 'normal' || hit.path[1] === 'jumptyDumptyDmg') &&
      frame >= s.sparkReady &&
      ctx.random() >= 0.5
    ) {
      s.sparkReady = frame + 300
      addSpark(ctx, s)
    }
    if (
      ctx.onField !== 'Klee' ||
      !['normal', 'skill', 'burst'].includes(hit.tag)
    )
      return
    if (ctx.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length < 2)
      return
    s.badges[hit.tag] = frame + 1200
  },
  act(ctx, s: KleeState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        const lag =
          previous?.kind === 'skill' ||
          previous?.kind === 'dash' ||
          previous?.kind === 'burst'
        const hits = lag ? kleeNormalsLag : kleeNormals
        const n = Math.max(1, action.count ?? 1)
        const keepCombo =
          ctx.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length >=
            2 && (s.burstEnd ?? -1) > ctx.now
        if (previous?.kind !== 'normal' && !keepCombo) s.normalCounter = 0
        const first = s.normalCounter
        const r = normalString(
          hits,
          n,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'pyro',
              applies: true,
              blunt: true,
              poiseDamage: i === 2 ? 130 : 65,
              icd: 'KleeFireDamage',
              label: `N${i + 1}`,
            })
            // C1's roll when the attack is released (its hit lands with the normal's)
            ctx.at(d - 10, (c) => c1(c, s, 10))
            // The coordinated CA (Secret Rite) checks for a Spark at the normal's start and
            // snapshots/consumes it 30 frames later. It does not occupy an action. N3 always;
            // at C6 also N1 / N2 with a 40% chance.
            if (secretRite(ctx))
              ctx.at(d - hits[i].hitmarks[0], (c) => {
                if (!sparkCount(c, s)) return
                if (
                  i !== 2 &&
                  !(c.constellation('Klee') >= 6 && c.random() < 0.4)
                )
                  return
                c.at(30, (c2) => chargeHit(c2, s, 10, true))
                c1(c, s, 20)
              })
          },
          {
            ...ctx,
            normalSequence(length, count) {
              s.normalCounter = (first + count) % length
              return first
            },
          }
        )
        const last = hits[(first + n - 1) % hits.length]
        const start = r.frames - last.frames
        r.framesInto = { ...r.framesInto, swap: start + last.swap }
        return r
      }
      case 'charged': {
        // gcsim: 14 frames of windup right after a skill, or after the 1st or 2nd hit of a string
        const windup =
          previous?.kind === 'skill' ||
          (previous?.kind === 'normal' && [1, 2].includes(s.normalCounter))
            ? 14
            : 0
        ctx.at(61 - windup, (c) => chargeHit(c, s, 25, false))
        c1(ctx, s, 86 - windup)
        return {
          frames: 113 - windup,
          framesInto: {
            normal: 59 - windup,
            charged: 59 - windup,
            skill: 59 - windup,
            burst: 59 - windup,
            dash: 31 - windup,
            jump: 30 - windup,
            swap: 104 - windup,
          },
        }
      }
      case 'skill': {
        addSpark(ctx, s)
        // gcsim's default: 1 bounce (its `bounce` param; the 2nd and 3rd bounces have no node in our
        // sheet's dmgFormulas, so they are only added with that param), and 2 mines at frame 240
        ctx.hit(71, {
          path: ['skill', 'jumptyDumptyDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'KleeFireDamage',
          label: 'Jumpy Dumpty (Bounce)',
          statSnapshots: capturedStats(ctx.now, ctx.onField),
        })
        for (let m = 0; m < 2; m++)
          ctx.hit(240, {
            path: ['skill', 'mineDmg'],
            tag: 'skill',
            element: 'pyro',
            applies: true,
            icd: 'KleeFireDamage',
            label: 'Explosive Mine',
            statSnapshots: capturedStats(ctx.now, ctx.onField),
          })
        ctx.at(33, (c) => c1(c, s, 71 - 33))
        // C2: a mine hit reduces the enemy's DEF by 23.3% for 10 s; Hexerei (assumed, gcsim's
        // default): the bounce's hit too
        if (ctx.constellation('Klee') >= 2) {
          ctx.buff('Klee', ['Klee', 'ExplosiveFrags'], 'on', 71, 10 * 60)
          ctx.buff('Klee', ['Klee', 'ExplosiveFrags'], 'on', 240, 10 * 60)
        }
        return {
          cooldown: { key: 'skill', frames: 1200, delay: 33 },
          frames: 75,
          // (the pinned kqmsim's E -> N1 is 40; upstream gcsim still has 66)
          framesInto: {
            normal: 40,
            charged: 69,
            skill: 68,
            burst: 34,
            dash: 37,
            jump: 35,
            swap: 74,
          },
        }
      }
      case 'burst': {
        // Sparks'n'Splash: 746 frames (the waves stop when Klee leaves the field)
        s.burstEnd = ctx.now + 746
        s.normalCounter = 0
        addSpark(ctx, s)
        const capturedAt = ctx.now + 100
        const capturedActive = ctx.onField
        for (const start of kleeWaves)
          ctx.at(start, (c2) => {
            if (s.burstEnd === undefined || c2.now >= s.burstEnd) return
            wave(c2, 0, 1, capturedAt, capturedActive)
            wave(c2, 12, 1, capturedAt, capturedActive)
            if (c2.random() < 0.3) wave(c2, 12, 1, capturedAt, capturedActive)
            wave(c2, 24, 1, capturedAt, capturedActive)
            if (c2.random() < 0.5) wave(c2, 24, 1, capturedAt, capturedActive)
          })
        // C6: the team's Pyro DMG +10% for 25 s (Klee's own +50% with Secret Rite, by the sheet)
        if (ctx.constellation('Klee') >= 6)
          ctx.buff('Klee', ['Klee', 'BlazingDelight'], 'on', 0, 25 * 60)
        c1(ctx, s, 99)
        // C4 (Hexerei, assumed): the explosion when the burst ends with Klee on the field
        const end = s.burstEnd
        ctx.at(746, (c2) => {
          if (s.burstEnd !== end || c2.onField !== 'Klee') return
          s.burstEnd = undefined
          c4(c2)
        })
        return {
          cooldown: { key: 'burst', frames: 15 * 60, delay: 9 },
          frames: 139,
          framesInto: {
            normal: 139,
            charged: 139,
            skill: 139,
            dash: 103,
            jump: 104,
            swap: 101,
          },
        }
      }
      case 'plunge':
        // the rotation's P is the Low Plunge (High Plunge needs a variant in the text)
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'pyro',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 67,
          framesInto: {
            normal: 57,
            charged: 53,
            skill: 58,
            burst: 47,
            dash: 47,
            jump: 66,
            swap: 50,
          },
        }
      case 'dash':
        // the template dash (Klee is a Loli): 21 frames, a jump after 4
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        // Loli: 29 frames, 37 after a dash
        return templateJump('loli', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Leaving the field ends the burst; C4: Sparkly Explosion while it was on
  onSwapOut(ctx, s: KleeState) {
    if (s.burstEnd !== undefined && ctx.now < s.burstEnd) c4(ctx)
    s.burstEnd = undefined
  },
}
