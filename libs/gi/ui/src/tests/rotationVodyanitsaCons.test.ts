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
const stateOf = (
  h: { states?: { path: string[]; value: string }[] },
  name: string
) => h.states?.find((s) => s.path[1] === name)?.value

describe('Vodyanitsa constellations', () => {
  it('plays a held Skill as the ordinary cast in combat', () => {
    const sim = run('Vodyanitsa hE W2', ['Vodyanitsa'])
    expect(sim.warnings).toEqual([])
    expect(sim.hits.some((h) => h.path.join('.') === 'skill.skillDmg')).toBe(
      true
    )
  })

  it('C2 extends Song of Ages Past by 9 s and Horn attacks grant Two Voices', () => {
    const horns = (cons: number) =>
      run('Vodyanitsa E W27', ['Vodyanitsa', 'Bennett'], {
        Vodyanitsa: cons,
      }).hits.filter((h) => h.path.join('.') === 'skill.hornDmg')
    expect(horns(0)).toHaveLength(5)
    expect(horns(2)).toHaveLength(8)
    const sim = run(
      'Vodyanitsa E W5 -> Bennett N4 W2',
      ['Vodyanitsa', 'Bennett'],
      {
        Vodyanitsa: 2,
      }
    )
    const attacks = rotationAttacks(sim)
    const bennett = attacks.Bennett!.filter((a) => a.path[0] === 'normal')
    expect(bennett.every((a) => stateOf(a, 'c2State') === 'voice')).toBe(true)
  })

  it('C1 heals grant the party ATK and C4 stacks Max HP', () => {
    const sim = run('Vodyanitsa E W10', ['Vodyanitsa', 'Bennett'], {
      Vodyanitsa: 4,
    })
    expect(
      sim.buffWindows.filter((w) => w.path.join('.') === 'Vodyanitsa.c1Heal')
        .length
    ).toBeGreaterThan(3)
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Vodyanitsa.c4State' && w.value === 'above3'
      )
    ).toBe(true)
  })
})
