import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  members: CharacterKey[],
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kits[m]?.element ?? 'physical'])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
    kits,
    reactions: { onHit() {} },
  })

describe('Cyno Revelation (upstream gcsim)', () => {
  it('enters Pactsworn from Secret Rite; Mortuary Rite waits for its own 180-frame CD', () => {
    const sim = run(['Cyno'], 'Cyno E E N1 W1', { Cyno: kitModels.Cyno })
    const [e1, e2, n1] = sim.actions
    expect(e2.start - e1.start).toBe(197)
    expect(sim.hits.some((h) => h.path.join('.') === 'skill.riteDmg')).toBe(
      true
    )
    // the normal attack after the Rite is a Pactsworn one
    expect(
      sim.hits.find((h) => h.t >= n1.start && h.tag === 'normal')?.path
    ).toEqual(['burst', 'normal_0'])
  })
})

describe('Diona Revelation (Choice Treasures)', () => {
  const probe = (delays: number[]): KitModel => ({
    characterKey: 'Keqing',
    element: 'electro',
    source: 'test',
    act(c) {
      for (const delay of delays)
        c.hit(delay, {
          path: ['_reaction', 'superconduct'],
          tag: 'other',
          element: 'electro',
          label: 'Reaction probe',
        })
      return { frames: 400 }
    },
  })
  const paws = (delays: number[]) => {
    const sim = run(['Diona', 'Keqing'], 'Diona E -> Keqing E W1', {
      Diona: kitModels.Diona,
      Keqing: probe(delays),
    })
    const entry = sim.actions[1].start
    return sim.hits
      .filter((h) => h.label === 'Icy Paw (Revelation)')
      .map((h) => h.t - entry)
  }
  it('fires 3 paws 5-7 frames after a Superconduct, once per 3.5 s (inclusive expiry)', () => {
    expect(paws([0, 100, 210, 211])).toEqual([5, 6, 7, 216, 217, 218])
  })
})

describe('Yae Miko', () => {
  it('lands only the charged attack boxes that reach the 2 m target at 2.4 m', () => {
    const sim = run(['YaeMiko'], 'YaeMiko CA W1', {
      YaeMiko: kitModels.YaeMiko,
    })
    expect(sim.hits.filter((h) => h.tag === 'charged').map((h) => h.t)).toEqual(
      [90, 99]
    )
  })
})
