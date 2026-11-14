import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['TravelerPyro', 'Bennett']
const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { TravelerPyro: 'pyro', Bennett: 'pyro' },
    constellations: { TravelerPyro: cons },
    repeats: 1,
    keep: 'all',
  })

const c1Ns = (hit: { states?: { path: string[]; value: string }[] }) =>
  hit.states?.find((s) => s.path.join('.') === 'TravelerPyro.c1Ns')?.value

describe('Pyro Traveler', () => {
  it('C1: the active member in their own blessing gets the extra 9%', () => {
    const sim = run('TravelerPyro E N3 -> Bennett E W1', 1)
    const own = sim.hits.filter(
      (h) => h.characterKey === 'TravelerPyro' && h.tag === 'normal'
    )
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((h) => c1Ns(h) === 'on')).toBe(true)
    // Bennett has no Nightsoul's Blessing of his own
    const bennett = sim.hits.find(
      (h) => h.characterKey === 'Bennett' && !h.path[0].startsWith('_')
    )!
    expect(c1Ns(bennett)).toBe('')
  })
})
