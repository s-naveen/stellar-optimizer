import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { DamageOutcome, KitModel, SimContext, SimHit } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), pinned by KQMSIM below.
 * Unlike the pinned skillPierce, consume Joy and count the three special skills.
 * See priority-coverage/reference-audits/lohen.md for unresolved source differences.
 *
 * Constellations (kqmsim cons.go, checked against the game text): C1 raises the Will cap to 300
 * and multiplies its gains by 5; C2's Evilsbane Blade (after a Masterstroke Etch or burst, 4 s
 * cooldown) makes the next Masterstroke normal or charged hit add a 500% ATK Cryo strike and give
 * the others 200 EM for 8 s; C4 maxes Will for a Masterstroke burst (its energy is not modelled);
 * C6 (once per 7 s) keeps the Will instead of consuming it, maxes Joy, and the next Etch extends
 * Masterstroke by 1.25 s. Following the text, C6 allows two more Etches in that Masterstroke
 * (kqmsim adds one per extension). The sheet gives every Etch C6's +175% CRIT DMG; a burst gets
 * it when it triggers or follows the C6 effect, as in kqmsim. */

const normals: NormalHit[] = [
  {
    hitmarks: [8],
    hitlag: [6],
    toNormal: 12,
    toCharged: 12,
    toAbil: 8,
    frames: 26,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 23,
    toCharged: 18,
    toAbil: 16,
    frames: 39,
  },
  {
    hitmarks: [13, 24, 35],
    hitlag: [4, 4, 6],
    toNormal: 37,
    toCharged: 36,
    toAbil: 35,
    frames: 55,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 30,
    toCharged: 16,
    toAbil: 10,
    frames: 46,
  },
  {
    hitmarks: [18, 38],
    hitlag: [4, 9],
    toNormal: 69,
    toCharged: 73,
    toAbil: 38,
    frames: 73,
  },
]
const nodes = [['0'], ['1'], ['2', '2', '2'], ['3'], ['4', '5']]
interface State {
  end: number
  joy: number
  joyReady: number
  skills: number
  /** Etches allowed in this Masterstroke (3; C6 adds 2) */
  maxSkills: number
  /** C2: Evilsbane Blade until, and its 4 s cooldown */
  c2Until: number
  c2Ready: number
  /** C6: the effect (18 s, for the next Etch or burst) until, and its 7 s cooldown */
  c6Until: number
  c6Ready: number
  will: Map<number, number>
  highSpiritsReady: number
  willReady: Partial<Record<SimHit['characterKey'], number>>
  hex: { end: number; probability: number }[]
}
const active = (c: SimContext, s: State) =>
  c.onField === 'Lohen' && c.now < s.end

/** Preserve the distribution: clipping E[Will] at 100 gives the wrong expectation. */
export function lohenWillAfterHit(
  previous: ReadonlyMap<number, number>,
  outcomes: readonly DamageOutcome[],
  baseAtk: number,
  /** C1: the cap is 300 and every gain counts 5 times */
  c1 = false
): Map<number, number> {
  const next = new Map<number, number>()
  for (const [will, p] of previous)
    for (const roll of outcomes) {
      const gain =
        ((roll.damage > 10 * baseAtk ? 20 : 1) +
          (roll.damage >= 30 * baseAtk ? 60 : 0)) *
        (c1 ? 5 : 1)
      const value = Math.min(c1 ? 300 : 100, will + gain)
      next.set(value, (next.get(value) ?? 0) + p * roll.probability)
    }
  return next
}

function finish(c: SimContext, s: State) {
  s.end = c.now
  s.joy = 0
  s.will = new Map([[0, 1]])
}
function consume(c: SimContext, s: State, burst: boolean) {
  const cons = c.constellation('Lohen')
  // C4: a Masterstroke burst maxes the Will first
  if (burst && cons >= 4 && active(c, s))
    s.will = new Map([[cons >= 1 ? 300 : 100, 1]])
  const distribution = active(c, s) ? s.will : new Map([[0, 1]])
  const mean = [...distribution].reduce((sum, [will, p]) => sum + will * p, 0)
  const probability = [...distribution].reduce(
    (sum, [will, p]) => sum + (will >= 50 ? p : 0),
    0
  )
  if (
    c.members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2 &&
    probability > 0
  )
    s.hex.push({ end: c.now + 360, probability })
  // C6 (in Masterstroke): the first Etch or burst after its cooldown keeps the Will, maxes Joy
  // and starts the 18 s effect; the next one uses the effect up. Both get its CRIT DMG
  let c6 = false
  let keep = false
  if (cons >= 6 && active(c, s)) {
    if (c.now < s.c6Until) {
      s.c6Until = -1
      c6 = true
    } else if (c.now >= s.c6Ready) {
      s.c6Until = c.now + 1080
      s.c6Ready = c.now + 420
      s.joy = 100
      if (s.maxSkills < 5) s.maxSkills = 5
      c6 = keep = true
    }
  }
  if (!keep) s.will = new Map([[0, 1]])
  // C2: Evilsbane Blade for the next Masterstroke normal or charged hit (4 s, 4 s cooldown)
  if (cons >= 2 && active(c, s) && c.now >= s.c2Ready) {
    s.c2Until = c.now + 240
    s.c2Ready = c.now + 240
  }
  return { talentMultiplier: 1 + mean * 0.004, c6 }
}
const snapshots = (c: SimContext) =>
  (['atk', 'critRate_', 'critDMG_', 'cryo_dmg_', 'eleMas'] as const).map(
    (stat) => ({
      stat: (stat === 'atk' ? 'atk' : stat) as InputPremodKey,
      path: ['total', stat],
      t: c.now,
      onField: c.onField,
    })
  )
