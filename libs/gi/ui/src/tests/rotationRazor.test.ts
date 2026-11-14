import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { RotationCalculation } from '../util/teamOpt/rotation/types'

const run = (text: string, hp = 40000, dahliaCons = 6) => {
  const members: CharacterKey[] = ['Razor', 'Dahlia']
  const calculate: RotationCalculation = (_member, path) =>
    path.join('.') === 'total.hp' ? hp : undefined
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Razor: 6, Dahlia: dahliaCons },
    elements: { Razor: 'electro', Dahlia: 'hydro' },
    calculate,
    repeats: 1,
    keep: 'all',
  })
}

it('applies Razor’s burst speed to normals without requiring Dahlia', () => {
  const sim = run('Razor Q N4 N4 W1')
  expect(sim.actions.filter((a) => a.text === 'N4')[0].frames).toBe(198)
})

it('uses Dahlia’s normal-state-only speed after the first normal, including inside grouped strings', () => {
  const sim = run('Dahlia Q -> Razor Q N4 N4 W1')
  const actions = sim.actions.filter((a) => a.text === 'N4')
  // W1 queues at N4's hitmark, before that hit's four-frame pause.
  expect(actions.map((a) => a.frames)).toEqual([179, 133])
  const first = actions[0].start
  expect(
    sim.hits
      .filter((h) => h.characterKey === 'Razor' && h.tag === 'normal')
      .slice(0, 4)
      .map((h) => h.t - first)
  ).toEqual([25, 54, 77, 137])
})

it('scales Dahlia A4 from evaluated HP and adds C6 separately', () => {
  const text = 'Dahlia Q -> Razor Q N4 N4 W1'
  expect(
    run(text, 20000, 0).actions.filter((a) => a.text === 'N4')[0].frames
  ).toBe(189)
  expect(
    run(text, 20000, 6).actions.filter((a) => a.text === 'N4')[0].frames
  ).toBe(179)
  expect(
    run(text, 80000, 6).actions.filter((a) => a.text === 'N4')[0].frames
  ).toBe(179)
})

it('expires Dahlia’s speed and Razor’s stance before later unbuffed normals', () => {
  const sim = run('Dahlia Q -> Razor Q W17 N4 N4 W1')
  expect(sim.actions.filter((a) => a.text === 'N4')[0].frames).toBe(257)
})

it('keeps the C6 discharge cooldown on Razor’s paused character clock', () => {
  const sim = run('Dahlia Q -> Razor E Q N4 N4 N4 N4 W1')
  expect(
    sim.hits.filter((h) => h.label === 'Lupus Fulguris (C6)')
  ).toHaveLength(1)
})
