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
it("Yaoyao's skill Yuegui throws burst radishes under Adeptal Legacy", () => {
  const sim = run('Yaoyao E Q W12', ['Yaoyao'])
  const q = sim.actions.find((a) => a.text === 'Q')!
  const skillYuegui = sim.hits.filter(
    (h) => h.label.startsWith('Radish (') && !h.label.includes('A1')
  )
  const inBurst = skillYuegui.filter(
    (h) => h.t >= q.start && h.t < q.start + 360
  )
  expect(inBurst.length).toBeGreaterThan(0)
  expect(inBurst.every((h) => h.path.join('.') === 'burst.radish')).toBe(true)
  const after = skillYuegui.filter(
    (h) => h.t >= q.start + 360 && h.label === 'Radish (Yuegui)'
  )
  expect(after.every((h) => h.path.join('.') === 'skill.dmg')).toBe(true)
})

it("Yaoyao's burst hit pauses her; her jump is the template's Loli jump", () => {
  expect(run('Yaoyao Q W1', ['Yaoyao']).waits![0].start).toBe(58)
  expect(run('Yaoyao J W1', ['Yaoyao']).waits![0].start).toBe(5)
})
