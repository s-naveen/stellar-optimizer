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
it('Jean C1 is in the held Gale Blade, which keeps the stats of the cast', () => {
  const sim = run('Jean hE W1', ['Jean'], { Jean: 1 })
  const blade = sim.hits.find((h) => h.label === 'Gale Blade (held)')!
  expect(
    blade.snapshotStates?.some((s) => s.path[1] === 'c1' && s.value === 'on')
  ).toBe(true)
})

it('Jean C2: a particle picked up while she is on the field speeds up the party', () => {
  const strings = (cons: number) =>
    run('Jean E W2 N5 W1', ['Jean'], { Jean: cons }).actions.find(
      (a) => a.text === 'N5'
    )!.frames
  expect(strings(2)).toBeLessThan(strings(0))
})
