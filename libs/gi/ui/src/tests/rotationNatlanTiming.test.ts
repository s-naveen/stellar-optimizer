import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

describe('Natlan team queue and snapshot boundaries', () => {
  it('lets a wait start at Mualani’s burst cancel while the projectile travels', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Mualani Q W1 E W1', [
        { characterKey: 'Mualani', name: 'Mualani' },
      ]),
      members: ['Mualani'],
      elements: { Mualani: 'hydro' },
      constellations: {},
      repeats: 1,
      keep: 'all',
    })
    expect(sim.actions[0].frames).toBe(108)
    expect(sim.actions[1].start).toBe(168)
    const burst = sim.hits.find((h) => h.label === 'Boomsharka-laka')!
    expect(burst.snapshotT).toBe(108)
    expect(burst.t).toBe(178)
  })

  it('lets Mualani surf and bite in every rotation: the blessing’s moves set her Skill cooldown, they do not queue more', () => {
    const members: CharacterKey[] = [
      'Mualani',
      'Furina',
      'Xilonen',
      'Xiangling',
    ]
    const sim = simulateRotation({
      rotation: parseRotation(
        'Furina E Q -> Xilonen E N2 -> Xiangling E Q -> Mualani Q E J J N1 J J N1 J J N1 -> Furina',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: {
        Mualani: 'hydro',
        Furina: 'hydro',
        Xilonen: 'geo',
        Xiangling: 'pyro',
      },
      constellations: {},
    })
    expect(sim.warnings.join(' ')).not.toMatch(/could not become ready/)
    // the counted rotation: three Surging Bites (two jumps, 3 Wave Momentum, before each)
    expect(
      sim.hits.filter((h) => h.label === "Sharky's Surging Bite")
    ).toHaveLength(3)
    expect(sim.frames / 60).toBeLessThan(25)
  })

  it('lets Mualani walk on Sharky in her blessing for a wait (gcsim’s walk): 90 frames make a Surging Bite', () => {
    const play = (text: string) =>
      simulateRotation({
        rotation: parseRotation(text, [
          { characterKey: 'Mualani', name: 'Mualani' },
        ]),
        members: ['Mualani'],
        elements: { Mualani: 'hydro' },
        constellations: {},
        repeats: 1,
        keep: 'all',
      }).hits.filter((h) => h.label?.startsWith("Sharky's"))
    expect(play('Mualani E W90f N1').map((h) => h.label)).toEqual([
      "Sharky's Surging Bite",
    ])
    expect(play('Mualani E W1.5 N1').map((h) => h.label)).toEqual([
      "Sharky's Surging Bite",
    ])
    // (0.7 s between stacks: half a second of walking makes 1)
    expect(play('Mualani E W0.5 N1').map((h) => h.label)).toEqual([
      "Sharky's Bite (1 momentum)",
    ])
    // (W90f is 90 frames)
    expect(
      parseRotation('Mualani W90f', [
        { characterKey: 'Mualani', name: 'Mualani' },
      ]).steps[0].actions[0].count
    ).toBe(1.5)
  })

  it('keeps Xilonen’s first crystallizing hit from gaining its own Scroll buff', () => {
    const members: CharacterKey[] = ['Xilonen', 'SangonomiyaKokomi']
    const hydro: KitModel = {
      characterKey: 'SangonomiyaKokomi',
      element: 'hydro',
      source: 'test',
      act: () => ({ frames: 1 }),
      onStart(c) {
        c.hit(0, {
          path: ['_marker', 'application'],
          tag: 'other',
          element: 'hydro',
          applies: true,
          label: 'Hydro aura',
        })
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Xilonen E N1',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Xilonen: 'geo', SangonomiyaKokomi: 'hydro' },
      constellations: {},
      kits: { Xilonen: kitModels.Xilonen, SangonomiyaKokomi: hydro },
      gear: { Xilonen: { sets: { ScrollOfTheHeroOfCinderCity: 4 } } },
      repeats: 1,
      keep: 'all',
    })
    const attack = rotationAttacks(sim).Xilonen!.find(
      (a) => a.path.join('.') === 'skill.rushDmg'
    )!
    const captured = attack.statSnapshots!.find((s) => s.stat === 'geo_dmg_')!
    expect(
      captured.states.some(
        (s) => s.path[0] === 'ScrollOfTheHeroOfCinderCity' && s.value
      )
    ).toBe(false)
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'ScrollOfTheHeroOfCinderCity.react_geo'
      )
    ).toBe(true)
  })

  it('pauses Xiangling’s opening swings, then keeps Pyronado’s pre-C6 snapshot', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Xiangling Q -> Bennett E W4', [
        { characterKey: 'Xiangling', name: 'Xiangling' },
        { characterKey: 'Bennett', name: 'Bennett' },
      ]),
      members: ['Xiangling', 'Bennett'],
      elements: { Xiangling: 'pyro', Bennett: 'pyro' },
      constellations: { Xiangling: 6 },
      repeats: 1,
      keep: 'all',
    })
    expect(sim.actions[0].frames).toBe(97)
    expect(
      sim.hits
        .filter((h) => h.label.startsWith('Pyronado Swing'))
        .map((h) => h.t)
    ).toEqual([18, 39, 69])
    expect(sim.hits.filter((h) => h.label === 'Pyronado')[0].t).toBe(68)
    for (const a of rotationAttacks(sim).Xiangling!.filter(
      (a) => a.path.join('.') === 'burst.dmgNado'
    )) {
      const captured = a.statSnapshots!.find((s) => s.stat === 'pyro_dmg_')!
      expect(
        captured.states.some(
          (s) => s.path.join('.') === 'Xiangling.afterPyronado' && s.value
        )
      ).toBe(false)
    }
  })

  it('keeps Furina’s damage-time Fanfare live while Pyronado retains other captured buffs', () => {
    const members: CharacterKey[] = ['Xiangling', 'Furina']
    const furina: KitModel = {
      characterKey: 'Furina',
      element: 'hydro',
      source: 'test',
      onStart(c) {
        c.buff('Furina', ['Furina', 'burstFanfare'], '80', 100, 100)
      },
      act: () => ({ frames: 1 }),
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Xiangling Q W5',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Xiangling: 'pyro', Furina: 'hydro' },
      constellations: { Xiangling: 6 },
      kits: { Xiangling: kitModels.Xiangling, Furina: furina },
      repeats: 1,
      keep: 'all',
    })
    const attacks = rotationAttacks(sim).Xiangling!.filter(
      (a) => a.path.join('.') === 'burst.dmgNado'
    )
    const fanfare = attacks.map(
      (a) =>
        a
          .statSnapshots!.find((s) => s.stat === 'all_dmg_')!
          .states.find((s) => s.path.join('.') === 'Furina.burstFanfare')!.value
    )
    expect(fanfare).toContain('80')
    expect(fanfare).toContain('')
    expect(
      attacks.every((a) =>
        a
          .statSnapshots!.find((s) => s.stat === 'pyro_dmg_')!
          .states.every(
            (s) => s.path.join('.') !== 'Xiangling.afterPyronado' || !s.value
          )
      )
    ).toBe(true)
  })
})
