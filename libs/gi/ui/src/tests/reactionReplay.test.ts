/** Recorded gcsim/kqmsim auras (AGPLv3); fixture revisions and hashes preserve provenance.
 * REPLAY=/path/to/sample.json adds a local recording without requiring local files by default. */
import { readFileSync } from 'node:fs'
import {
  allCharacterKeys,
  type CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import type { AuraTrace } from '../util/teamOpt/rotation/reactions'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { HitElement, KitModel } from '../util/teamOpt/rotation/types'
import recordings from './fixtures/reaction-replay/recordings.json'

type Gauge = Record<string, number>
type Application = [number, number, string, string, number, Gauge, Gauge]
interface Recording {
  id: string
  names: string[]
  applications: Application[]
  pauses: number[][]
}
const MOD: Record<string, string> = { burningFuel: 'dendro-fuel' }
// Preserve the original diagnostic's gauge tolerance. Aura parity at this tolerance
// does not certify damage, reaction ownership or every timer and team configuration.
const GAUGE_TOLERANCE = 0.6
const names = new Map(allCharacterKeys.map((key) => [key.toLowerCase(), key]))
const aliases: Record<string, CharacterKey> = {
  ayaka: 'KamisatoAyaka',
  ayato: 'KamisatoAyato',
  kazuha: 'KaedeharaKazuha',
  kokomi: 'SangonomiyaKokomi',
  raiden: 'RaidenShogun',
  itto: 'AratakiItto',
}
const character = (name: string): CharacterKey => {
  const key = names.get(name.toLowerCase()) ?? aliases[name.toLowerCase()]
  if (!key) throw new Error(`Unknown replay character: ${name}`)
  return key
}
const normalized = (aura: Gauge) =>
  Object.fromEntries(
    Object.entries(aura).map(([key, value]) => [MOD[key] ?? key, value])
  )
const gaugeDifference = (ours: Gauge, reference: Gauge) => {
  const a = normalized(ours)
  const keys = new Set([...Object.keys(a), ...Object.keys(reference)])
  return Math.max(
    0,
    ...[...keys].map((k) => Math.abs((a[k] ?? 0) - (reference[k] ?? 0)))
  )
}
const auraPresenceDifference = (ours: Gauge, reference: Gauge) => {
  const a = normalized(ours)
  return [...new Set([...Object.keys(a), ...Object.keys(reference)])].filter(
    (key) =>
      // Native logs round to 0.001. Ignore only that rounding boundary, not a real aura
      // disappearing below the 0.6 quantitative tolerance (Frozen controls CRIT and Shatter).
      Math.max(a[key] ?? 0, reference[key] ?? 0) > 0.001 &&
      (a[key] ?? 0) > 0 !== (reference[key] ?? 0) > 0
  )
}

function replay(recording: Recording) {
  const members = recording.names.map(character)
  const apps = recording.applications
  const end = (apps.at(-1)?.[0] ?? 0) + 60
  const kit: KitModel = {
    characterKey: members[0],
    element: getCharEle(members[0]) as HitElement,
    source: 'recorded reference',
    act(ctx) {
      if (process.env['NOHITLAG'] === undefined)
        for (const [frame, duration, factor] of recording.pauses)
          ctx.hit(frame - ctx.now, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 0,
            enemyAnimationPause: Math.ceil(duration * (1 - factor)),
            label: 'Recorded enemy hitlag',
          })
      // Reference attacks are queued before landing; preserve same-frame task order.
      for (const [frame, actor, ability, element, durability] of apps)
        ctx.at(Math.max(0, frame - 1 - ctx.now), (c) =>
          c.hit(frame - c.now, {
            characterKey: members[actor],
            path: ['_replay', ability],
            tag: 'other',
            element: element as HitElement,
            applies: true,
            durability,
            icd: 'none',
            label: ability,
          })
        )
      return { frames: end }
    },
  }
  const trace: AuraTrace[] = []
  const sim = simulateRotation({
    rotation: parseRotation(`${members[0]} E`, [
      { characterKey: members[0], name: members[0] },
    ]),
    members,
    constellations: {},
    elements: Object.fromEntries(members.map((m) => [m, getCharEle(m)])),
    kits: { [members[0]]: kit },
    repeats: 1,
    keep: 'all',
    auraTrace: (e) => trace.push(e),
  })
  return { trace, sim, members }
}

