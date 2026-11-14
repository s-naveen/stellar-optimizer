import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Kachina', 'Bennett']
const run = (text: string, cons = 0) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Kachina: cons, Bennett: 0 },
    elements: { Kachina: 'geo', Bennett: 'pyro' },
    repeats: 1,
    keep: 'all',
  })
const slams = (sim: ReturnType<typeof run>, label: string) =>
  sim.hits.filter((h) => h.characterKey === 'Kachina' && h.label === label)

describe('Kachina', () => {
  it('slams with the independent Twirly every 2 s until 60 Nightsoul points drain (24 s)', () => {
    const sim = run('Kachina E W30')
    const t = slams(sim, 'Turbo Twirly').map((h) => h.t)
    // drain 2.5 / s from 60 points: the Blessing (and Twirly) end at 24 s
    expect(t.length).toBeGreaterThanOrEqual(11)
    expect(t.length).toBeLessThanOrEqual(12)
    expect(t[1] - t[0]).toBe(120)
    expect(Math.max(...t)).toBeLessThan(24 * 60 + 40)
  })
  it('spends 10 points per mounted slam (the Blessing ends sooner)', () => {
    const idle = slams(run('Kachina hE W30'), 'Turbo Twirly (mounted)')
    expect(idle).toHaveLength(0)
    const sim = run('Kachina hE N3 W30')
    expect(slams(sim, 'Turbo Twirly (mounted)')).toHaveLength(3)
  })
  it('C2: the burst brings back a Twirly with 20 points', () => {
    const c0 = slams(run('Kachina Q W30'), 'Turbo Twirly')
    const c2 = slams(run('Kachina Q W30', 2), 'Turbo Twirly')
    expect(c0).toHaveLength(0)
    // 20 points last 8 s: three or four slams
    expect(c2.length).toBeGreaterThanOrEqual(3)
    expect(c2.length).toBeLessThanOrEqual(4)
  })
})
