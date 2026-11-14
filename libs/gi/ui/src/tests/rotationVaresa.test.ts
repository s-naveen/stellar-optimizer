import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { SimHit } from '../util/teamOpt/rotation/types'

const run = (text: string, cons = 0, members: CharacterKey[] = ['Varesa']) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Varesa: 'electro', Bennett: 'pyro' },
    constellations: { Varesa: cons },
    repeats: 1,
    keep: 'all',
  })

const pinned = (hit: SimHit, cond: string) =>
  hit.states?.find((s) => s.path.join('.') === `Varesa.${cond}`)?.value

describe('Varesa', () => {
  it('turns a normal attack after the Rush into the quick Follow-Up Strike', () => {
    const sim = run('Varesa E N1 W2')
    // the Rush's hit pauses her 4 frames (defense halt): E -> N1 is 22 + 4
    expect(sim.actions[1].start - sim.actions[0].start).toBe(26)
    const hits = sim.hits.filter((h) => h.characterKey === 'Varesa')
    expect(hits.some((h) => /^N\d/.test(h.label))).toBe(false)
    const strike = hits.find((h) => h.label.includes('Follow-Up Strike'))!
    expect(strike.path.join('.')).toBe('charged.dmg')
    expect(strike.t - sim.actions[1].start).toBe(11)
  })

  it('spends Rainbow Crash on the first plunge impact and picks the high plunge after a CA', () => {
    // the Rush's 20 points and the first plunge's 25 fill the gauge: the second is Fiery Passion
    const sim = run('Varesa E N1 P CA P W2')
    const plunges = sim.hits.filter(
      (h) => h.characterKey === 'Varesa' && h.tag === 'plunge'
    )
    expect(plunges.map((h) => h.path.join('.'))).toEqual([
      'plunging.high',
      'plunging.fphigh',
    ])
    expect(plunges.map((h) => pinned(h, 'a1Rainbow'))).toEqual(['on', ''])
  })

  it('gives C4’s Diligent Refinement to the next plunge and +100% only to bursts in Fiery Passion or Apex Drive', () => {
    const sim = run('Varesa Q CA P Q W2', 4)
    const hits = sim.hits.filter((h) => h.characterKey === 'Varesa')
    const kick = hits.find((h) => h.label === 'Flying Kick')!
    expect(pinned(kick, 'c4FpApex')).toBe('')
    const plunge = hits.find((h) => h.label === 'Fiery Passion High Plunge')!
    expect(pinned(plunge, 'c4Diligent')).toBe('on')
    const kablam = hits.find((h) => h.label === 'Volcanic Kablam')!
    expect(pinned(kablam, 'c4Diligent')).toBe('')
    expect(pinned(kablam, 'c4FpApex')).toBe('on')
  })
})
