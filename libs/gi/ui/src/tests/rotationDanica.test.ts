import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}

describe('Danica', () => {
  it('her third normal hits twice (game data: ×2)', () => {
    const sim = run('Danica N3 W1', ['Danica'])
    const third = sim.hits.filter((h) => h.path.join('.') === 'normal.2')
    expect(third).toHaveLength(2)
    expect(third[0].t).toBe(third[1].t)
  })

  it('uses Anchor normals on-field, builds Excitement, then On-Field Skill E2 enters Battle Maid and skips a stage', () => {
    const sim = run('Danica E N4 E N1 W1', ['Danica'])
    expect(sim.warnings).toEqual([])
    const anchor = sim.hits.filter((h) => h.path[1]?.startsWith('anchor'))
    expect(anchor.map((h) => h.path[1])).toEqual([
      'anchor0',
      'anchor1',
      'anchor2',
      'anchor2',
      'anchor3',
      // after one On-Field Skill E2 the next round starts at the second stage
      'anchor1',
    ])
    expect(anchor.every((h) => h.element === 'electro')).toBe(true)
    const e2 = sim.hits.find((h) => h.path.join('.') === 'skill.onFieldDmg')!
    expect(e2.tag).toBe('directStellarConduct')
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Danica.maidForm' && w.value === 'battle'
      )
    ).toBe(true)
    // the second E is On-Field Skill E2, not a cooldown wait
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
  })

  it('C2 Toast: Stellar-Conduct damage consumes stacks for its +ATK damage', () => {
    const sim = run(
      'Kaeya E -> Danica E -> Mitya E -> Danica Q W3',
      ['Danica', 'Mitya', 'Kaeya', 'Bennett'],
      { Danica: 2 }
    )
    const sc = rotationAttacks(sim).Danica!.filter((a) =>
      a.path[1]?.endsWith('ScDmg')
    )
    expect(sc.length).toBeGreaterThan(0)
    expect(
      sc.every((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(true)
    const none = run('Kaeya E -> Danica E -> Mitya E -> Danica Q W3', [
      'Danica',
      'Mitya',
      'Kaeya',
      'Bennett',
    ])
    expect(
      rotationAttacks(none).Danica!.some((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(false)
  })
})
