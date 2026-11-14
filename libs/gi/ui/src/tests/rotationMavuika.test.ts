import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Mavuika', 'Bennett']
const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Mavuika: 'pyro', Bennett: 'pyro' },
    constellations: { Mavuika: cons },
    repeats: 1,
    keep: 'all',
  })

/** The state of one of Mavuika's conditionals at frame t */
const stateAt = (
  sim: ReturnType<typeof run>,
  cond: string,
  t: number
): string =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Mavuika' &&
        w.path.join('.') === `Mavuika.${cond}` &&
        w.start <= t &&
        t < w.end
    )
    .map((w) => w.value)
    .at(-1) ?? ''

describe('Mavuika', () => {
  it('deals C6’s 200% Flamestrider crash in Ring form and the 500% Scorching Ring in Flamestrider form', () => {
    const ring = run('Mavuika E W5', 6).hits.filter(
      (h) => h.path[0] === 'constellation6'
    )
    expect(ring.length).toBeGreaterThan(0)
    expect(ring.every((h) => h.path[1] === 'flamestriderDmg')).toBe(true)
    const bike = run('Mavuika hE W5', 6).hits.filter(
      (h) => h.path[0] === 'constellation6'
    )
    expect(bike.length).toBeGreaterThan(0)
    expect(bike.every((h) => h.path[1] === 'ringDmg')).toBe(true)
  })

  it('keeps C1’s ATK on while she gains Fighting Spirit, and C2’s Ring shred only in Ring form', () => {
    const sim = run('Mavuika E W3', 2)
    const tick = sim.hits.find((h) => h.label === 'Rings of Searing Radiance')!
    expect(stateAt(sim, 'c1GainSpirit', tick.t)).toBe('on')
    expect(stateAt(sim, 'c2RingForm', tick.t)).toBe('on')
    const bike = run('Mavuika hE N2 W1', 2)
    const hit = bike.hits.find((h) => h.label === 'Flamestrider N1')!
    expect(stateAt(bike, 'c2RingForm', hit.t)).toBe('')
  })

  it('turns the Flamestrider back into the Ring when she leaves the field', () => {
    const sim = run('Mavuika hE N1 -> Bennett E W4', 0)
    const swap = sim.actions.find((a) => a.characterKey === 'Bennett')!.start
    expect(
      sim.hits.some(
        (h) => h.label === 'Rings of Searing Radiance' && h.t > swap
      )
    ).toBe(true)
  })
})
