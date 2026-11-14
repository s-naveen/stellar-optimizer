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

describe('Vesna constellations', () => {
  it('C1: four max-level Windborne Swords, the first one free', () => {
    const sim = run('Vesna E E E Q E E N6 E N6 E W1', ['Vesna'], { Vesna: 1 })
    expect(
      sim.hits.filter(
        (h) => h.label === 'Windborne Blade Lv. 3 Spirit Blade Final'
      )
    ).toHaveLength(4)
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
  })

  it('C2: maximum Disciplinary Action on entering Armed for Action', () => {
    const sim = run('Vesna E E W1', ['Vesna'], { Vesna: 2 })
    const blade = sim.hits.find((h) => h.label === 'Windborne Blade Lv. 1')!
    expect(blade).toBeTruthy()
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Vesna.a1Stacks' && w.value === '6'
      )
    ).toBe(true)
  })

  it('C6: a tap after a max-level Windborne Sword unleashes Transpose', () => {
    const sim = run('Vesna E E E Q E N6 W1', ['Vesna'], { Vesna: 6 })
    expect(
      sim.hits.filter((h) =>
        h.label.startsWith('Windborne Sword: Transpose (C6)')
      )
    ).toHaveLength(1)
    const blade = sim.hits.find((h) =>
      h.label.startsWith('Windborne Sword: Transpose Spirit Blade')
    )!
    expect(blade.path.join('.')).toBe('constellation6.swordDmg')
    // the rest of the string still plays: five normals after Transpose
    expect(sim.hits.filter((h) => h.tag === 'normal')).toHaveLength(6)
    expect(sim.warnings).toEqual([])
  })
})
