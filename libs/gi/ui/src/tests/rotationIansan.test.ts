import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(text, [{ characterKey: 'Iansan', name: 'Iansan' }]),
    members: ['Iansan'],
    elements: { Iansan: 'electro' },
    constellations: { Iansan: cons },
    repeats: 1,
    keep: 'all',
  })

const precise = (sim: ReturnType<typeof run>) =>
  sim.buffWindows.filter(
    (w) => w.path.join('.') === 'Iansan.a1Precise' && w.value === 'on'
  )

describe('Iansan', () => {
  it('gains Precise Movement from the burst only at C2', () => {
    expect(precise(run('Iansan Q W3', 0))).toHaveLength(0)
    const [window] = precise(run('Iansan Q W3', 2))
    expect(window.start).toBe(0)
  })

  it('ends Precise Movement with her Nightsoul’s Blessing', () => {
    const sim = run('Iansan E CA W20', 0)
    const [window] = precise(sim)
    // the Swift Stormflight's hit starts it; the 16 s blessing (or its points) ends it before 15 s
    expect(window.start).toBeGreaterThan(0)
    expect(window.end - window.start).toBeLessThan(15 * 60)
  })
})
