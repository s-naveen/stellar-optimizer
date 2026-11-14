import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Chasca', 'Bennett', 'Furina', 'Ororon']
const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: {
      Chasca: 'anemo',
      Bennett: 'pyro',
      Furina: 'hydro',
      Ororon: 'electro',
    },
    constellations: { Chasca: cons },
    repeats: 1,
    keep: 'all',
  })

describe('Chasca', () => {
  it('counts her shells as Charged Attack DMG with their own ICD groups', () => {
    const sim = run('Chasca E CA Q W2', 4)
    const shells = sim.hits.filter(
      (h) => h.characterKey === 'Chasca' && h.label.includes('Shadowhunt Shell')
    )
    expect(shells.length).toBeGreaterThan(0)
    expect(shells.every((h) => h.tag === 'charged')).toBe(true)
    expect(
      shells
        .filter((h) => h.label.startsWith('Shining') && !h.label.includes('(C'))
        .every((h) => h.icdGroup === 'ChascaShining')
    ).toBe(true)
    expect(
      sim.hits
        .filter((h) => h.label.includes('Soulseeker Shell ('))
        .every((h) => h.icdGroup === 'ChascaBurst')
    ).toBe(true)
    const c4 = sim.hits.find(
      (h) => h.label === 'Radiant Shadowhunt Shell (C4)'
    )!
    expect(c4.tag).toBe('charged')
  })

  it('gives C6 Fatal Rounds’ CRIT DMG to the next Multitarget Fire’s shells only', () => {
    const sim = run('Chasca E CA CA W2', 6)
    const fatal = (label: string) =>
      sim.hits
        .filter((h) => h.label.includes(label) && !h.label.includes('(C'))
        .map(
          (h) =>
            h.states?.find((s) => s.path.join('.') === 'Chasca.c6FatalRounds')
              ?.value
        )
    // three PHEC elements: the conversion always happens, so the second shot is Fatal Rounds
    const shells = fatal('Shadowhunt Shell')
    expect(shells.slice(0, 6).every((v) => v === '')).toBe(true)
    expect(shells.slice(6, 12).every((v) => v === 'on')).toBe(true)
  })
})
