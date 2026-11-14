import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Klee']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Klee: 'pyro', Venti: 'anemo' },
    repeats: 1,
    keep: 'all',
    random: () => 0.1,
    ...extra,
  })
}
const charges = (sim: ReturnType<typeof run>) =>
  sim.hits.filter((h) => h.tag === 'charged').map((h) => h.path[0])

it('holds three guaranteed Sparks and consumes one per charge instead of replacing the stack', () => {
  expect(charges(run('Klee E E Q CA CA CA CA W2'))).toEqual([
    'passive1',
    'passive1',
    'passive1',
    'charged',
  ])
})

it('starts the five-second gain cooldown only on success', () => {
  const draws = [0.1, 0.9]
  const random = vi.fn(() => draws.shift() ?? 0.1)
  expect(charges(run('Klee N1 CA N1 CA W2', { random }))).toEqual([
    'charged',
    'passive1',
  ])
  expect(random).toHaveBeenCalledTimes(2)
})

it('blocks further successful gains until the five-second cooldown expires', () => {
  const random = vi.fn(() => 0.9)
  expect(charges(run('Klee N1 CA N1 CA W5 N1 CA W2', { random }))).toEqual([
    'passive1',
    'charged',
    'passive1',
  ])
  expect(random).toHaveBeenCalledTimes(2)
})

it('allows Dumpty bounces to gain a Spark but does not roll A1 for mines', () => {
  const random = vi.fn(() => 0.9)
  expect(charges(run('Klee E W4 CA CA CA W2', { random }))).toEqual([
    'passive1',
    'passive1',
    'charged',
  ])
  expect(random).toHaveBeenCalledTimes(1)
})

it('does not refresh the thirty-second expiry when a guaranteed gain meets the stack cap', () => {
  expect(charges(run('Klee E E Q Q W16 CA W2'))).toEqual(['charged'])
})

it('queues the N3 coordinated charge only when a Spark exists at the normal’s start', () => {
  const extra = { members: ['Klee', 'Venti'] as CharacterKey[] }
  expect(charges(run('Klee N3 W2', extra))).toEqual([])
  const sim = run('Klee N3 W2', { ...extra, random: () => 0.9 })
  const coordinated = sim.hits.filter((h) => h.label.endsWith('(Coordinated)'))
  expect(coordinated).toHaveLength(1)
  expect(coordinated[0].t).toBe(90)
  expect(coordinated[0].statSnapshots?.every((s) => s.t === 80)).toBe(true)
})

it('emits real burst instances rather than fractional hits', () => {
  for (const [draw, expected] of [
    [0.1, 30],
    [0.9, 18],
  ] as const) {
    const sim = run('Klee Q W14', { random: () => draw })
    const hits = sim.hits.filter((h) => h.tag === 'burst')
    expect(hits).toHaveLength(expected)
    expect(hits.every((h) => (h.weight ?? 1) === 1)).toBe(true)
  }
})

it('recharges Jumpy Dumpty sequentially from each release', () => {
  const sim = run('Klee E E E E W1')
  expect(sim.actions.filter((a) => a.text === 'E').map((a) => a.start)).toEqual(
    [0, 68, 1233, 2433]
  )
})

it('captures Dumpty and its mines at cast rather than receiving later field buffs', () => {
  const sim = run('Klee E W5')
  const hits = sim.hits.filter((h) => h.tag === 'skill')
  expect(hits).toHaveLength(3)
  expect(
    hits.every((h) =>
      h.statSnapshots?.every((s) => s.t === 0 && s.onField === 'Klee')
    )
  ).toBe(true)
  expect(
    hits.every((h) => h.statSnapshots?.some((s) => s.stat === 'atk'))
  ).toBe(true)
})

it('resolves Nicole’s zero-delay swap passive before E creates a new Grace buff', () => {
  const sim = run('Klee W1 -> Nicole E Q W1', {
    members: ['Klee', 'Nicole'],
    elements: { Klee: 'pyro', Nicole: 'pyro' },
    kits: { Klee: kitModels.Klee, Nicole: kitModels.Nicole },
  })
  const attack = rotationAttacks(sim).Nicole!.find(
    (a) => a.path[0] === 'skill'
  )!
  const captured = attack.statSnapshots!.find(
    (s) => s.characterKey === 'Nicole'
  )!
  expect(
    captured.states.find((s) => s.path[1] === 'a1GuidanceActive')?.value
  ).toBe('')
  expect(
    captured.states.find((s) => s.path[1] === 'a4NicoleGuidance')?.value
  ).toBe('')
})
