import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Nefer', 'Lauma', 'Xingqiu', 'Bennett']
const run = (cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      'Xingqiu E Q -> Lauma E -> Nefer E N1 CA CA CA Q -> Xingqiu',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Nefer: cons, Lauma: 0, Xingqiu: 6, Bennett: 0 },
    elements: {
      Nefer: 'dendro',
      Lauma: 'dendro',
      Xingqiu: 'hydro',
      Bennett: 'pyro',
    } as never,
  })
const veilsAt = (sim: ReturnType<typeof run>, t: number) =>
  sim.buffWindows.find(
    (w) => w.path[1] === 'a1VeilStacks' && w.start <= t && t < w.end
  )?.value ?? ''

describe('Nefer', () => {
  it('performs Phantasm Performance with Verdant Dew, three times per Shadow Dance', () => {
    const sim = run(0)
    const shades = sim.hits.filter((h) =>
      h.label?.startsWith('Phantasm Performance (Shade')
    )
    expect(shades).toHaveLength(9)
    expect(sim.warnings).toEqual([])
  })
  it('turns Lunar-Blooms after her skill into Veils (3; C2: 5) that the burst consumes', () => {
    for (const [cons, max] of [
      [0, '3'],
      [2, '5'],
    ] as const) {
      const sim = run(cons)
      const pp = sim.hits.find(
        (h) => h.label === 'Phantasm Performance (Nefer 1)'
      )!
      expect(veilsAt(sim, pp.t)).toBe(max)
      const burst = sim.hits.find((h) => h.label === 'Sacred Vow (1)')!
      expect(
        burst.states?.find((x) => x.path[1] === 'burstVeilsAbsorbed')?.value
      ).toBe(max)
    }
  })
  it('C6: the second stage and the ending are Lunar-Bloom', () => {
    const sim = run(6)
    expect(
      sim.hits.some(
        (h) => h.label === 'Phantasm Performance (Nefer 2) (Lunar-Bloom)'
      )
    ).toBe(true)
    expect(
      sim.hits.filter((h) =>
        h.label?.startsWith('Phantasm Performance end (C6)')
      )
    ).toHaveLength(3)
  })
})