function resourceAttack(c: SimContext, s: State, burst: boolean) {
  const first = burst ? 101 : 28
  // C6: an Etch used while its effect is up extends Masterstroke by 1.25 s at once
  if (!burst && c.constellation('Lohen') >= 6 && c.now < s.c6Until) s.end += 75
  c.at(first - 1, (at) => {
    const { talentMultiplier, c6 } = consume(at, s, burst)
    const statSnapshots = snapshots(at)
    for (const delay of burst ? [101, 122, 128, 137, 162] : [28, 35, 45, 52])
      at.hit(delay - first + 1, {
        path: burst ? ['burst', 'burstDmg'] : ['skill', 'etchDmg'],
        tag: burst ? 'burst' : 'skill',
        element: 'cryo',
        applies: true,
        icd: burst ? 'burst' : 'skill',
        talentMultiplier,
        statSnapshots,
        ...(burst
          ? {
              states: [
                {
                  owner: 'Lohen' as const,
                  path: ['Lohen', 'c6BurstMaster'],
                  value: c6 ? 'on' : '',
                },
              ],
            }
          : {}),
        label: burst ? 'Manifest Judgment' : 'Etched Into Bone and Soul',
      })
  })
  if (!burst)
    c.at(first, () => {
      // (C6's trigger maxed the Joy again)
      if (!(c.constellation('Lohen') >= 6 && s.c6Until > c.now && s.joy >= 100))
        s.joy = 0
      s.skills++
    })
}

