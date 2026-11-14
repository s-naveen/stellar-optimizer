import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Xilonen', 'Fischl', 'Bennett']
const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Xilonen: 'geo', Fischl: 'electro', Bennett: 'pyro' },
    constellations: { Xilonen: cons },
    repeats: 1,
    keep: 'all',
  })

describe('Xilonen', () => {
  it('C2: her Samplers’ 90-point burst cuts an Electro member’s burst cooldown by 6 s', () => {
    const at = (cons: number) => {
      const sim = run('Fischl Q -> Xilonen E N2 -> Fischl Q W1', cons)
      const qs = sim.actions.filter(
        (a) => a.characterKey === 'Fischl' && a.text === 'Q'
      )
      return qs[1].start - qs[0].start
    }
    expect(at(0) - at(2)).toBe(6 * 60)
  })

  it('C6 heals the party every 1.5 s of its window and the window ends with Nightsoul', () => {
    const sim = run('Xilonen E N1 W6', 6)
    const heals = sim.hits.filter(
      (h) => h.label === 'Imperishable Night Carnival (Heal)'
    )
    expect(heals).toHaveLength(3)
    const window = sim.buffWindows.find(
      (w) => w.path.join('.') === 'Xilonen.c6Imperishable' && w.value === 'on'
    )!
    expect(window.end - window.start).toBeLessThanOrEqual(5 * 60)
  })
})
