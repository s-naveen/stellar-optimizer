import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

describe('Freeze application and Kazuha burst timing', () => {
  it('defers an ordinary same-frame aura refill until another queued hit has reacted', () => {
    const after: { label: string; cryo: number }[] = []
    const kit: KitModel = {
      characterKey: 'KaedeharaKazuha',
      element: 'anemo',
      source: 'test',
      act(c) {
        for (const [t, element, label] of [
          [0, 'cryo', 'Initial Cryo'],
          [100, 'cryo', 'Cryo refill'],
          [100, 'anemo', 'Anemo tick'],
        ] as const)
          c.hit(t, {
            path: ['skill', label],
            tag: 'skill',
            element,
            applies: true,
            label,
          })
        return { frames: 120 }
      },
    }
    simulateRotation({
      rotation: parseRotation('Kazuha E', [
        { characterKey: 'KaedeharaKazuha', name: 'Kazuha' },
      ]),
      members: ['KaedeharaKazuha'],
      elements: { KaedeharaKazuha: 'anemo' },
      constellations: {},
      kits: { KaedeharaKazuha: kit },
      repeats: 1,
      keep: 'all',
      auraTrace: (a) => after.push({ label: a.label, cryo: a.after.cryo ?? 0 }),
    })
    expect(after.map((a) => a.label)).toEqual([
      'Initial Cryo',
      'Anemo tick',
      'Cryo refill',
    ])
    expect(after[1].cryo).toBeLessThan(7.5)
    expect(after[2].cryo).toBe(20)
  })

  it('does not grant a first Cryo hit its own new aura CRIT bonuses retroactively', () => {
    const kit: KitModel = {
      characterKey: 'KamisatoAyaka',
      element: 'cryo',
      source: 'test',
      act(c) {
        for (const t of [10, 11])
          c.hit(t, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            label: `Cryo ${t}`,
          })
        return { frames: 30 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Ayaka E', [
        { characterKey: 'KamisatoAyaka', name: 'Ayaka' },
      ]),
      members: ['KamisatoAyaka'],
      elements: { KamisatoAyaka: 'cryo' },
      constellations: {},
      kits: { KamisatoAyaka: kit },
      gear: { KamisatoAyaka: { sets: { BlizzardStrayer: 4 } } },
      repeats: 1,
      keep: 'all',
    })
    const attacks = rotationAttacks(sim, () => 'frozen').KamisatoAyaka!
    const state = (a: (typeof attacks)[number], path: string) =>
      a.states?.find((s) => s.path.join('.') === path)?.value ??
      (a.limits?.some((s) => s.path.join('.') === path && s.hits === 0)
        ? ''
        : undefined)
    expect(attacks.map((a) => state(a, 'BlizzardStrayer.state'))).toEqual([
      '',
      'cryo',
    ])
    expect(attacks.map((a) => state(a, 'resonance.ShatteringIce'))).toEqual([
      '',
      'on',
    ])
  })

  it('starts Kazuha’s world-time burst ticks after slash hitlag', () => {
    const characterKey = 'KaedeharaKazuha' as const
    const sim = simulateRotation({
      rotation: parseRotation('KaedeharaKazuha Q W12', [
        { characterKey, name: characterKey },
      ]),
      members: [characterKey],
      elements: { KaedeharaKazuha: 'anemo' },
      constellations: {},
      repeats: 1,
      keep: 'all',
    })
    // (a wait starts at the burst's earliest cancel, gcsim's CanQueueAfter: swap 90 + 3 hitlag)
    expect(sim.actions[0].frames).toBe(93)
    expect(
      sim.hits.filter((h) => h.label === 'Kazuha Slash (DoT)').map((h) => h.t)
    ).toEqual([143, 260, 377, 494, 611])
  })

  it('applies Cryo from Ayaka’s zero-damage sprint and freezes an existing Hydro aura', () => {
    const members: CharacterKey[] = ['KamisatoAyaka', 'SangonomiyaKokomi']
    const hydro: KitModel = {
      characterKey: 'SangonomiyaKokomi',
      element: 'hydro',
      source: 'test',
      onStart(c) {
        c.hit(0, {
          path: ['_marker', 'application'],
          tag: 'other',
          element: 'hydro',
          applies: true,
          durability: 100,
          label: 'Hydro aura',
        })
      },
      act: () => ({ frames: 1 }),
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'KamisatoAyaka D E Q W10',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { KamisatoAyaka: 'cryo', SangonomiyaKokomi: 'hydro' },
      constellations: {},
      kits: {
        KamisatoAyaka: kitModels.KamisatoAyaka,
        SangonomiyaKokomi: hydro,
      },
      repeats: 1,
      keep: 'all',
    })
    expect(
      sim.hits.find((h) => h.path.join('.') === '_reaction.frozen')?.t
    ).toBe(20)
    expect(
      rotationAttacks(sim).KamisatoAyaka!.every(
        (a) => !a.path.includes('_marker')
      )
    ).toBe(true)
    expect(
      sim.hits.find((h) => h.label === 'Kamisato Art: Hyouka')?.snapshotT
    ).toBe(35)
    const burst = sim.actions.find((a) => a.text === 'Q')!
    expect(
      sim.hits.find((h) => h.label === 'Soumetsu (bloom)')?.snapshotT
    ).toBe(burst.start + 104)
  })
})