const GENERATED =
  /^(burning|overload|superconduct|electrocharged|lunarcharged|shatter|bloom|hyperbloom|burgeon|swirl-\w+.*|crystallize.*|Stellar Swirl( Detonation)?)$/
interface ReferenceLog {
  event: string
  msg: string
  frame: number
  char_index: number
  logs: {
    abil: string
    applied_ele: string
    dur: number
    existing: string[] | null
    after: string[] | null
    duration: number
    factor: number
  }
}
function readLocal(file: string): Recording {
  const d = JSON.parse(readFileSync(file, 'utf8')) as {
    character_details: { name: string }[]
    logs: ReferenceLog[]
  }
  const parse = (values: string[] | null) =>
    Object.fromEntries(
      (values ?? []).map((x) => {
        const [key, value] = x.split(':')
        return [key.trim(), Number(value)]
      })
    )
  return {
    id: file,
    names: d.character_details.map((c) => c.name),
    applications: d.logs
      .filter(
        (l) =>
          l.event === 'element' &&
          l.msg === 'application' &&
          !GENERATED.test(l.logs.abil)
      )
      .map((l) => [
        l.frame,
        l.char_index,
        l.logs.abil,
        l.logs.applied_ele,
        l.logs.dur,
        parse(l.logs.existing),
        parse(l.logs.after),
      ]),
    pauses: d.logs
      .filter((l) => l.msg === 'enemy hitlag - extending mods')
      .map((l) => [l.frame, l.logs.duration, l.logs.factor]),
  }
}
const cases = [
  ...(recordings as unknown as Recording[]),
  ...(process.env['REPLAY'] ?? '').split(',').filter(Boolean).map(readLocal),
]

describe.each(cases)('reaction recording $id', (recording) => {
  it('preserves every application and rejects aura differences', () => {
    const { trace, sim, members } = replay(recording)
    expect(trace).toHaveLength(recording.applications.length)
    const mismatches: string[] = []
    const show = (process.env['SHOW'] ?? '').split('-').map(Number)
    trace.forEach((ours, i) => {
      const [frame, actor, ability, element, durability, _before, after] =
        recording.applications[i]
      expect([
        ours.t,
        ours.characterKey,
        ours.label,
        ours.element,
        ours.durability,
      ]).toEqual([frame, members[actor], ability, element, durability])
      const difference = gaugeDifference(ours.after, after)
      const description = `${frame}: ${ability}; gauge gap ${difference.toFixed(4)}; ours ${JSON.stringify(normalized(ours.after))}; reference ${JSON.stringify(after)}`
      if (difference >= GAUGE_TOLERANCE) mismatches.push(description)
      const presence = auraPresenceDifference(ours.after, after)
      if (presence.length)
        mismatches.push(`${description}; aura presence: ${presence.join(', ')}`)
      // Display filters never change which differences count or fail.
      if (show.length === 2 && frame >= show[0] * 60 && frame <= show[1] * 60)
        console.log(description)
    })
    console.log(
      `${recording.id}: ${trace.length} applications, ${mismatches.length} aura mismatches (tolerance ${GAUGE_TOLERANCE})`
    )
    const rx = process.env['RX']
    if (rx)
      console.log(
        `${rx}: ${sim.hits
          .filter((h) => h.path.join('.') === `reaction.${rx}`)
          .map((h) => h.t / 60)
          .join(', ')}`
      )
    expect(mismatches, mismatches.slice(0, 10).join('\n')).toEqual([])
  })
})

it('detects a corrupted reference aura instead of passing on event counts alone', () => {
  const { trace } = replay(cases[0])
  expect(trace.length).toBeGreaterThan(0)
  const mutated = { ...cases[0].applications[0][6], pyro: 1000 }
  expect(gaugeDifference(trace[0].after, mutated)).toBeGreaterThan(
    GAUGE_TOLERANCE
  )
})

it('rejects a missing Frozen aura even when its gauge is below the quantitative tolerance', () => {
  expect(gaugeDifference({}, { frozen: 0.4 })).toBeLessThan(GAUGE_TOLERANCE)
  expect(auraPresenceDifference({}, { frozen: 0.4 })).toEqual(['frozen'])
})
