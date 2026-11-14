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

describe('Wanderer', () => {
  it('a Windfavored burst carries C2 points and the Kuugo multiplier stays on cancelled N3 hits', () => {
    const sim = run('Wanderer E N3 N3 N3 Q W2', ['Wanderer'], { Wanderer: 2 })
    const q = sim.hits.filter((h) => h.path.join('.') === 'burst.dmg')
    expect(q).toHaveLength(5)
    const c2 = q[0].states?.find((s) => s.path[1] === 'c2Points')
    expect(Number(c2?.value)).toBeGreaterThan(0)
    const n3 = sim.hits.filter((h) => h.label === 'Kuugo N3')
    expect(n3.length).toBe(6)
    expect(
      n3.every((h) =>
        h.states?.some((s) => s.path[1] === 'afterSkill' && s.value === 'on')
      )
    ).toBe(true)
  })
  it('the Skill cooldown starts when Windfavored ends', () => {
    const sim = run('Wanderer E W1 E W2 E W1', ['Wanderer'])
    const casts = sim.hits.filter((h) => h.path.join('.') === 'skill.dmg')
    expect(casts).toHaveLength(2)
    // the second press (1 s in) ends it; 6 s of cooldown from there
    expect(casts[1].t - casts[0].t).toBeGreaterThanOrEqual(60 + 360)
  })
  it('a swap waits for Windfavored to end and the fall (no mid-air swap)', () => {
    const held = run('Wanderer E N3 -> Bennett E W1', ['Wanderer', 'Bennett'])
    const ended = run('Wanderer E N3 E -> Bennett E W1', [
      'Wanderer',
      'Bennett',
    ])
    const swapIn = (sim: ReturnType<typeof run>) =>
      sim.actions.find((a) => a.characterKey === 'Bennett')!.start
    // 100 points drain at one per 6 frames: the swap cannot come before ~600 frames
    expect(swapIn(held)).toBeGreaterThan(500)
    // a second cast ends it at once
    expect(swapIn(ended)).toBeLessThan(swapIn(held) - 300)
    expect(held.notes.some((n) => n.includes('before swapping'))).toBe(true)
  })
})
