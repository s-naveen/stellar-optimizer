import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Zibai', 'Linnea', 'Columbina', 'Illuga']
const text =
  'bina EQ -> illuga EQ -> linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> bina'

describe('rotation simulator', () => {
  it('parses the rotation', () => {
    const p = parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    )
    expect(p.warnings).toEqual([])
    expect(p.steps.map((s) => s.characterKey)).toEqual([
      'Columbina',
      'Illuga',
      'Linnea',
      'Zibai',
    ])
    expect(p.loopsTo).toBe('Columbina')
    expect(p.steps[3].actions.map((a) => a.text).join(' ')).toBe(
      'E N1 E N4 E N4 Q E N2 E'
    )
  })
  it('simulates it', () => {
    const p = parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    )
    const sim = simulateRotation({
      rotation: p,
      members,
      constellations: { Zibai: 1, Columbina: 0, Linnea: 2, Illuga: 6 },
      elements: {
        Zibai: 'geo',
        Linnea: 'geo',
        Columbina: 'hydro',
        Illuga: 'geo',
      },
    })
    console.log(
      `rotation ${(sim.frames / 60).toFixed(2)} s, ${sim.hits.length} hits`
    )
    console.log('warnings', sim.warnings, 'notes', sim.notes)
    const counts = new Map<string, number>()
    for (const h of sim.hits)
      counts.set(
        `${h.characterKey} ${h.label}`,
        (counts.get(`${h.characterKey} ${h.label}`) ?? 0) + 1
      )
    for (const [k, v] of counts) console.log(`  ${v} × ${k}`)
    const attacks = rotationAttacks(sim)
    for (const [ck, list] of Object.entries(attacks))
      for (const a of list!)
        console.log(
          `  ${ck} ${a.path.join('.')} ×${a.hits} on=${a.onField} states=${(a.states ?? []).map((s) => `${s.path[1]}=${s.value}`).join(',')} off=${(a.limits ?? []).map((l) => l.path[1]).join(',')}`
        )
  })
})
