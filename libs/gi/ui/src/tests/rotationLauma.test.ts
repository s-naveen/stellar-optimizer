import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, cons: number) => {
  const members: CharacterKey[] = ['Lauma']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Lauma: 'dendro' },
    constellations: { Lauma: cons },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })
}

describe('Lauma C6', () => {
  it('converts normal attacks with Pale Hymn stacks into Lunar-Bloom DMG', () => {
    const c0 = run('Lauma Q N3 W1', 0)
    expect(c0.hits.filter((h) => h.path[0] === 'normal')).toHaveLength(3)
    const c6 = run('Lauma Q N3 W1', 6)
    const converted = c6.hits.filter(
      (h) => h.path.join('.') === 'constellation6.dmg2'
    )
    expect(converted).toHaveLength(3)
    expect(converted.every((h) => !h.applies)).toBe(true)
  })

  it('gains 2 Pale Hymn stacks per Frostgrove Lunar-Bloom hit', () => {
    // without the burst, the Frostgrove C6 hits alone give the stacks (at 78 and 195): a
    // converted normal spends one and its Lunar-Bloom hit another, so N2 (at ~185) has none left
    const sim = run('Lauma E W2 N3 W1', 6)
    expect(
      sim.hits.filter((h) => h.path.join('.') === 'constellation6.dmg1').length
    ).toBeGreaterThan(0)
    expect(
      sim.hits
        .filter((h) => h.characterKey === 'Lauma' && h.label.startsWith('N'))
        .map((h) => h.path.join('.'))
    ).toEqual(['constellation6.dmg2', 'normal.1', 'constellation6.dmg2'])
  })
})
