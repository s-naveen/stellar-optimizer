import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Sandrone']
const run = (text: string) =>
  simulateRotation({
    rotation: parseRotation(text, [
      { characterKey: 'Sandrone', name: 'Sandrone' },
    ]),
    members,
    constellations: { Sandrone: 0 },
    elements: { Sandrone: 'cryo' },
    repeats: 1,
    keep: 'all',
  })

describe('Sandrone Power Overdrive', () => {
  it('fires every 24 frames after a full Decoding charge, until Decoding Power is under 50', () => {
    const sim = run('Sandrone CA CA W5')
    const shots = sim.hits.filter((h) => h.label === 'Power Overdrive')
    expect(sim.warnings).toEqual([])
    expect(shots.length).toBeGreaterThan(5)
    expect(shots[1].t - shots[0].t).toBe(24)
    // Decoding Power decays from 100 to under 50 in about 10 s on field
    expect(shots.at(-1)!.t - shots[0].t).toBeLessThanOrEqual(600)
  })
  it('is not available before Decoding Power reaches its maximum', () => {
    const sim = run('Sandrone CA W5')
    expect(sim.hits.filter((h) => h.label === 'Power Overdrive')).toHaveLength(
      0
    )
  })
})
