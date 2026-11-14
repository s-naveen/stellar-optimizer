import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

it('starts a wait after Jahoda’s skill at its earliest cancel, holding her next action for the pursuit', () => {
  const members: CharacterKey[] = ['Jahoda']
  const sim = simulateRotation({
    rotation: parseRotation('Jahoda E W1 N1', [
      { characterKey: 'Jahoda', name: 'Jahoda' },
    ]),
    members,
    elements: { Jahoda: 'anemo' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    // no aura: the pursuit runs its full length and drains the unfilled flask at 364
    reactions: { onHit() {}, absorbAt: () => undefined },
  })
  expect(sim.waits?.[0].start).toBe(41)
  const drain = sim.hits.find((h) => h.label === 'Unfilled Treasure Flask')!
  // N1 waits for the drain and its 43-frame cancel (gcsim's pursuit frames)
  expect(sim.actions.find((a) => a.text === 'N1')?.start).toBe(drain.t - 4 + 43)
})
