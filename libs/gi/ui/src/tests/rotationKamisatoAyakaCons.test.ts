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

it("Ayaka's Sprint infusion runs on her clock, so her hitlag extends it", () => {
  const sim = run('KamisatoAyaka D N5 N5 N5 W1', ['KamisatoAyaka'])
  const cryo = sim.hits.filter(
    (h) => h.tag === 'normal' && h.element === 'cryo'
  )
  // 20 + 300 world frames would end it; her own hitlag carries it past
  expect(Math.max(...cryo.map((h) => h.t))).toBeGreaterThan(320)
})

it('Ayaka C1 shortens Hyouka by its expected cooldown reduction', () => {
  const second = (cons: number) =>
    run('KamisatoAyaka E D N2 CA N2 CA N2 CA E W1', ['KamisatoAyaka'], {
      KamisatoAyaka: cons,
    }).actions.filter((a) => a.text === 'E')[1].start
  expect(second(1)).toBeLessThan(second(0))
})

it('Ayaka C6: Usurahi Butou covers a Charged Attack, then returns 10.5 s later on her clock', () => {
  const sim = run('KamisatoAyaka CA N2 CA W11 CA W1', ['KamisatoAyaka'], {
    KamisatoAyaka: 6,
  })
  const cas = sim.hits.filter((h) => h.tag === 'charged')
  expect(cas.map((h) => state(h, 'KamisatoAyaka.C6'))).toEqual([
    'c6',
    'c6',
    'c6',
    '',
    '',
    '',
    'c6',
    'c6',
    'c6',
  ])
})
