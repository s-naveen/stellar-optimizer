import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Varka', 'Bennett']
const run = (text: string) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Varka: 'anemo', Bennett: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })

it('gives Varka gcsim’s idle windups once his last animation has ended (5 for a normal, 14 for a charge)', () => {
  const sim = run('Varka N1 W2 N1 W2 C W1')
  const [n1, n2, ca] = sim.actions.map((a) => a.start)
  const hits = sim.hits.filter((h) => !h.path[0].startsWith('_'))
  // N1 (19) and, as the sequence carries over the wait, N2 (18): each 5 frames later
  expect(hits[0].t - n1).toBe(19 + 5)
  expect(hits[1].t - n2).toBe(18 + 5)
  // the charged attack's hits stay at 41; its windup delays only its cancels
  expect(hits[3].t - ca).toBe(41)
  expect(sim.waits![2].start - ca).toBe(41 + 14 + 9)
})
