import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type RotationReactions,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  cons: number,
  reactions: RotationReactions = { onHit() {}, absorbAt: () => undefined }
) => {
  const members: CharacterKey[] = ['LanYan']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { LanYan: 'anemo' },
    constellations: { LanYan: cons },
    repeats: 1,
    keep: 'all',
    reactions,
  })
}
const labels = (sim: ReturnType<typeof run>) =>
  sim.hits.filter((h) => !h.path[0].startsWith('_')).map((h) => h.label)

describe('Lan Yan', () => {
  it('turns a normal attack during the Leap Back into the Feathermoon Rings', () => {
    const sim = run('LanYan E N1 W2', 0)
    expect(labels(sim)).toEqual([
      'Feathermoon Ring',
      'Feathermoon Ring',
      'Feathermoon Ring',
    ])
    // the rings hit 38/62/85 frames after the press at 33, each with a 4-frame defense halt
    const rings = sim.hits.filter((h) => h.label === 'Feathermoon Ring')
    expect(rings.map((h) => h.t)).toEqual([71, 95, 118])
  })

  it('adds the absorbed element (A1) and C1’s extra rings', () => {
    const hydro: RotationReactions = { onHit() {}, absorbAt: () => 'hydro' }
    const c0 = run('LanYan E E W2', 0, hydro)
    expect(
      c0.hits.filter((h) => h.path.join('.') === 'passive1.hydro')
    ).toHaveLength(3)
    const c1 = run('LanYan E E W2', 1, hydro)
    expect(
      c1.hits.filter((h) => h.label.startsWith('Feathermoon Ring (C1)'))
    ).toHaveLength(6)
    // without an aura there is nothing to absorb (and no C1 rings)
    const none = run('LanYan E E W2', 1)
    expect(labels(none)).toHaveLength(3)
  })

  it('has a second charge at C6', () => {
    const c0 = run('LanYan E W2 E', 0)
    const c6 = run('LanYan E W2 E', 6)
    const second = (sim: ReturnType<typeof run>) =>
      sim.actions.filter((a) => a.text === 'E')[1].start
    expect(second(c0)).toBeGreaterThan(900)
    expect(second(c6)).toBeLessThan(200)
  })
})
