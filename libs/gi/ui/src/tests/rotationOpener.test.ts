import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Mitya', 'Odette', 'Valeriy', 'Sucrose']
const names = members.map((characterKey) => ({
  characterKey,
  name: characterKey,
}))
const loop =
  'odette EQE -> Val EQC -> sucrose N1E(or Q) -> mitya CA Q CA tE -> sucrose N1/E -> mitya tE CA'
const run = (text: string, opener?: string) => {
  const rotation = parseRotation(text, names)
  if (opener) rotation.opener = parseRotation(opener, names).steps
  return simulateRotation({
    rotation,
    members,
    constellations: { Mitya: 0, Odette: 0, Valeriy: 0, Sucrose: 6 },
    elements: {
      Mitya: 'cryo',
      Odette: 'cryo',
      Valeriy: 'electro',
      Sucrose: 'anemo',
    } as never,
  })
}

describe('a first-rotation-only opener', () => {
  it('is played once and not counted', () => {
    const sim = run(loop, 'mitya hE')
    // (only the loop's own Mitya skills: the mid-loop tap and its recast)
    expect(
      sim.actions
        .filter((a) => a.characterKey === 'Mitya' && /E$/.test(a.text))
        .map((a) => a.text)
    ).toEqual(['tE', 'tE'])
    expect(sim.warnings).toEqual([])
  })
  it('keeps a second fresh skill out of the loop (no cooldown wait)', () => {
    const inLoop = run(`mitya hE -> ${loop}`)
    const withOpener = run(loop, 'mitya hE')
    expect(inLoop.frames / 60).toBeGreaterThan(35)
    expect(withOpener.frames / 60).toBeLessThan(21)
  })
  it('waits out a recast’s 1.5 s cooldown instead of skipping it', () => {
    const sim = run(loop, 'mitya hE')
    const taps = sim.actions.filter(
      (a) => a.characterKey === 'Mitya' && a.text === 'tE'
    )
    expect(taps).toHaveLength(2)
    expect(taps[1].start - taps[0].start).toBeGreaterThanOrEqual(90)
  })
})
