import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const play = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    repeats: 1,
    keep: 'all',
  })

describe('Bennett', () => {
  it('holds Passion Overload at Charge Level 1 (gcsim hold=1): two strikes on his clock', () => {
    const sim = play('Bennett hE W2', ['Bennett'])
    expect(
      sim.hits
        .filter((h) => h.characterKey === 'Bennett' && h.tag === 'skill')
        .map((h) => [h.path.join('.'), h.t])
    ).toEqual([
      ['skill.hold1_1', 45],
      ['skill.hold1_2', 66],
    ])
    // the earliest cancel (dash, 65) plus both strikes' hitlag
    expect(sim.waits?.[0].start).toBe(83)
  })

  it('halves the press cooldown only while the field buff is on him (A4)', () => {
    const sim = play('Bennett Q E N1 E W1', ['Bennett'])
    const presses = sim.actions.filter((a) => a.text === 'E')
    // 300 × 0.8 × 0.5 = 120 frames from the cooldown start (14 frames in)
    expect(presses[1].start - presses[0].start).toBeLessThanOrEqual(14 + 120)
  })
})
