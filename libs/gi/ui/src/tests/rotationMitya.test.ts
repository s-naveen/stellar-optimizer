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

describe('Mitya constellations', () => {
  it('C4 counts Gradient Beacons consumed by the core, not Beacons gained', () => {
    const c4 = (text: string) =>
      run(text, ['Mitya'], { Mitya: 4 }).hits.filter(
        (h) => h.label === 'Mitya C4 (Stellar-Conduct)'
      ).length
    // hold: 1 + C1 1 Beacon, Q: 3 -> five gained, none consumed yet
    expect(c4('Mitya hE Q W1')).toBe(0)
    // Gradient Detonation consumes all five
    expect(c4('Mitya hE Q CA W1')).toBe(1)
  })
})
