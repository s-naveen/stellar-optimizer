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
const state = (
  hit: { states?: { path: string[]; value: string }[] },
  path: string
) => hit.states?.find((s) => s.path.join('.') === path)?.value ?? ''

it("Kaeya C1's CRIT Rate needs a Cryo (or Frozen) enemy before the hit", () => {
  const sim = run('Kaeya N2 E N2 W1', ['Kaeya'], { Kaeya: 1 })
  const normals = sim.hits.filter((h) => h.tag === 'normal')
  expect(normals.map((h) => state(h, 'Kaeya.CryoC1'))).toEqual([
    '',
    '',
    'on',
    'on',
  ])
})

it("Kaeya's Glacial Waltz keeps the stats of the cast", () => {
  const sim = run('Kaeya Q W5', ['Kaeya'])
  const ticks = sim.hits.filter((h) => h.label === 'Glacial Waltz')
  expect(ticks.length).toBeGreaterThan(0)
  expect(
    ticks.every((h) =>
      h.statSnapshots?.some((s) => s.stat === 'atk' && s.t === 0)
    )
  ).toBe(true)
})
