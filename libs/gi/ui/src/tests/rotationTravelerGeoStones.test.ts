import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}

describe('Geo Traveler', () => {
  it('C2: a fourth meteorite destroys the oldest of three, which explodes', () => {
    const sim = run('TravelerGeo E W6 E W6 E W6 E W1', ['TravelerGeo'], {
      TravelerGeo: 2,
    })
    const casts = sim.hits.filter((h) => h.path.join('.') === 'skill.dmg')
    const blasts = sim.hits.filter(
      (h) => h.path.join('.') === 'constellation2.dmg'
    )
    expect(casts).toHaveLength(4)
    expect(blasts).toHaveLength(1)
    expect(blasts[0].t).toBe(casts[3].t)
  })
  it('the burst snapshots at the cast; C1 lasts until 2 s after the last 1 s tick', () => {
    const sim = run('TravelerGeo Q W16', ['TravelerGeo'], { TravelerGeo: 1 })
    const q = sim.hits.filter((h) => h.path.join('.') === 'burst.dmg')
    expect(q.every((h) => h.snapshotT === sim.actions[0].start)).toBe(true)
    const c1 = sim.buffWindows.find(
      (w) => w.path.join('.') === 'TravelerGeo.geoC1BurstArea'
    )!
    expect(c1.end - c1.start).toBe(900)
  })
})
