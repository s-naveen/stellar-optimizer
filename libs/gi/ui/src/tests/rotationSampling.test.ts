import { parseRotation } from '../util/teamOpt/rotation/parse'
import { rotationRandom } from '../util/teamOpt/rotation/random'
import {
  rotationAttacks,
  rotationBuffDefaults,
  simulateRotationSamples,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

it('repeats the same random stream for a seed while separating independent sample streams', () => {
  const first = rotationRandom(100)
  const second = rotationRandom(100)
  const other = rotationRandom(101)
  const sequence = Array.from({ length: 20 }, () => first())
  expect(sequence).toEqual(Array.from({ length: 20 }, () => second()))
  expect(sequence).not.toEqual(Array.from({ length: 20 }, () => other()))
  expect(sequence.every((n) => n >= 0 && n < 1)).toBe(true)
})

const probe: KitModel = {
  characterKey: 'Mona',
  element: 'hydro',
  source: 'test',
  init: () => ({ pyro: false }),
  onStart(c, s) {
    s.pyro = c.random() < 0.5
    if (s.pyro) {
      c.buff('Mona', ['Mona', 'Omen'], 'on', 0, 100)
      c.hit(0, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'pyro',
        applies: true,
        icd: 'none',
        label: 'Optional Pyro',
      })
    }
    c.hit(10, {
      path: ['charged', 'dmg'],
      tag: 'charged',
      element: 'hydro',
      applies: true,
      icd: 'none',
      label: 'Hydro after optional Pyro',
    })
  },
  act: (_c, s) => ({ frames: s.pyro ? 20 : 40 }),
}
const options = {
  rotation: parseRotation('Mona E W1', [
    { characterKey: 'Mona', name: 'Mona' },
  ]),
  members: ['Mona'] as const,
  elements: { Mona: 'hydro' as const },
  constellations: {},
  kits: { Mona: probe },
  repeats: 1,
  keep: 'all' as const,
}

it('keeps optional attacks and their reaction history inside independent complete samples', () => {
  const sim = simulateRotationSamples(
    { ...options, members: [...options.members] },
    32
  )
  const samples = sim.samples!
  expect(samples).toHaveLength(32)
  let pyroProbability = 0
  for (const { probability, result } of samples) {
    const pyro = result.hits.some((h) => h.label === 'Optional Pyro')
    const hydro = result.hits.find((h) => h.tag === 'charged')!
    expect(hydro.reaction).toBe(pyro ? 'vaporize' : undefined)
    expect(result.hits.every((h) => (h.weight ?? 1) === 1)).toBe(true)
    if (pyro) pyroProbability += probability
  }
  expect(pyroProbability).toBeGreaterThan(0)
  expect(pyroProbability).toBeLessThan(1)
  const attacks = rotationAttacks(sim, () => 'saved')!.Mona!
  const vape = attacks.filter((a) => a.reaction === 'vaporize')
  expect(vape.reduce((sum, a) => sum + a.hits, 0)).toBe(pyroProbability)
  expect(
    attacks
      .filter((a) => a.path[0] === 'charged')
      .reduce((sum, a) => sum + a.hits, 0)
  ).toBe(1)
  expect(
    vape.every((a) =>
      a.states?.some((s) => s.path[1] === 'Omen' && s.value === 'on')
    )
  ).toBe(true)
  expect(
    attacks
      .filter((a) => a.path[0] === 'charged' && !a.reaction)
      .every((a) => a.limits?.some((s) => s.path[1] === 'Omen' && s.hits === 0))
  ).toBe(true)
  expect(sim.frames).toBe(
    samples.reduce((sum, s) => sum + s.probability * s.result.frames, 0)
  )
  expect(rotationBuffDefaults(sim)).toContainEqual({
    owner: 'Mona',
    path: ['Mona', 'Omen'],
    value: 'on',
  })
})

it('reproduces the ensemble and declines shared mutable reaction state', () => {
  const input = { ...options, members: [...options.members] }
  expect(rotationAttacks(simulateRotationSamples(input, 8, 55))).toEqual(
    rotationAttacks(simulateRotationSamples(input, 8, 55))
  )
  expect(() =>
    simulateRotationSamples({ ...input, reactions: { onHit() {} } }, 8)
  ).toThrow('independent reaction')
  expect(() => simulateRotationSamples(input, 0)).toThrow('between 1 and 1024')
})
