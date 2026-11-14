import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const play = (text: string) => {
  const members: CharacterKey[] = ['Yanfei', 'Xingqiu']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Yanfei: 'pyro', Xingqiu: 'hydro' },
    repeats: 1,
    keep: 'all',
  })
}

describe('Yanfei', () => {
  it('deals Signed Edict’s damage 32 frames in', () => {
    const sim = play('Yanfei E W2')
    expect(
      sim.hits.filter((h) => h.path.join('.') === 'skill.dmg').map((h) => h.t)
    ).toEqual([32])
  })

  it('ends Brilliance when she leaves the field', () => {
    const sim = play('Yanfei Q W1 -> Xingqiu E W5 -> Yanfei W1')
    const swap = sim.actions.find((a) => a.characterKey === 'Xingqiu')!.start
    const on = sim.buffWindows.filter(
      (w) => w.path.join('.') === 'Yanfei.afterBurst' && w.value === 'on'
    )
    expect(on.length).toBe(1)
    expect(on[0].end).toBeLessThanOrEqual(swap)
  })
})
