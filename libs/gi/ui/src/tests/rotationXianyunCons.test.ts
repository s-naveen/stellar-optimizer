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

describe('Xianyun constellations', () => {
  it('C1: a second White Clouds at Dawn charge; C6: no cooldown within 16 s of the burst', () => {
    const c0 = run('Xianyun E P E P W1', ['Xianyun'], { Xianyun: 0 })
    const c1 = run('Xianyun E P E P W1', ['Xianyun'], { Xianyun: 1 })
    expect(c1.frames).toBeLessThan(c0.frames - 500)
    const c6 = run('Xianyun Q E P E P E P W1', ['Xianyun'], { Xianyun: 6 })
    expect(c6.notes.some((n) => /Waited .* E/.test(n))).toBe(false)
  })
  it('C6: Driftcloud Wave carries the Skyladders used; A1 stacks up to 4', () => {
    const sim = run('Xianyun E E E P W1', ['Xianyun'], { Xianyun: 6 })
    const wave = sim.hits.find((h) => h.path[1] === 'thirdLeapDmg')!
    expect(wave.states).toContainEqual({
      owner: 'Xianyun',
      path: ['Xianyun', 'c6SkyladderUses'],
      value: '3',
    })
    expect(
      sim.buffWindows.find((w) => w.path.join('.') === 'Xianyun.a1Stacks')?.max
    ).toBe(4)
  })
})
