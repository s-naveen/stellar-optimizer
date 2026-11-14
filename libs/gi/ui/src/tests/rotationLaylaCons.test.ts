import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kitModels[m]!.element])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
  })
it("Layla's jump is the template's Girl jump", () => {
  const lead = (text: string) => {
    const sim = run(text, ['Layla'])
    return (
      sim.actions[sim.actions.length - 1].start -
      sim.actions[sim.actions.length - 2].start
    )
  }
  expect(lead('Layla J N1 W1')).toBe(31)
  expect(lead('Layla D J N1 W1')).toBe(34)
})
