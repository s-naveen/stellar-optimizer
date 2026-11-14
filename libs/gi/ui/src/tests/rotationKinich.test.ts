import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(text, [{ characterKey: 'Kinich', name: 'Kinich' }]),
    members: ['Kinich'],
    elements: { Kinich: 'dendro' },
    constellations: { Kinich: cons },
    repeats: 1,
    keep: 'all',
  })

describe('Kinich', () => {
  it('gives the C6 bounce the Cannon’s own C2 first-shot bonus', () => {
    const sim = run('Kinich E N6 E W2', 6)
    const state = (label: string) =>
      sim.hits
        .find((h) => h.label === label)
        ?.states?.find((s) => s.path.join('.') === 'Kinich.c2FirstHit')?.value
    expect(state('Scalespiker Cannon')).toBe('on')
    expect(state('Scalespiker Cannon (C6)')).toBe('on')
  })

  it('builds Nightsoul points one at a time, 30 frames apart from the blessing’s start', () => {
    // 20 points: 1 every 30 frames from 39 frames in, +3 per Loop Shot, +4 for the blind spot.
    // Without shots the Cannon is ready on the 20th tick (39 + 19 x 30 = 609 frames in).
    const sim = run('Kinich E W9.5 E W2', 0)
    const cannon = sim.actions.filter((a) => a.text === 'E')[1]
    expect(cannon.start).toBeGreaterThanOrEqual(609)
    expect(sim.hits.some((h) => h.label.startsWith('Scalespiker Cannon'))).toBe(
      true
    )
  })
})
