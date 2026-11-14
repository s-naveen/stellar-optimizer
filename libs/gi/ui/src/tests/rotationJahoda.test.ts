import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { HitElement } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Jahoda', 'Ineffa']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Jahoda: 'anemo', Ineffa: 'electro' },
    constellations: { Jahoda: 6 },
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}
it('drains an unfilled flask after the pursuit timeout when there is no enemy aura', () => {
  const sim = run('Jahoda E Q W2', {
    reactions: { onHit() {}, absorbAt: () => undefined },
  })
  expect(sim.actions.find((a) => a.text === 'Q')?.start).toBe(406)
  expect(sim.hits.find((h) => h.label === 'Unfilled Treasure Flask')?.t).toBe(
    368
  )
  expect(sim.hits.some((h) => h.label.includes('Meowball'))).toBe(false)
  expect(sim.hits.some((h) => h.label.includes('Robot'))).toBe(false)
})
it('uses actual aura for the flask and each robot, independently of roster priority', () => {
  const sim = run('Jahoda E Q W24', {
    reactions: { onHit() {}, absorbAt: () => 'hydro' },
  })
  expect(sim.actions.find((a) => a.text === 'Q')?.start).toBe(203)
  expect(sim.hits.find((h) => h.label === 'Filled Treasure Flask')?.t).toBe(163)
  const meows = sim.hits.filter((h) => h.label === 'Meowball')
  expect(meows).toHaveLength(9)
  expect(meows.every((h) => h.element === 'hydro')).toBe(true)
  const robots = sim.hits.filter((h) => h.label.includes('Robot'))
  expect(robots).toHaveLength(17)
  expect(
    robots.every((h) => h.element === 'hydro' && h.icd === 'JahodaBurst_hydro')
  ).toBe(true)
  expect(robots[0].t).toBe(250)
  expect(robots[0].statSnapshots?.[0]).toEqual({
    stat: 'atk',
    path: ['total', 'atk'],
    t: 209,
    onField: 'Jahoda',
  })
  expect(
    sim.hits.filter((h) => h.label === 'Meowball (C1 bounce)')
  ).toHaveLength(4)
  const attacks = rotationAttacks(sim).Jahoda!
  expect(
    attacks
      .filter((a) => a.description === 'Meowball')
      .reduce((n, a) => n + a.hits, 0)
  ).toBe(9)
  expect(
    attacks
      .filter((a) => a.description === 'Meowball (C1 bounce)')
      .reduce((n, a) => n + a.hits, 0)
  ).toBe(4)
})
it('retries robot absorption when aura is absent and keeps each robot’s absorbed element', () => {
  const sim = run('Jahoda Q W14', {
    reactions: {
      onHit() {},
      absorbAt: (t) => (t < 100 ? undefined : t < 140 ? 'cryo' : 'electro'),
    },
  })
  const first = new Map<HitElement, number>()
  for (const h of sim.hits.filter((h) => h.label.includes('Robot')))
    if (!first.has(h.element)) first.set(h.element, h.t)
  expect(first.get('cryo')).toBe(175) // third robot: 88 + 46 retry + 41 travel
  expect(first.get('electro')).toBe(185) // first robot: 6 + 3*46 retry + 41 travel
})
it('requires Ascendant Gleam for Meowballs, robot damage and C6', () => {
  const sim = run('Jahoda E Q W24', {
    members: ['Jahoda'],
    reactions: { onHit() {}, absorbAt: () => 'hydro' },
  })
  expect(sim.hits.some((h) => /Meowball|Robot/.test(h.label))).toBe(false)
  expect(sim.buffWindows.some((w) => w.path[1] === 'c6FlaskFull')).toBe(false)
})
it('lets a second skill drain early without waiting for full pursuit or its cooldown', () => {
  const sim = run('Jahoda E E Q W1', {
    reactions: { onHit() {}, absorbAt: () => 'hydro' },
  })
  expect(sim.actions.map((a) => a.start)).toEqual([0, 42, 84])
  expect(sim.hits.find((h) => h.label === 'Unfilled Treasure Flask')?.t).toBe(
    46
  )
})
it('includes Flins’ native hitlag in normal chains and the Manifest Flame character clock', () => {
  const sim = run('Flins E N3 N3 Q W14', {
    members: ['Flins'],
    elements: { Flins: 'electro' },
    constellations: {},
  })
  expect(sim.actions.find((a) => a.text === 'Q')?.start).toBe(19 + 201)
  const hits = sim.hits.filter((h) => h.label.includes('Manifest Flame'))
  expect(hits.map((h) => h.t)).toEqual([30, 49, 75, 108, 117, 157, 215])
})
