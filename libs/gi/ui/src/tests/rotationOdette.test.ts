import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

describe('Odette character-clock effects', () => {
  const members: CharacterKey[] = ['Odette', 'Mitya']
  const run = (text: string, odette = kitModels.Odette!, mitya?: KitModel) =>
    simulateRotation({
      rotation: parseRotation(
        text,
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Odette: 'cryo', Mitya: 'electro' },
      constellations: {},
      kits: { Odette: odette, Mitya: mitya ?? kitModels.Mitya },
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
      repeats: 1,
      keep: 'all',
    })

  it('includes Coda final hitlag in its recovery without delaying its world-time DoT', () => {
    const sim = run('Odette E E Q')
    expect(sim.actions.map((a) => a.start)).toEqual([0, 41, 120])
    expect(
      sim.hits
        .filter((h) => h.label === "Coda at Dawn's Tolling (DoT)")
        .map((h) => h.t)
    ).toEqual([52, 61, 69])
    expect(
      sim.hits.find((h) => h.label.includes('Tolling (Stellar-Conduct)'))?.t
    ).toBe(103)
  })

  it('pauses pending burst attacks and starts Snow Swan’s Dream after the actual final slash', () => {
    const odette: KitModel = {
      ...kitModels.Odette!,
      onStart(c) {
        c.hit(110, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 7,
          label: 'External pause',
        })
      },
    }
    const sim = run('Odette Q W3', odette)
    expect(
      sim.hits
        .filter((h) => h.label === 'Presto: Bluebird Finale (Slash)')
        .map((h) => h.t)
    ).toEqual([119, 135, 147])
    expect(
      sim.hits.find((h) => h.label === 'Presto: Bluebird Finale (Final)')?.t
    ).toBe(151)
    const buff = sim.buffWindows.find(
      (w) => w.path.join('.') === 'Odette.burst'
    )
    expect(buff).toMatchObject({
      start: 151,
      end: 1351,
      hitlag: 'recipient',
      recipient: 'Odette',
    })
  })

  it('delays the first off-field Splendor transfer by Odette’s own normal hitlag', () => {
    const mitya: KitModel = {
      characterKey: 'Mitya',
      element: 'electro',
      source: 'test',
      act(c) {
        for (const t of [15, 19, 20])
          c.hit(t, {
            path: ['skill', 'probe'],
            tag: 'skill',
            element: 'electro',
            label: `Probe ${t}`,
          })
        return { frames: 100 }
      },
    }
    const sim = run('Odette E N1 -> Mitya E', kitModels.Odette!, mitya)
    expect(sim.actions[2].start).toBe(68)
    expect(
      rotationAttacks(sim).Mitya!.map(
        (a) => a.states?.find((s) => s.path[1] === 'a1TeamSplendor')?.value
      )
    ).toEqual(['0', '0', '1'])
  })
})
