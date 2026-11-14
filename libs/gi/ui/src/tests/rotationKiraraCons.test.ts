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
it("Kirara's tap kick pauses her: a wait starts at 33 + 4 frames", () => {
  const sim = run('Kirara E W1', ['Kirara'])
  expect(sim.waits![0].start).toBe(37)
})

it('Kirara C1: without stats, 16,000 Max HP gives 2 extra Cat Grass Cardamoms', () => {
  const count = (cons: number) =>
    run('Kirara Q W16', ['Kirara'], { Kirara: cons }).hits.filter((h) =>
      h.label.startsWith('Cat Grass Cardamom')
    ).length
  expect(count(0)).toBe(6)
  expect(count(1)).toBe(8)
})

it('Kirara C4 waits 3.8 s on her clock between coordinated attacks', () => {
  const sim = run('Kirara E N4 N4 N4 N4 W1', ['Kirara'], { Kirara: 4 })
  const c4 = sim.hits.filter((h) => h.label.startsWith('Steed of Skanda'))
  expect(c4.length).toBeGreaterThanOrEqual(2)
  expect(c4[1].t - c4[0].t).toBeGreaterThan(229)
})
