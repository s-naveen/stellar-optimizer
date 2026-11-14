import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Ifa', 'Bennett']
const run = (text: string, cons = 0) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Ifa: 'anemo', Bennett: 'pyro' },
    constellations: { Ifa: cons },
    repeats: 1,
    keep: 'all',
  })

describe('Ifa', () => {
  it('cannot swap out during the blessing, then waits for the fall', () => {
    const sim = run('Ifa E N2 -> Bennett E W1')
    const swapIn = sim.actions.find((a) => a.characterKey === 'Bennett')!.start
    // the blessing runs out 598 frames into the E; swaps are locked 37 frames more (+12 swap)
    expect(swapIn).toBe(598 + 37 + 12)
  })

  it('lands no Tonic Shot after the blessing ends, and its Charged Attack is Anemo', () => {
    const sim = run('Ifa E N12 CA W1')
    const shots = sim.hits.filter((h) => h.label === 'Tonic Shot')
    expect(shots.every((h) => h.t < 598)).toBe(true)
    expect(shots.length).toBeLessThan(12)
    const ca = sim.hits.find((h) => h.label === 'Charged Attack')
    if (ca) expect(ca.element).toBe('anemo')
  })

  it('places a Sedation Mark only on an aura', () => {
    expect(run('Ifa Q W2').hits.some((h) => h.label === 'Sedation Mark')).toBe(
      false
    )
    expect(
      run('Bennett E -> Ifa Q W2').hits.some(
        (h) => h.label === 'Sedation Mark' && h.element === 'pyro'
      )
    ).toBe(true)
  })
})
