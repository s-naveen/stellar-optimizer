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
it("Tighnari C4: a Tanglevine Shaft reaction raises the party's EM buff", () => {
  const sim = run('Fischl E -> Tighnari Q W9', ['Fischl', 'Tighnari'], {
    Tighnari: 4,
  })
  const values = sim.buffWindows
    .filter((w) => w.owner === 'Tighnari' && w.path[1] === 'c4')
    .map((w) => w.value)
  expect(values).toContain('after')
  expect(values).toContain('react')
})

it('Tighnari C2 starts after the mine hit', () => {
  const sim = run('Tighnari E W3', ['Tighnari'], { Tighnari: 2 })
  const mine = sim.hits.find((h) => h.label === 'Vijnana-Phala Mine')!
  const c2 = sim.buffWindows.find((w) => w.path[1] === 'c2EnemyField')!
  expect(c2.start).toBe(mine.t + 1)
})
