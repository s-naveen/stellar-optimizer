import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

it('counts Polestar applications on each character clock and pauses recipient and target buffs independently', () => {
  const source: KitModel = {
    characterKey: 'Mitya',
    element: 'electro',
    source: 'test',
    onStart(c) {
      c.hit(0, {
        path: ['skill', 'probe'],
        tag: 'skill',
        element: 'electro',
        applies: true,
        durability: 100,
        icd: 'none',
        label: 'Electro aura',
      })
    },
    act: () => ({ frames: 1 }),
  }
  const cryo: KitModel = {
    characterKey: 'Kaeya',
    element: 'cryo',
    source: 'test',
    act(c) {
      for (const t of [1, 2, 8, 13])
        c.hit(t, {
          path: ['skill', 'probe'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Cryo probe',
        })
      c.hit(3, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 5,
        enemyAnimationPause: 10,
        label: 'Independent pauses',
      })
      return { frames: 300 }
    },
  }
  const members = ['Kaeya', 'Mitya'] as const
  const sim = simulateRotation({
    rotation: parseRotation(
      'Kaeya E',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: [...members],
    elements: { Kaeya: 'cryo', Mitya: 'electro' },
    constellations: {},
    kits: { Kaeya: cryo, Mitya: source },
    repeats: 1,
    keep: 'all',
  })
  const stacks = sim.buffWindows.filter(
    (w) => w.path.join('.') === 'reaction.polestarStacks'
  )
  expect(stacks.map((w) => w.value)).toEqual(['0', '2'])
  expect(stacks.every((w) => w.hitlag === 'recipient')).toBe(true)
  expect(
    sim.buffWindows
      .filter((w) => w.path.join('.') === 'reaction.oppInsidePole')
      .every((w) => w.hitlag === 'enemy')
  ).toBe(true)
})
