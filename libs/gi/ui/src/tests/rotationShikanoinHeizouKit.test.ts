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

describe('Shikanoin Heizou', () => {
  it('a full hold releases with 4 Declension stacks (Conviction) and its 8-frame hitlag', () => {
    const sim = run('ShikanoinHeizou hE W2', ['ShikanoinHeizou'], {
      ShikanoinHeizou: 6,
    })
    const hit = sim.hits.find((h) => h.path.join('.') === 'skill.dmg')!
    expect(hit.states).toContainEqual({
      owner: 'ShikanoinHeizou',
      path: ['ShikanoinHeizou', 'declensionStacks'],
      value: '4',
    })
    expect(sim.actions[0].frames).toBe(180 + 30 + 8)
  })
  it('A1: Swirls on the field add Declension stacks', () => {
    const sim = run('Bennett E -> ShikanoinHeizou N4 E W2', [
      'Bennett',
      'ShikanoinHeizou',
    ])
    const hit = sim.hits.find((h) => h.path.join('.') === 'skill.dmg')!
    const stacks = hit.states?.find((s) => s.path[1] === 'declensionStacks')
    expect(Number(stacks?.value)).toBeGreaterThan(0)
  })
})
