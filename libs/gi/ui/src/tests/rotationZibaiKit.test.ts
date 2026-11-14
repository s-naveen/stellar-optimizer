import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Zibai', 'Columbina']
const run = (text: string, constellation: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Zibai: 'geo', Columbina: 'hydro' },
    constellations: { Zibai: constellation },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })
const shifts = (sim: ReturnType<typeof run>) =>
  sim.hits
    .filter((h) => h.characterKey === 'Zibai' && h.tag === 'normal')
    .map((h) => h.path[1])

describe('Zibai (constellations)', () => {
  it('C4 keeps the normal sequence across a Stride, and Scattermoon Splendor powers the next N4', () => {
    expect(shifts(run('Zibai E N1 E N3 W1', 1))).toEqual([
      'shift1Dmg',
      'shift1Dmg',
      'shift2Dmg',
      'shift3Dmg',
      'shift3Dmg',
    ])
    const c4 = run('Zibai E N1 E N3 W1', 4)
    expect(shifts(c4)).toEqual([
      'shift1Dmg',
      'shift2Dmg',
      'shift3Dmg',
      'shift3Dmg',
      'shift4Dmg',
    ])
    const gleam = c4.hits.find((h) => h.path[1] === 'shift4GleamDmg')!
    expect(gleam.states).toContainEqual({
      owner: 'Zibai',
      path: ['Zibai', 'c4Splendor'],
      value: 'on',
    })
  })

  it('C6 elevates by the Radiance spent above 70, and C2 follows the mode', () => {
    const sim = run('Zibai E E W3', 6)
    expect(sim.buffWindows.find((w) => w.path[1] === 'c6Point')?.value).toBe(
      '30'
    )
    const mode = sim.buffWindows.filter((w) => w.path[1] === 'c2ShiftMode')
    expect(mode.some((w) => w.value === 'on')).toBe(true)
  })
})
