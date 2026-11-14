import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, target?: { radius: number; distance: number }) =>
  simulateRotation({
    rotation: parseRotation(text, [
      { characterKey: 'Xingqiu', name: 'Xingqiu' },
    ]),
    members: ['Xingqiu'],
    elements: { Xingqiu: 'hydro' },
    constellations: { Xingqiu: 6 },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
    target,
  })
const orbitals = (sim: ReturnType<typeof run>) =>
  sim.hits.filter((h) => h.path[1] === 'xingqiuOrbital')

it('starts Hydro orbitals from Raincutter even without casting the skill', () => {
  const hits = orbitals(run('Xingqiu Q W20'))
  // (gcsim applyOrbital(dur, burstHitmark = 18): the first tick 1 frame after, as its frame matrix)
  expect(hits.map((h) => h.t)).toEqual([19, 154, 289, 424, 559, 694, 829, 964])
  expect(hits.every((h) => h.applies && h.path[0] === '_marker')).toBe(true)
})

it('extends the existing orbital chain on burst without restarting its interval', () => {
  const sim = run('Xingqiu E Q W20')
  expect(sim.actions[1].start).toBe(77)
  expect(sim.hits.filter((h) => h.tag === 'skill').map((h) => h.t)).toEqual([
    12, 36,
  ])
  expect(orbitals(sim).map((h) => h.t)).toEqual([
    54, 189, 324, 459, 594, 729, 864, 999, 1134,
  ])
})

it('does not apply contact Hydro when the target is outside orbital reach', () => {
  expect(
    orbitals(run('Xingqiu Q W20', { radius: 1, distance: 10 }))
  ).toHaveLength(0)
})
