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

describe('Valeriy tooltip and constellations', () => {
  it('a Normal Attack right after his Skill becomes Direct-Fire Mortar', () => {
    const sim = run('Valeriy E N3 W1', ['Valeriy'])
    expect(
      sim.hits.filter((h) => h.path.join('.') === 'charged.mortarDmg')
    ).toHaveLength(1)
    expect(sim.hits.filter((h) => h.tag === 'normal')).toHaveLength(2)
    const later = run('Valeriy E W1 N1 W1', ['Valeriy'])
    expect(
      later.hits.some((h) => h.path.join('.') === 'charged.mortarDmg')
    ).toBe(false)
  })

  it('C2 grants 100 EM for 18 s', () => {
    const sim = run('Valeriy E W20', ['Valeriy'], { Valeriy: 2 })
    const c2 = sim.buffWindows.find(
      (w) => w.path.join('.') === 'Valeriy.c2Skill' && w.value === 'on'
    )!
    expect(c2.end - c2.start).toBe(1080)
  })
})
