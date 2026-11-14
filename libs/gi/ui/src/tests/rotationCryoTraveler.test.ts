import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['TravelerCryo', 'Fischl']
const run = (text: string, pulses: number[] = [], conduct = true) => {
  const probe: KitModel = {
    characterKey: 'Fischl',
    element: 'electro',
    source: 'test',
    act: () => ({ frames: 1 }),
    onStart(c) {
      for (const delay of pulses)
        c.hit(delay, {
          path: ['burst', 'dmg'],
          tag: 'directStellarConduct',
          element: 'electro',
          label: 'Stellar probe',
        })
    },
  }
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { TravelerCryo: 'cryo', Fischl: 'electro' },
    constellations: { TravelerCryo: 0 },
    repeats: 1,
    keep: 'all',
    kits: { TravelerCryo: kitModels.TravelerCryo, Fischl: probe },
    reactions: {
      onHit() {},
      radianceAt: () => (conduct ? 'conduct' : undefined),
    },
  })
}

it('converts ordinary on-field attacks during Stellar Conduct and queues their coordinated crystals', () => {
  const sim = run('TravelerCryo E N5 C Q W1')
  expect(sim.warnings).toEqual([])
  const normal = sim.hits.filter((h) => h.tag === 'normal')
  expect(normal).toHaveLength(5)
  expect(
    normal.every(
      (h) =>
        h.element === 'cryo' &&
        h.states?.some((s) => s.path[1] === 'a1ScStar' && s.value === 'on')
    )
  ).toBe(true)
  for (const h of normal)
    expect(
      sim.hits.some((c) => c.label === 'Frostpierce Star' && c.t === h.t + 12)
    ).toBe(true)
  expect(
    sim.hits
      .filter((h) => h.label.startsWith('Charged Attack'))
      .every((h) => h.element === 'cryo')
  ).toBe(true)
})

it('requires three Icepoint stacks and an active Star, consumes the stacks, and respects Freezing Ice’s cooldown', () => {
  const sim = run(
    'TravelerCryo E W4 C C W1',
    [0, 1, 119, 120, 239, 240, 400, 520, 640]
  )
  const freezing = sim.hits.filter((h) => h.label === 'Freezing Ice')
  expect(freezing).toHaveLength(2)
  expect(freezing.map((h) => h.path.join('.'))).toEqual([
    'lockedPassive.stellarconductDmg1',
    'lockedPassive.stellarconductDmg2',
  ])
  expect(
    freezing.every((h) => h.tag === 'directStellarConduct' && !h.applies)
  ).toBe(true)
  expect(
    sim.hits.filter((h) => h.label.startsWith('Charged Attack'))
  ).toHaveLength(2)
  expect(
    run('TravelerCryo W5 C W1', [0, 120, 240]).hits.some(
      (h) => h.label === 'Freezing Ice'
    )
  ).toBe(false)
})

it('uses Traveler’s character clock for Icepoint’s shared two-second gain ICD', () => {
  const text = 'TravelerCryo E N1 W4 C W1'
  expect(
    run(text, [0, 120, 240]).hits.some((h) => h.label === 'Freezing Ice')
  ).toBe(false)
  expect(
    run(text, [0, 126, 246]).hits.filter((h) => h.label === 'Freezing Ice')
  ).toHaveLength(2)
})

it('adds two Frostglow stacks on Freezing Ice and consumes eight stacks for five burst hits', () => {
  const sim = run('TravelerCryo E W4 C N5 Q W2', [0, 120, 240])
  const burst = sim.hits.filter((h) => h.label.startsWith('Frostbound Javelin'))
  expect(burst).toHaveLength(5)
  expect(
    burst.every((h) =>
      h.states?.some((s) => s.path[1] === 'burstFrostglow' && s.value === '8')
    )
  ).toBe(true)
})

it('pauses periodic Frostpierce Star tasks with Traveler’s normal hitlag', () => {
  const sim = run('TravelerCryo E N5 W10', [], false)
  expect(
    sim.hits
      .filter((h) => h.label === 'Frostpierce Star')
      .slice(0, 2)
      .map((h) => h.t)
  ).toEqual([225, 238])
  expect(
    sim.hits
      .filter((h) => h.tag === 'normal')
      .every((h) => h.element === 'physical')
  ).toBe(true)
})
