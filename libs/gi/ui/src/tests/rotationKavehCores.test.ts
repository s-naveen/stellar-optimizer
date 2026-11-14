import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(text: string, members: CharacterKey[]) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 1,
    keep: 'all',
  })
}

describe('Kaveh bursts Dendro Cores', () => {
  it('his skill blooms the existing cores at once instead of at their 5 s expiry', () => {
    // Xingqiu's rain swords + Nahida's mark make cores; Kaveh's E then bursts them
    const blooms = (text: string) =>
      run(text, ['Xingqiu', 'Nahida', 'Kaveh'])
        .hits.filter((h) => h.label?.startsWith('Bloom'))
        .map((h) => h.t)
    const base = blooms('Xingqiu E -> Nahida E -> Kaveh W6')
    const burst = blooms('Xingqiu E -> Nahida E -> Kaveh E W6')
    expect(base.length).toBeGreaterThan(0)
    expect(burst.length).toBe(base.length)
    // at least one core bursts earlier than it would have expired
    expect(Math.min(...burst)).toBeLessThan(Math.min(...base))
  })
})
