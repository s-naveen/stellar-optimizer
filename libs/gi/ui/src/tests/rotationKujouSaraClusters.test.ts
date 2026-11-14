import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const play = (text: string, cons: number) => {
  const members: CharacterKey[] = ['KujouSara', 'RaidenShogun']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { KujouSara: cons },
    elements: { KujouSara: 'electro', RaidenShogun: 'electro' },
    repeats: 1,
    keep: 'all',
  })
}

describe('Kujou Sara', () => {
  it('hits a single enemy with the first two ticks of each Stormcluster only', () => {
    for (const [cons, clusters] of [
      [0, 4],
      [4, 6],
    ] as const) {
      const ticks = play('KujouSara Q W5', cons)
        .hits.filter((h) => h.path.join('.') === 'burst.stormcluster')
        .map((h) => h.t)
      expect(ticks).toEqual([
        ...Array(clusters).fill(100),
        ...Array(clusters).fill(118),
      ])
    }
  })

  it('gives the ATK bonus to the member on the field when it lands, for its 6 s', () => {
    const sim = play('KujouSara Q -> RaidenShogun W8', 0)
    const raiden = sim.buffWindows.filter(
      (w) =>
        w.path.join('.') === 'KujouSara.tenguRecipient' &&
        w.recipient === 'RaidenShogun'
    )
    // the Stormclusters reaching the player land after the swap
    expect(raiden.length).toBeGreaterThan(0)
    expect(
      sim.buffWindows.some(
        (w) =>
          w.path.join('.') === 'KujouSara.tenguRecipient' &&
          w.recipient === 'KujouSara'
      )
    ).toBe(true)
  })

  it('C1: a Tengu Juurai cuts Tengu Stormcall’s cooldown by 1 s, once per 3 s', () => {
    const c0 = play('KujouSara E W2 Q W1 E', 0)
    const c1 = play('KujouSara E W2 Q W1 E', 1)
    const second = (s: typeof c0) =>
      s.actions.filter((a) => a.text === 'E')[1].start
    expect(second(c0) - second(c1)).toBeGreaterThanOrEqual(60)
  })
})
