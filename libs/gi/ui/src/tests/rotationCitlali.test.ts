import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

describe('Citlali', () => {
  it('builds C6 Cifra points from the Nightsoul points Itzpapa consumes (max 40)', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Citlali E Q W15', [
        { characterKey: 'Citlali', name: 'Citlali' },
      ]),
      members: ['Citlali'],
      elements: { Citlali: 'cryo' },
      constellations: { Citlali: 6 },
      repeats: 1,
      keep: 'all',
    })
    const values = sim.buffWindows
      .filter((w) => w.path.join('.') === 'Citlali.c6NsConsumed' && w.value)
      .sort((a, b) => a.start - b.start)
      .map((w) => Number(w.value))
    // a ramp (8 points a second while Opal Fire burns), not an instant cap
    expect(values.length).toBeGreaterThan(3)
    expect(values[0]).toBeLessThan(10)
    expect(Math.max(...values)).toBe(40)
    for (let i = 1; i < values.length; i++)
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
  })
})