export const kit: KitModel = {
  characterKey: 'Lohen',
  element: 'cryo',
  source: `${KQMSIM}/lohen`,
  init: (): State => ({
    end: -1,
    joy: 0,
    joyReady: -1,
    skills: 0,
    maxSkills: 3,
    c2Until: -1,
    c2Ready: -1,
    c6Until: -1,
    c6Ready: -1,
    will: new Map([[0, 1]]),
    highSpiritsReady: -1,
    willReady: {},
    hex: [],
  }),
  onStart(c) {
    for (const condition of [
      'willConsumed',
      'lockBuff',
      'a4MasterCryo',
      'a0HighSpirits',
    ])
      c.state('Lohen', ['Lohen', condition], '')
    c.note(
      'Lohen: Burst follows the pinned five-hit timeline; sheet data describes six hits. N3, Joy consumption, the three-use limit and the per-member Will gain ICD follow the skill descriptions, correcting omissions in the pinned source. C4 energy is not modelled.'
    )
  },
  cooldownKey(s: State, action, now) {
    return action.kind === 'skill'
      ? now < s.end
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined
  },
  act(c, s: State, action, previous) {
    switch (action.kind) {
      case 'skill':
        if (active(c, s)) {
          if (s.joy < 100 || s.skills >= s.maxSkills)
            return {
              frames: 0,
              failed:
                'Lohen: Etched Into Bone and Soul needs 100 Joy and has three uses per Masterstroke.',
            }
          resourceAttack(c, s, false)
          return {
            frames: 80,
            framesInto: { normal: 78, dash: 79, jump: 79, swap: 79 },
          }
        }
        if (!c.damageTracked)
          return {
            frames: 0,
            failed:
              'Lohen: teammate damage evaluation is required to calculate Will to Win.',
          }
        s.end = c.now + 799
        s.joy = 0
        s.skills = 0
        s.maxSkills = 3
        s.will = new Map([[0, 1]])
        if (c.now >= s.highSpiritsReady) {
          const own = c.calculate('Lohen', ['total', 'skillIndex'])
          const extended = c.members.some(
            (m) =>
              m !== 'Lohen' &&
              ['autoIndex', 'skillIndex', 'burstIndex'].some(
                (k) => (c.calculate(m, ['total', k]) ?? -1) >= (own ?? 0)
              )
          )
          c.buff(
            'Lohen',
            ['Lohen', 'a0HighSpirits'],
            'on',
            0,
            extended ? 900 : 540,
            { hitlag: 'recipient' }
          )
          s.highSpiritsReady = c.now + 1080
        }
        c.hit(19, {
          path: ['skill', 'castDmg'],
          tag: 'other',
          element: 'physical',
          label: 'Strategem (0 DMG)',
        })
        return {
          frames: 24,
          framesInto: {
            normal: 20,
            skill: 22,
            burst: 22,
            dash: 24,
            jump: 23,
            swap: 21,
            wait: 20,
          },
          cooldown: { key: 'skill', delay: 19, frames: 1080 },
        }
      case 'normal': {
        const masterstroke = active(c, s)
        return normalString(
          normals,
          action.count ?? 1,
          (i, delay, j) =>
            c.hit(delay, {
              path: [masterstroke ? 'skill' : 'normal', nodes[i][j]],
              tag: 'normal',
              element: masterstroke ? 'cryo' : 'physical',
              applies: true,
              icd: 'normal',
              label: `Normal ${i + 1}${masterstroke ? ' (Masterstroke)' : ''}`,
            }),
          c
        )
      }
      case 'charged': {
        // two hits on the world clock (gcsim QueueAttack at 18 and 26), each with 4 frames of
        // defense hitlag
        const masterstroke = active(c, s)
        for (const delay of [18, 26]) {
          c.hit(delay, {
            path: masterstroke ? ['skill', 'chargedDmg'] : ['charged', 'dmg'],
            tag: 'charged',
            element: masterstroke ? 'cryo' : 'physical',
            applies: true,
            icd: 'charged',
            label: 'Charged Attack',
          })
          c.hit(delay, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 4,
            label: 'Melee hitlag',
          })
        }
        return withHitlag(
          {
            frames: 40,
            framesInto: {
              normal: 32,
              skill: 27,
              burst: 27,
              dash: 26,
              jump: 26,
              swap: 30,
              wait: 26,
            },
          },
          { hitmarks: [18, 26], hitlag: [4, 4], worldTimeHits: true }
        )
      }
      case 'burst':
        if (active(c, s)) s.end += 99
        resourceAttack(c, s, true)
        return {
          frames: 130,
          framesInto: { normal: 129, skill: 129, swap: 129, wait: 129 },
          cooldown: { key: 'burst', frames: 900 },
        }
      case 'dash':
        // gcsim's template dash for his body: 21 frames, 2 into a jump
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'polearm', previous, c)
      default:
        return {
          frames: 0,
          failed: `Lohen: ${action.text} is not implemented.`,
        }
    }
  },
  onSwapOut: finish,
  onHitlag(c, s: State, frames) {
    if (active(c, s)) s.end += frames
    for (const k of ['c2Until', 'c2Ready', 'c6Until', 'c6Ready'] as const)
      if (s[k] > c.now) s[k] += frames
    if (s.joyReady > c.now) s.joyReady += frames
    if (s.highSpiritsReady > c.now) s.highSpiritsReady += frames
    for (const buff of s.hex) if (c.now < buff.end) buff.end += frames
  },
  onHit(c, s: State, hit) {
    if (hit.characterKey === 'Lohen') {
      if (hit.tag !== 'normal' && hit.tag !== 'charged') return
      if (
        active(c, s) &&
        hit.element === 'cryo' &&
        c.now >= s.joyReady &&
        s.skills < s.maxSkills
      ) {
        s.joy = Math.min(100, s.joy + 17)
        s.joyReady = c.now + 6
      }
      // C2: Evilsbane Blade follows up a Masterstroke normal or charged hit (5 frames later)
      if (active(c, s) && hit.element === 'cryo' && c.now < s.c2Until) {
        s.c2Until = -1
        c.hit(5, {
          path: ['constellation2', 'dmg'],
          tag: 'normal',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Evilsbane Blade (C2)',
        })
        c.buff('Lohen', ['Lohen', 'c2Blade'], 'on', 0, 480, {
          hitlag: 'recipient',
        })
      }
      const probability =
        1 -
        s.hex
          .filter((b) => c.now < b.end)
          .reduce((p, b) => p * (1 - b.probability), 1)
      if (probability > 0)
        hit.bonusStats = {
          ...hit.bonusStats,
          [`${hit.tag}_dmg_`]: 40 * probability,
        }
      return
    }
    if (!active(c, s)) return
    const reaction = hit.path[1]
    if (
      hit.path[0] === '_reaction' &&
      [
        'cryoSwirl',
        'crystallizeCryo',
        'superconduct',
        'frozen',
        'melt',
        'stellarSwirl',
        'stellarConduct',
      ].includes(reaction)
    )
      for (const recipient of ['Lohen', hit.characterKey] as const)
        c.buff('Lohen', ['Lohen', 'a4MasterCryo'], 'on', 0, 480, {
          recipient,
          hitlag: 'recipient',
        })
  },
  observesDamage: (c, s: State, hit) =>
    active(c, s) &&
    hit.characterKey !== 'Lohen' &&
    c.now >= (s.willReady[hit.characterKey] ?? -1),
  onDamage(c, s: State, hit, outcomes) {
    if ((hit.weight ?? 1) !== 1)
      c.warn(
        'Lohen: fractional teammate hit counts are not verified for Will to Win.'
      )
    const baseAtk = c.calculate('Lohen', ['base', 'atk'])
    if (!outcomes || !baseAtk) {
      c.warn(
        'Lohen: could not evaluate a teammate damage roll for Will to Win.'
      )
      return
    }
    s.willReady[hit.characterKey] = c.now + 6
    s.will = lohenWillAfterHit(
      s.will,
      outcomes,
      baseAtk,
      c.constellation('Lohen') >= 1
    )
  },
}
