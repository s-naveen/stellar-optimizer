import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, cons: number, members: CharacterKey[]) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Flins: 'electro', Ineffa: 'electro', Fischl: 'electro' },
    constellations: { Flins: cons },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })

describe('Flins', () => {
  it('C2: the next flame normal hit after Northland Spearstorm adds a Lunar-Charged hit', () => {
    // the string continues at N2 after the spearstorm: any step can trigger it, once
    const sim = run('Flins E N1 E N2 W1', 2, ['Flins'])
    const c2 = sim.hits.filter((h) => h.path.join('.') === 'constellation2.dmg')
    expect(c2).toHaveLength(1)
    const firstAfter = sim.hits.find(
      (h) =>
        h.path[0] === 'skill' &&
        h.path[1].startsWith('na') &&
        h.t > sim.hits.find((x) => x.label === 'Northland Spearstorm')!.t
    )!
    expect(c2[0].t - firstAfter.t).toBe(20)
  })

  it('C2 (Ascendant Gleam): his on-field Electro DMG shreds Electro RES for 7 s', () => {
    const shred = (members: CharacterKey[]) =>
      run('Flins E N2 W1', 2, members).buffWindows.filter(
        (w) => w.path[1] === 'c2AfterElectro'
      )
    expect(shred(['Flins'])).toHaveLength(0)
    const windows = shred(['Flins', 'Ineffa'])
    expect(windows.length).toBeGreaterThan(0)
    expect(windows[0].end - windows[0].start).toBe(420)
  })
})
