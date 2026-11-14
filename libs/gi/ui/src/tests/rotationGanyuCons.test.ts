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

it('Ganyu C2 gives Trail of the Qilin a second charge', () => {
  const second = (cons: number) =>
    run('Ganyu E E W1', ['Ganyu'], { Ganyu: cons }).actions[1].start
  expect(second(2)).toBe(28)
  expect(second(0)).toBeGreaterThanOrEqual(600)
})

it('Ganyu C1 shreds Cryo RES for 6 s from after each arrow and bloom hit', () => {
  const sim = run('Ganyu CA W8', ['Ganyu'], { Ganyu: 1 })
  const arrow = sim.hits.find((h) => h.label === 'Frostflake Arrow')!
  const bloom = sim.hits.find((h) => h.label === 'Frostflake Arrow Bloom')!
  expect(state(arrow, 'Ganyu.C1')).toBe('')
  expect(state(bloom, 'Ganyu.C1')).toBe('on')
  const end = Math.max(
    ...sim.buffWindows.filter((w) => w.path[1] === 'C1').map((w) => w.end)
  )
  expect(end).toBe(bloom.t + 360)
})
