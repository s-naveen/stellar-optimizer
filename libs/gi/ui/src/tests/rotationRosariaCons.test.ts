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

it('Rosaria C1 speeds up the normals after her first (assumed CRIT) hit', () => {
  const hits = (cons: number) =>
    run('Rosaria N3 W2', ['Rosaria'], { Rosaria: cons })
      .hits.filter((h) => h.tag === 'normal')
      .map((h) => h.t)
  // gcsim's C6 frame matrix with an N1 crit: [9, 40, 75, 84]
  expect(hits(0)).toEqual([9, 40, 77, 86])
  expect(hits(1)).toEqual([9, 40, 75, 84])
  const sim = run('Rosaria N3 W2', ['Rosaria'], { Rosaria: 1 })
  const n1 = sim.hits.find((h) => h.label === 'N1')!
  const n2 = sim.hits.find((h) => h.label === 'N2')!
  // the hit that triggers it is not buffed itself
  expect(state(n1, 'Rosaria.RosariaC1')).toBe('')
  expect(state(n2, 'Rosaria.RosariaC1')).toBe('on')
})

it('Rosaria C6 refreshes the Physical RES shred on every Rites hit, after the hit', () => {
  const sim = run('Rosaria Q W16', ['Rosaria'], { Rosaria: 6 })
  const rites = sim.hits.filter((h) => h.tag === 'burst')
  expect(state(rites[0], 'Rosaria.DilucC6')).toBe('')
  expect(state(rites[1], 'Rosaria.DilucC6')).toBe('on')
  const last = rites[rites.length - 1]
  const end = Math.max(
    ...sim.buffWindows.filter((w) => w.path[1] === 'DilucC6').map((w) => w.end)
  )
  expect(end).toBe(last.t + 600)
})

it('Rosaria waits start at the earliest cancel of her skill and burst', () => {
  for (const [text, lead] of [
    ['Rosaria E W1', 42],
    ['Rosaria Q W1', 61],
  ] as const) {
    const sim = run(text, ['Rosaria'])
    expect(sim.waits![0].start - sim.actions[0].start).toBe(lead)
  }
})
