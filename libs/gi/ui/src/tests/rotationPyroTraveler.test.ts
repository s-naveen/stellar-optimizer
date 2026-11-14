import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { emilieCollateralChance } from '../util/teamOpt/rotation/kits/Emilie'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['TravelerPyro']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { TravelerPyro: 'pyro', Mona: 'hydro', Emilie: 'dendro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}
it('exposes and drains Nightsoul every six character frames, and tags every skill/burst hit', () => {
  const points: [number, boolean, number][] = []
  const original = kitModels.TravelerPyro!
  const probe: KitModel = {
    ...original,
    onStart(c, s) {
      original.onStart?.(c, s)
      for (const t of [19, 24, 25, 378, 379])
        c.at(t, (at) =>
          at.at(0, (after) => {
            const ns = original.nightsoul!(after, s)
            points.push([after.now, ns.active, ns.points])
          })
        )
    },
  }
  const sim = run('TravelerPyro E W8', { kits: { TravelerPyro: probe } })
  expect(sim.warnings).toEqual([])
  expect(points[0]).toEqual([19, true, 42])
  expect(points[1]).toEqual([24, true, 42])
  expect(points[2][2]).toBeCloseTo(41.3)
  expect(points[3][1]).toBe(true)
  expect(points[4]).toEqual([379, false, 0])
  const hits = sim.hits.filter(
    (h) => !h.path[0].startsWith('_') && h.path[0] !== 'reaction'
  )
  expect(hits).toHaveLength(6)
  expect(hits.every((h) => h.nightsoul)).toBe(true)
  expect(
    run('TravelerPyro Q W1').hits.find((h) => h.tag === 'burst')?.nightsoul
  ).toBe(true)
})
it('carries burst points into the next blessing and uses a character-clock cap', () => {
  const sim = run('TravelerPyro Q E W14')
  // Q's first 7 points arrive before entry; all four refunds extend this blessing to 600f.
  const on = sim.buffWindows.filter(
    (w) => w.path[1] === 'c1SkillActive' && w.value === 'on'
  )
  expect(on[0].start).toBe(67)
  expect(on[0].end).toBe(667)
  expect(sim.hits.filter((h) => h.label === 'Blazing Threshold')).toHaveLength(
    10
  )
})
it('allows damage reactions to trigger the held skill while ignoring Burning, Hydro Swirl and markers', () => {
  const mona: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act(c) {
      for (const [i, path] of [
        ['_marker', 'hitlag'],
        ['reaction', 'burning'],
        ['reaction', 'hydroSwirl'],
        ['reaction', 'electroCharged'],
      ].entries())
        c.hit(180 + i, {
          path,
          tag: 'other',
          element: 'electro',
          label: 'Probe',
        })
      return { frames: 1 }
    },
  }
  const sim = run('TravelerPyro hE -> Mona E W7', {
    members: ['TravelerPyro', 'Mona'],
    kits: { TravelerPyro: kitModels.TravelerPyro, Mona: mona },
  })
  const hits = sim.hits.filter((h) => h.label === 'Scorching Threshold')
  expect(hits[0].t).toBe(62)
  const probe = sim.hits.find((h) => h.path[1] === 'electroCharged')!
  expect(hits[1].t).toBe(probe.t + 12)
  expect(hits.every((h) => h.nightsoul)).toBe(true)
})
it('keeps point-drain tasks paused during Traveler’s melee hitlag', () => {
  const sim = run('TravelerPyro E N1 W8')
  const on = sim.buffWindows.find(
    (w) => w.path[1] === 'c1SkillActive' && w.value === 'on'
  )!
  expect(on.end).toBe(379 + 6)
})
it('models Emilie’s 0.7-second targeting mark instead of guaranteeing all nine burst hits', () => {
  expect(emilieCollateralChance(2, 2.4)).toBeCloseTo(20 / 143.75)
  expect(emilieCollateralChance(0, 100)).toBe(0)
  expect(emilieCollateralChance(30, 2.1)).toBeCloseTo(1)
  const sim = run('Emilie Q W5', { members: ['Emilie'] })
  const hits = sim.hits.filter((h) => h.label === 'Lumidouce Case (Level 3)')
  expect(hits.map((h) => h.t)).toEqual([126, 180, 234])
})
