import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Sandrone', 'Mitya']
const run = (text: string, constellation: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Sandrone: 'cryo', Mitya: 'electro' },
    constellations: { Sandrone: constellation },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })

it('C6 fires a Condensed Cluster Beam 5 frames after each beam from the third, and C2 stacks the beams', () => {
  const sim = run('Sandrone C W1', 6)
  const beams = sim.hits.filter((h) => h.path[1]?.startsWith('beam'))
  const clusters = sim.hits.filter((h) => h.path[0] === 'constellation6')
  expect(clusters.map((h) => h.t)).toEqual(beams.slice(2).map((h) => h.t + 5))
  expect(
    beams.map(
      (h) => h.states?.find((s) => s.path[1] === 'c2Stacks')?.value ?? ''
    )
  ).toEqual(beams.map((_, i) => `${Math.min(i + 1, 3)}`))
  // the wait after the charge starts with the channel's first tick (gcsim's CanQueueAfter)
  expect(sim.waits![0].start - sim.actions[0].start).toBe(25 + 18)
})
