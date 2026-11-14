import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Linnea', 'Zibai']
/** Ten direct Lunar-Crystallize hits, 30 frames apart */
const lunar: KitModel = {
  characterKey: 'Zibai',
  element: 'geo',
  source: 'test',
  act(ctx) {
    for (let i = 0; i < 10; i++)
      ctx.hit(30 * i, {
        path: ['skill', 'stride2Dmg'],
        tag: 'directLunarCrystallize',
        element: 'geo',
        label: 'Probe',
      })
    return { frames: 1 }
  },
}
const run = (text: string, constellation: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Linnea: 'geo', Zibai: 'geo' },
    constellations: { Linnea: constellation },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
    kits: { Linnea: kitModels.Linnea, Zibai: lunar },
  })
const catalog = (sim: ReturnType<typeof run>) =>
  sim.hits
    .filter((h) => h.label === 'Probe')
    .map(
      (h) => h.states?.find((s) => s.path[1] === 'c1TeamStacks')?.value ?? ''
    )

describe('Linnea (frames and constellations)', () => {
  it('releases the aimed shot at the normal attack’s release and dashes in 20 frames', () => {
    const sim = run('Linnea N1 C D W1', 0)
    expect(sim.actions.map((a) => a.start)).toEqual([0, 17, 103])
  })

  it('C1: a Skill gives 6 Field Catalog stacks, one per Lunar-Crystallize hit (C6: 18, two per hit)', () => {
    expect(catalog(run('Linnea E -> Zibai E W6', 1))).toEqual([
      ...Array(6).fill('on'),
      ...Array(4).fill(''),
    ])
    expect(catalog(run('Linnea E -> Zibai E W6', 6))).toEqual(
      Array(9).fill('on').concat([''])
    )
  })
})
