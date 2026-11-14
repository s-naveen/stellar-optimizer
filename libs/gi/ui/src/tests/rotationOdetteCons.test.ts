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

describe('Odette constellations', () => {
  it('C4: Stellar Glimmer damage draws a coordinated attack (3.5 s cooldown) and shares Snow Swan’s Dream', () => {
    const sim = run('Odette E Q E W8 -> Bennett E', ['Odette', 'Bennett'], {
      Odette: 4,
    })
    const c4 = sim.hits.filter((h) => h.label.startsWith('Odette C4'))
    expect(c4.length).toBeGreaterThan(0)
    for (let i = 1; i < c4.length; i++)
      expect(c4[i].t - c4[i - 1].t).toBeGreaterThanOrEqual(210)
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Odette.burst' && w.recipient === 'Bennett'
      )
    ).toBe(true)
  })

  it('C1 adds Daybreak Finale on her character clock', () => {
    const sim = run('Odette E E W2', ['Odette'], { Odette: 1 })
    const coda = sim.hits.find((h) =>
      h.label.startsWith("Coda at Dawn's Tolling (Stellar")
    )!
    const c1 = sim.hits.find((h) => h.label.startsWith('Daybreak Finale'))!
    expect(c1.t).toBe(coda.t)
    expect(c1.tag).toBe('directStellarConduct')
  })

  it('C6 keeps her own Splendor while granting it', () => {
    const sim = run('Odette E -> Bennett W5', ['Odette', 'Bennett'], {
      Odette: 6,
    })
    const team = sim.buffWindows.filter(
      (w) => w.path.join('.') === 'Odette.a1TeamSplendor'
    )
    expect(Math.max(...team.map((w) => Number(w.value || 0)))).toBe(6)
  })
})
