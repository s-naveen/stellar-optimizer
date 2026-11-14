import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

it('runs Fischl’s A4 ICD on the reaction triggerer’s clock, including their hitlag', () => {
  const members: CharacterKey[] = ['Fischl', 'Keqing']
  const probe: KitModel = {
    characterKey: 'Keqing',
    element: 'electro',
    source: 'test',
    act(c) {
      // (gcsim's 0.5 s ICD status is active through its expiry: 31 frames of Keqing's clock)
      for (const delay of [0, 30, 41])
        c.hit(delay, {
          path: ['_reaction', 'electroCharged'],
          tag: 'other',
          element: 'electro',
          label: 'Reaction probe',
        })
      c.hit(10, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 10,
        label: 'Keqing hitlag',
      })
      return { frames: 100 }
    },
  }
  const sim = simulateRotation({
    rotation: parseRotation(
      'Fischl E -> Keqing E W1',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Fischl: 'electro', Keqing: 'electro' },
    constellations: { Fischl: 6 },
    repeats: 1,
    keep: 'all',
    kits: { Fischl: kitModels.Fischl, Keqing: probe },
    reactions: { onHit() {} },
  })
  const entry = sim.actions[1].start
  expect(
    sim.hits
      .filter((h) => h.label === 'Thundering Retribution (A4)')
      .map((h) => h.t - entry)
  ).toEqual([4, 45])
})
