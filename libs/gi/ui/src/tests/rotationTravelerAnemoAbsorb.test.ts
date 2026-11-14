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

describe('Anemo Traveler', () => {
  it('absorbs Pyro into the hold Palm Vortex and Gust Surge; C6 cuts Anemo and Pyro RES after the first hit', () => {
    const sim = run(
      'Bennett E -> TravelerAnemo hE Q W6',
      ['Bennett', 'TravelerAnemo'],
      {
        TravelerAnemo: 6,
      }
    )
    const absorbed = sim.hits.filter(
      (h) => h.characterKey === 'TravelerAnemo' && h.element === 'pyro'
    )
    expect(absorbed.some((h) => h.path[1] === 'storm_ele_max')).toBe(true)
    const q = sim.hits.filter((h) => h.path.join('.') === 'burst.dmg')
    expect(q).toHaveLength(9)
    const c6 = sim.buffWindows.find(
      (w) => w.path.join('.') === 'TravelerAnemo.anemoC6Hit'
    )!
    expect(c6.start).toBe(q[0].t + 1)
    expect(c6.end).toBe(q[8].t + 600)
  })
  it('Slitting Wind lands after the N5 hit and its hitlag', () => {
    const sim = run('TravelerAnemo N5 W1', ['TravelerAnemo'])
    const n5 = sim.hits.find((h) => h.path.join('.') === 'normal.4')!
    const a1 = sim.hits.find((h) => h.path.join('.') === 'passive1.dmg')!
    expect(a1.t - n5.t).toBe(17)
  })
})
