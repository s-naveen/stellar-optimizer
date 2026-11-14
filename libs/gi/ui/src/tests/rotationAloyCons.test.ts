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

it("Aloy's Freeze Bomb and both Bomblets each give a Coil stack (the game text)", () => {
  const sim = run('Aloy E N1 W1', ['Aloy'])
  const n1 = sim.hits.find((h) => h.tag === 'normal')!
  expect(state(n1, 'Aloy.coil')).toBe('coil3')
  // the 4th Coil starts Rushing Ice
  const rush = run('Aloy E N1 W20 E N1 W1', ['Aloy']).hits.filter(
    (h) => h.tag === 'normal'
  )
  expect(state(rush[rush.length - 1], 'Aloy.coil')).toBe('rush')
  expect(rush[rush.length - 1].element).toBe('cryo')
})

it('Aloy keeps her Coils while off the field (the party stays in combat)', () => {
  const sim = run('Aloy E W1 -> Faruzan W35 -> Aloy N1 W1', ['Aloy', 'Faruzan'])
  const n1 = sim.hits.find(
    (h) => h.characterKey === 'Aloy' && h.tag === 'normal'
  )!
  expect(state(n1, 'Aloy.coil')).toBe('coil3')
})
