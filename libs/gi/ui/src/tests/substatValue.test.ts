import { SandboxStorage } from '@genshin-optimizer/common/database'
import { objPathValue } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { BuildTc, LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getSubstatValue } from '@genshin-optimizer/gi/util'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import {
  computeMainStatValue,
  computeSubstatValue,
  getBuildTcArtifactData,
  getBuildTcWeaponData,
  getTeamDataCalc,
} from '../'

/** The value the app displays for `target`, computed the regular way for `buildTc`'s stats */
function displayedTarget(
  database: ArtCharDatabase,
  teamId: string,
  teamCharId: string,
  characterKey: CharacterKey,
  buildTc: BuildTc,
  target: string[]
) {
  const teamData = getTeamDataCalc(
    database,
    teamId,
    'F',
    teamCharId,
    0,
    getBuildTcArtifactData(buildTc),
    getBuildTcWeaponData(buildTc)
  )!
  const uiData = teamData[characterKey]!.target
  const node = objPathValue(uiData.data[0].display ?? {}, target) as NumNode
  return uiData.get(node).value
}

describe('substat value', () => {
  it('matches the target recomputed with each substat raised', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const characterKey: CharacterKey = 'HuTao'
    const buildTcId = database.buildTcs.new({
      name: 'test',
      description: 'test',
      characterKey,
      artifact: {
        slots: {
          flower: { level: 20, rarity: 5, statKey: 'hp' },
          plume: { level: 20, rarity: 5, statKey: 'atk' },
          sands: { level: 20, rarity: 5, statKey: 'hp_' },
          goblet: { level: 20, rarity: 5, statKey: 'pyro_dmg_' },
          circlet: { level: 20, rarity: 5, statKey: 'critDMG_' },
        },
        substats: {
          type: 'mid',
          stats: {
            hp: 507.88,
            hp_: 9.91,
            atk: 33.07,
            atk_: 9.91,
            def: 39.35,
            def_: 12.39,
            eleMas: 39.63,
            enerRech_: 49.545,
            critRate_: 6.61,
            critDMG_: 13.21,
          },
          rarity: 5,
        },
        sets: { CrimsonWitchOfFlames: 4 },
      },
      weapon: { key: 'StaffOfHoma', level: 90, ascension: 6, refinement: 1 },
    })
    const buildTc = database.buildTcs.get(buildTcId)!
    database.chars.set(characterKey, {
      key: characterKey,
      level: 89,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
    })
    database.chars.set('Xingqiu', {
      key: 'Xingqiu',
      level: 89,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    const teamCharId = database.teamChars.new(characterKey, {
      conditional: {
        StaffOfHoma: { RecklessCinnabar: 'on' },
        HuTao: { GuideToAfterlifeVoyage: 'on', SanguineRouge: 'on' },
        CrimsonWitchOfFlames: { stack: '1' },
      },
      hitMode: 'avgHit',
      reaction: 'vaporize',
    })
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId, buildType: 'tc', buildTcId },
        {
          teamCharId: database.teamChars.new('Xingqiu', {
            conditional: { Xingqiu: { c2: 'on', skill: 'on' } },
          }),
        },
      ] as LoadoutDatum[],
    })
    const target = ['normal', '0']

    // what the card computes (no overrides: the loadout's TC build)
    const result = computeSubstatValue(
      getTeamDataCalc(database, teamId, 'F', teamCharId)!,
      characterKey,
      target,
      2,
      5,
      'mid'
    )!
    expect(result).toBeTruthy()
    const base = displayedTarget(
      database,
      teamId,
      teamCharId,
      characterKey,
      buildTc,
      target
    )
    expect(result.base).toBeCloseTo(base, 6)
    // HuTao's normal attack scales with HP, ATK, EM (vaporize), crit and Pyro DMG: not DEF/ER
    expect(result.gains.map((g) => g.key)).toEqual(
      expect.arrayContaining([
        'hp',
        'hp_',
        'atk',
        'atk_',
        'eleMas',
        'critRate_',
        'critDMG_',
      ])
    )
    expect(result.unused).toEqual(
      expect.arrayContaining(['def', 'def_', 'enerRech_'])
    )
    // something gains (so equal zeros below cannot pass by accident)
    expect(result.gains[0].gain).toBeGreaterThan(base * 0.005)
    // sorted, most valuable first
    for (let i = 1; i < result.gains.length; i++)
      expect(result.gains[i - 1].gain).toBeGreaterThanOrEqual(
        result.gains[i].gain
      )

    for (const { key, gain } of result.gains) {
      const raised = structuredClone(buildTc)
      // the TC build stores percent stats as percents; the card adds the formula's fractions
      raised.artifact.substats.stats[key] += 2 * getSubstatValue(key, 5, 'mid')
      const value = displayedTarget(
        database,
        teamId,
        teamCharId,
        characterKey,
        raised,
        target
      )
      expect(gain).toBeCloseTo(value - base, 4)
    }

    // rolls picked per substat, and what the next roll adds after them
    const picked = computeSubstatValue(
      getTeamDataCalc(database, teamId, 'F', teamCharId)!,
      characterKey,
      target,
      1,
      5,
      'mid',
      { critDMG_: 4, critRate_: 3 }
    )!
    const at = (key: (typeof picked.gains)[number]['key'], rolls: number) => {
      const raised = structuredClone(buildTc)
      raised.artifact.substats.stats[key] +=
        rolls * getSubstatValue(key, 5, 'mid')
      return displayedTarget(
        database,
        teamId,
        teamCharId,
        characterKey,
        raised,
        target
      )
    }
    for (const { key, rolls, gain, next, one } of picked.gains) {
      expect(rolls).toBe({ critDMG_: 4, critRate_: 3 }[key as string] ?? 1)
      expect(gain).toBeCloseTo(at(key, rolls) - base, 4)
      expect(next).toBeCloseTo(at(key, rolls + 1) - at(key, rolls), 4)
      expect(one).toBeCloseTo(at(key, 1) - base, 4)
    }
    // the order is the value of one roll, whatever the rolls picked
    expect(picked.gains.map((g) => g.key)).toEqual(
      result.gains.map((g) => g.key)
    )

    // main stats: each sands/goblet/circlet option vs the TC build with that main stat
    const main = computeMainStatValue(
      getTeamDataCalc(database, teamId, 'F', teamCharId)!,
      characterKey,
      target,
      buildTc.artifact.slots
    )!
    expect(main).toBeTruthy()
    expect(main.base).toBeCloseTo(base, 6)
    expect(main.slots.map((s) => s.slotKey)).toEqual([
      'sands',
      'goblet',
      'circlet',
    ])
    for (const { slotKey, options } of main.slots) {
      const now = options.find((o) => o.current)!
      expect(now.key).toBe(buildTc.artifact.slots[slotKey].statKey)
      // already 5★ +20: keeping it changes nothing
      expect(now.gain).toBeCloseTo(0, 6)
      for (let i = 1; i < options.length; i++)
        expect(options[i - 1].gain).toBeGreaterThanOrEqual(options[i].gain)
      for (const { key, gain } of options) {
        const swapped = structuredClone(buildTc)
        swapped.artifact.slots[slotKey].statKey = key
        const value = displayedTarget(
          database,
          teamId,
          teamCharId,
          characterKey,
          swapped,
          target
        )
        expect(gain).toBeCloseTo(value - base, 4)
      }
    }
    // HuTao (HP scaling, Pyro, vaporizing): an HP% or EM sands, a Pyro DMG goblet
    expect(['hp_', 'eleMas']).toContain(main.slots[0].options[0].key)
    expect(main.slots[1].options[0].key).toBe('pyro_dmg_')
  })
})
