/**
 * KQM's search judges every set and weapon with the effects the rotation plays for it, not only
 * the ones already worn: the replay plays the members' candidates' buff windows
 * (`SimGear.candidates`), each problem keeps only the ones a build in it can have, and a one-copy
 * weapon goes to one member at most.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../'
import {
  KQM_ONE_COPY,
  kqmProblemAttacks,
  kqmSets,
  kqmTopTeams,
  optimizeTeamKqm,
} from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

const statePaths = (attacks: TeamOpt['attacks']) =>
  new Set(
    Object.values(attacks)
      .flat()
      .flatMap((a) => a?.states ?? [])
      .map((s) => `${s.owner}:${s.path.join('.')}`)
  )

describe('candidate set effects in the rotation', () => {
  const members: CharacterKey[] = ['YumemizukiMizuki', 'Odette']
  const play = (gear: Partial<Record<CharacterKey, SimGear>>) =>
    rotationAttacks(
      simulateRotation({
        rotation: parseRotation(
          'Odette E -> YumemizukiMizuki E W5 -> Odette',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: {},
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear,
      })
    )

  it("plays Viridescent Venerer's Cryo shred and Scarlet Proof on Mizuki's Stellar Swirls for a candidate as for a set worn", () => {
    const worn = statePaths(
      play({ YumemizukiMizuki: { sets: { ViridescentVenerer: 4 } } })
    )
    expect(worn).toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const none = statePaths(play({}))
    expect(none).not.toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const candidates = statePaths(
      play({
        YumemizukiMizuki: {
          sets: { BlizzardStrayer: 4 },
          candidates: { sets: ['ViridescentVenerer', 'ScarletProof'] },
        },
      })
    )
    expect(candidates).toContain(
      'YumemizukiMizuki:ViridescentVenerer.swirlcryo'
    )
    expect(candidates).toContain('YumemizukiMizuki:ScarletProof.4Ss')
  })
})

describe("a problem's attacks", () => {
  const build = (sets: KqmBuild['sets'], weapon: string): KqmBuild => ({
    weapon: { key: weapon as never, refinement: 1 },
    sets,
    mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
    rolls: {},
  })
  it('drops the states of sets and weapons no build in it can have, and merges what they split', () => {
    const attack = (
      states: { owner: string; path: string[]; value: string }[]
    ) => ({
      path: ['skill', 'dmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
      states: states as never,
    })
    const attacks: TeamOpt['attacks'] = {
      Odette: [
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: 'cryo',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: 'on',
          },
        ]),
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: '',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: '',
          },
        ]),
      ],
    }
    const state = {
      YumemizukiMizuki: build({ BlizzardStrayer: 4 }, 'BlackmarrowLantern'),
      Odette: build({ GladiatorsFinale: 4 }, 'SacrificialSword'),
    }
    // Odette's artifacts vary: her Noblesse is kept, Mizuki's VV (not on her) and Odette's
    // Thrilling Tales (not her weapon) are dropped, and the two attacks become one of 2 hits
    const pruned = kqmProblemAttacks(attacks, 'Odette', state).Odette!
    expect(pruned).toHaveLength(1)
    expect(pruned[0].hits).toBe(2)
    expect(pruned[0].states?.map((s) => s.path[0])).toEqual(['NoblesseOblige'])
    // Mizuki wearing VV: her shred is kept, and the attacks stay apart
    const withVV = kqmProblemAttacks(attacks, 'Odette', {
      ...state,
      YumemizukiMizuki: build({ ViridescentVenerer: 4 }, 'BlackmarrowLantern'),
    }).Odette!
    expect(withVV).toHaveLength(2)
    // Mizuki's own sets vary in her problem: her VV states are kept
    expect(
      kqmProblemAttacks(attacks, 'YumemizukiMizuki', state).Odette
    ).toHaveLength(2)
  })
})

describe('one-copy weapons', () => {
  it('gives a quest weapon like Exaiphanes’ Blade to one member at most', async () => {
    expect(KQM_ONE_COPY).toContain('ExaiphanesBlade')
    expect(KQM_ONE_COPY).not.toContain('MoonweaversDawn')
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const members = ['KamisatoAyaka', 'Keqing'] as const
    for (const key of members)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const ids = members.map((k) => database.teamChars.new(k))
    const teamId = database.teams.new({
      loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    })
    for (const id of ids)
      database.optConfigs.set(database.teamChars.get(id)!.optConfigId, {
        mainStatKeys: {
          sands: ['atk_'],
          goblet: ['atk_'],
          circlet: ['critDMG_'],
        },
        artSetExclusion: Object.fromEntries(
          kqmSets().map((key) => [
            key,
            key === 'GladiatorsFinale' ? [2] : [2, 4],
          ])
        ),
      })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 1,
      refinement5: 1,
      energyRecharge: { KamisatoAyaka: 100, Keqing: 100 },
      excludedWeapons: allWeaponKeys.filter(
        (k) => !['ExaiphanesBlade', 'FavoniusSword'].includes(k)
      ),
      weaponList: 2,
    }
    teamOpt.attacks = {
      KamisatoAyaka: [{ path: ['skill', 'press'], hits: 4, hitMode: 'avgHit' }],
      Keqing: [{ path: ['skill', 'stiletto'], hits: 4, hitMode: 'avgHit' }],
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const holders = members.filter(
      (k) => result.builds[k]?.weapon.key === 'ExaiphanesBlade'
    )
    expect(holders.length).toBeLessThanOrEqual(1)
    // (and each one's weapon ranking leaves it out while the other has it)
    for (const k of members) {
      const other = members.find((m) => m !== k)!
      if (result.builds[other]?.weapon.key === 'ExaiphanesBlade')
        expect(
          result.rankings[k]?.weapons.map((o) => o.weapon.key)
        ).not.toContain('ExaiphanesBlade')
    }
  }, 300_000)
})

describe('top teams', () => {
  it('lists the run’s team, then the best one-member changes by team damage, each a whole team’s score', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const members = ['KamisatoAyaka', 'Shenhe'] as const
    for (const key of members)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const ids = members.map((k) => database.teamChars.new(k))
    const teamId = database.teams.new({
      loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    })
    for (const id of ids)
      database.optConfigs.set(database.teamChars.get(id)!.optConfigId, {
        mainStatKeys: {
          sands: ['atk_'],
          goblet: ['cryo_dmg_', 'atk_'],
          circlet: ['critDMG_'],
        },
        artSetExclusion: Object.fromEntries(
          kqmSets().map((key) => [
            key,
            ['BlizzardStrayer', 'NoblesseOblige', 'GladiatorsFinale'].includes(
              key
            )
              ? [2]
              : [2, 4],
          ])
        ),
      })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 5,
      refinement5: 1,
      energyRecharge: { KamisatoAyaka: 100, Shenhe: 100 },
      excludedWeapons: allWeaponKeys.filter(
        (k) =>
          ![
            'AmenomaKageuchi',
            'TheBlackSword',
            'FavoniusLance',
            'CalamityQueller',
          ].includes(k)
      ),
      weaponList: 2,
    }
    teamOpt.attacks = {
      KamisatoAyaka: [
        { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
      ],
      Shenhe: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const top = kqmTopTeams(result, 10)
    const id = (b: Pick<KqmBuild, 'weapon' | 'sets'>) =>
      `${b.weapon.key}|${Object.entries(b.sets).sort().join()}`
    // first: the run's own team, its total
    expect(top[0].changed).toBeUndefined()
    expect(top[0].total).toBe(result.after.total)
    for (const k of members)
      expect(id(top[0].builds[k]!)).toBe(id(result.builds[k]!))
    // then by team damage, each one member changed from the run's team
    expect(top.length).toBeGreaterThan(2)
    expect(top.length).toBeLessThanOrEqual(10)
    for (let i = 2; i < top.length; i++)
      expect(top[i].total).toBeLessThanOrEqual(top[i - 1].total)
    for (const option of top.slice(1)) {
      const changed = members.filter(
        (k) => id(option.builds[k]!) !== id(result.builds[k]!)
      )
      expect(changed).toEqual([option.changed])
    }
    // (a ranking's totals are the team's damage, as the run's: its own build's is the run's)
    for (const k of members) {
      const same = [
        ...result.rankings[k]!.sets,
        ...result.rankings[k]!.weapons,
      ].find((o) => id(o) === id(result.builds[k]!))
      if (same)
        expect(Math.abs(same.total / result.after.total - 1)).toBeLessThan(1e-6)
    }
    expect(kqmTopTeams(result, 3)).toHaveLength(3)
  }, 300_000)
})
