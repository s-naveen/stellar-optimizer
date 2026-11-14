import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import { allStats } from '@genshin-optimizer/gi/stats'
import { attackDamageOutcomes, attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

function run(
  members: CharacterKey[],
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>> = kitModels,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((m) => [m, kits[m]?.element])),
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits,
    ...extra,
  })
}
const a4 = (hit: SimHit) =>
  hit.states?.find((s) => s.path.join('.') === 'Vodyanitsa.a4Hit')?.value

it('uses the native zero-delay cast, five Horn attacks and ten healing ticks within Song', () => {
  const sim = run(['Vodyanitsa'], 'Vodyanitsa E W18')
  expect(sim.warnings).toEqual([])
  expect(sim.hits.find((h) => h.path.join('.') === 'skill.skillDmg')?.t).toBe(0)
  expect(
    sim.hits.filter((h) => h.path.join('.') === 'skill.hornDmg').map((h) => h.t)
  ).toEqual([226, 406, 586, 766, 946])
  expect(
    sim.hits
      .filter((h) => h.path.join('.') === '_heal.skill.songHeal')
      .map((h) => h.t)
  ).toEqual(Array.from({ length: 10 }, (_, i) => 136 + 90 * i))
  const first = sim.hits.find((h) => h.path.join('.') === 'skill.skillDmg')!
  expect(a4(first)).toBeUndefined()
  expect(first.states?.find((s) => s.path[1] === 'skillHit')?.value).toBe('')
  expect(
    sim.buffWindows.find((b) => b.path[1] === 'skillSong' && b.value === 'on')
      ?.end
  ).toBe(960)
})

it('shares 25 active and 10 off-field uses across characters, with no bonus after exhaustion', () => {
  const probe: KitModel = {
    characterKey: 'Skirk',
    element: 'cryo',
    source: 'test',
    act(c) {
      for (let i = 0; i < 26; i++)
        c.hit(i, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'cryo',
          label: 'Active probe',
        })
      for (let i = 0; i < 12; i++)
        c.hit(i, {
          characterKey: 'Escoffier',
          path: ['skill', '0'],
          tag: 'skill',
          element: 'cryo',
          label: 'Off-field probe',
        })
      return { frames: 1 }
    },
  }
  const sim = run(
    ['Vodyanitsa', 'Skirk', 'Escoffier'],
    'Vodyanitsa E -> Skirk E W2',
    {
      Vodyanitsa: kitModels.Vodyanitsa,
      Skirk: probe,
      Escoffier: { ...probe, characterKey: 'Escoffier' },
    },
    { reactions: { onHit() {} } }
  )
  expect(
    sim.hits.filter((h) => h.label === 'Active probe' && a4(h) === 'elemental')
  ).toHaveLength(25)
  expect(
    sim.hits.filter(
      (h) => h.label === 'Off-field probe' && a4(h) === 'elemental'
    )
  ).toHaveLength(10)
  expect(
    sim.hits.filter((h) => h.label === 'Active probe').at(-1)?.states
  ).toBeUndefined()
})

it('uses the reaction owner’s pool once per shared hit and gives every contributor the same eligibility', () => {
  const probe: KitModel = {
    characterKey: 'Venti',
    element: 'anemo',
    source: 'test',
    act(c) {
      for (const [actor, n] of [
        ['Venti', 26],
        ['Escoffier', 11],
      ] as const)
        for (let i = 0; i < n; i++)
          c.at(i * 4, (at) =>
            at.hit(3, {
              characterKey: actor,
              path: ['reaction', 'stellarswirl'],
              tag: 'other',
              element: 'anemo',
              label: `${actor} reaction`,
              contributors: ['Venti', 'Escoffier'],
            })
          )
      return { frames: 1 }
    },
  }
  const sim = run(
    ['Vodyanitsa', 'Venti', 'Escoffier'],
    'Vodyanitsa E -> Venti E W3',
    {
      Vodyanitsa: kitModels.Vodyanitsa,
      Venti: probe,
      Escoffier: { ...probe, characterKey: 'Escoffier' },
    },
    { reactions: { onHit() {} } }
  )
  expect(
    sim.hits.filter((h) => h.label === 'Venti reaction' && a4(h) === 'stellar')
  ).toHaveLength(25)
  expect(
    sim.hits.filter(
      (h) => h.label === 'Escoffier reaction' && a4(h) === 'stellar'
    )
  ).toHaveLength(10)
  for (const attacks of Object.values(rotationAttacks(sim)))
    for (const attack of attacks ?? []) {
      if (!attack.reactionContributors) continue
      const values = attack.reactionContributors.map(
        (m) =>
          attack.reactionContributorStates?.[m]?.find(
            (s) => s.path[1] === 'a4Hit'
          )?.value
      )
      expect(values[0]).toBe(values[1])
    }
})

it('snapshots shared eligibility before impact, without spending the pool until impact', () => {
  const probe: KitModel = {
    characterKey: 'Venti',
    element: 'anemo',
    source: 'test',
    act(c) {
      for (let i = 0; i < 26; i++)
        c.hit(3, {
          path: ['reaction', 'stellarswirl'],
          tag: 'other',
          element: 'anemo',
          label: 'Concurrent reaction',
          contributors: ['Venti', 'Odette'],
        })
      c.at(4, (at) =>
        at.hit(3, {
          path: ['reaction', 'stellarswirl'],
          tag: 'other',
          element: 'anemo',
          label: 'After impacts',
          contributors: ['Venti', 'Odette'],
        })
      )
      return { frames: 1 }
    },
  }
  const sim = run(
    ['Vodyanitsa', 'Venti', 'Odette'],
    'Vodyanitsa E -> Venti E W1',
    {
      Vodyanitsa: kitModels.Vodyanitsa,
      Venti: probe,
      Odette: { ...probe, characterKey: 'Odette', element: 'cryo' },
    },
    { reactions: { onHit() {} } }
  )
  expect(
    sim.hits.filter(
      (h) => h.label === 'Concurrent reaction' && a4(h) === 'stellar'
    )
  ).toHaveLength(26)
  expect(a4(sim.hits.find((h) => h.label === 'After impacts')!)).toBe('')
})

it('suppresses elemental bonuses near Stellar Swirl while retaining direct Stellar bonuses', () => {
  const probe: KitModel = {
    characterKey: 'Venti',
    element: 'anemo',
    source: 'test',
    act(c) {
      c.hit(3, {
        path: ['reaction', 'stellarswirl'],
        tag: 'other',
        element: 'anemo',
        label: 'Reaction',
        contributors: ['Venti', 'Odette'],
      })
      c.hit(4, {
        characterKey: 'Odette',
        path: ['skill', '0'],
        tag: 'skill',
        element: 'cryo',
        label: 'Suppressed',
      })
      c.hit(5, {
        characterKey: 'Odette',
        path: ['skill', '1'],
        tag: 'directStellarSwirl',
        element: 'cryo',
        label: 'Direct Stellar',
      })
      c.hit(300, {
        characterKey: 'Odette',
        path: ['skill', '0'],
        tag: 'skill',
        element: 'cryo',
        label: 'After cooldown',
      })
      return { frames: 1 }
    },
  }
  const sim = run(
    ['Vodyanitsa', 'Venti', 'Odette'],
    'Vodyanitsa E -> Venti E W6',
    {
      Vodyanitsa: kitModels.Vodyanitsa,
      Venti: probe,
      Odette: { ...probe, characterKey: 'Odette', element: 'cryo' },
    },
    { reactions: { onHit() {} } }
  )
  expect(a4(sim.hits.find((h) => h.label === 'Suppressed')!)).toBeUndefined()
  expect(a4(sim.hits.find((h) => h.label === 'Direct Stellar')!)).toBe(
    'stellar'
  )
  expect(a4(sim.hits.find((h) => h.label === 'After cooldown')!)).toBe(
    'elemental'
  )
})

it('extends Stellar Swirl radiance by four seconds without enabling the reaction by itself', () => {
  for (const support of ['Vodyanitsa', 'Mona'] as const) {
    const seen: (string | undefined)[] = []
    const cryo: KitModel = {
      characterKey: 'Odette',
      element: 'cryo',
      source: 'test',
      act(c) {
        c.hit(0, {
          path: ['skill', '0'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          label: 'Cryo',
        })
        return { frames: 1 }
      },
    }
    const anemo: KitModel = {
      ...cryo,
      characterKey: 'Venti',
      element: 'anemo',
      act(c) {
        c.hit(0, {
          path: ['skill', '0'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          label: 'Anemo',
        })
        for (const t of [479, 480, 719, 720])
          c.at(t, (at) => seen.push(at.radiance))
        return { frames: 1 }
      },
    }
    const sim = run(['Odette', 'Venti', support], 'Odette E -> Venti E W14', {
      Odette: cryo,
      Venti: anemo,
      [support]: kitModels[support],
    })
    expect(
      sim.hits.some((h) => h.path.join('.') === 'reaction.stellarswirl')
    ).toBe(true)
    expect(seen).toEqual(
      support === 'Vodyanitsa'
        ? ['swirl', 'swirl', 'swirl', undefined]
        : ['swirl', undefined, undefined, undefined]
    )
    const withoutEnabler = run(
      ['Mitya', 'Venti', support],
      'Mitya E -> Venti E W1',
      {
        Mitya: { ...cryo, characterKey: 'Mitya' },
        Venti: anemo,
        [support]: kitModels[support],
      }
    )
    expect(
      withoutEnabler.hits.some(
        (h) => h.path.join('.') === 'reaction.stellarswirl'
      )
    ).toBe(false)
    expect(
      withoutEnabler.hits.some((h) => h.path.join('.') === 'reaction.cryoSwirl')
    ).toBe(true)
  }
})

it('keeps the burst Song coefficient chosen at cast even if Song expires before its hit', () => {
  const sim = run(['Vodyanitsa'], 'Vodyanitsa E W15 Q W2')
  const burst = sim.hits.find((h) => h.tag === 'burst')!
  expect(burst.t).toBeGreaterThan(960)
  expect(burst.states?.find((s) => s.path[1] === 'skillSong')?.value).toBe('on')
})

it('collects Cryo and Frozen contributors while excluding a Hydro-triggered Freeze owner', () => {
  const probe = (
    characterKey: CharacterKey,
    element: 'hydro' | 'cryo' | 'anemo'
  ): KitModel => ({
    characterKey,
    element,
    source: 'test',
    act(c) {
      c.hit(0, {
        path: ['skill', '0'],
        tag: 'skill',
        element,
        applies: true,
        label: 'Element probe',
      })
      return { frames: 1 }
    },
  })
  const members: CharacterKey[] = ['Vodyanitsa', 'Odette', 'Anastasya', 'Venti']
  const kits = {
    Vodyanitsa: probe('Vodyanitsa', 'hydro'),
    Odette: probe('Odette', 'cryo'),
    Anastasya: probe('Anastasya', 'cryo'),
    Venti: probe('Venti', 'anemo'),
  }
  const hydroFreeze = run(
    members,
    'Odette E -> Vodyanitsa E -> Venti E W1',
    kits
  )
  expect(
    hydroFreeze.hits.find((h) => h.path.join('.') === 'reaction.stellarswirl')
      ?.contributors
  ).toEqual(['Venti'])
  const cryoFreeze = run(
    members,
    'Vodyanitsa E -> Odette E -> Anastasya E -> Venti E W1',
    kits
  )
  expect(
    new Set(
      cryoFreeze.hits.find((h) => h.path.join('.') === 'reaction.stellarswirl')
        ?.contributors
    )
  ).toEqual(new Set(['Venti', 'Odette', 'Anastasya']))
})

it('adds Song to the burst HP coefficient and caps managed elemental/Stellar flat damage', () => {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const [key, weapon] of [
    ['Vodyanitsa', 'PrototypeAmber'],
    ['Escoffier', 'FavoniusLance'],
    ['Venti', 'FavoniusWarbow'],
  ] as const) {
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
      constellation: 0,
    })
    database.weapons.new({
      key: weapon,
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
  }
  const teamId = database.teams.new({
    loadoutData: (['Vodyanitsa', 'Escoffier', 'Venti'] as const).map((m) => ({
      teamCharId: database.teamChars.new(m),
    })),
  })
  const burst = (song: string) =>
    attackHitData(database, teamId, 'F', {
      characterKey: 'Vodyanitsa',
      attack: {
        path: ['burst', 'skillDmg'],
        hits: 1,
        hitMode: 'hit',
        states: [
          {
            owner: 'Vodyanitsa',
            path: ['Vodyanitsa', 'skillSong'],
            value: song,
          },
        ],
      },
    })!.hit!.value
  const params = allStats.char.skillParam.Vodyanitsa.burst
  expect(burst('on') / burst('')).toBeCloseTo(
    (params[0][9] + params[1][9]) / params[0][9],
    8
  )
  const attack: TeamOptAttack = {
    path: ['reaction', 'stellarswirl'],
    hits: 1,
    hitMode: 'avgHit',
    onField: 'Venti',
    reactionContributors: ['Venti', 'Escoffier'],
    states: [
      { owner: 'Vodyanitsa', path: ['Vodyanitsa', 'a4Hit'], value: 'stellar' },
    ],
  }
  const result = attackHitData(database, teamId, 'F', {
    characterKey: 'Venti',
    attack,
    bonusStats: { Vodyanitsa: { hp: 100000 } },
  })!
  const flat = result.target.get({
    operation: 'read',
    path: ['total', 'stellarswirl_dmgInc'],
  } as never)?.value
  expect(flat).toBe(6500)
  for (const [node, multiplier] of [
    ['stellarswirl', 0.75],
    ['stellarswirl_vortex1', 2],
    ['stellarswirl_vortex2', 3],
  ] as const) {
    const damage = (on: boolean) =>
      attackHitData(database, teamId, 'F', {
        characterKey: 'Venti',
        bonusStats: { Vodyanitsa: { hp: 100000 } },
        attack: {
          path: ['reaction', node],
          hits: 1,
          hitMode: 'hit',
          states: [
            {
              owner: 'Vodyanitsa',
              path: ['Vodyanitsa', 'a4Hit'],
              value: on ? 'stellar' : '',
            },
          ],
        },
      })!.hit!.value
    const element = node === 'stellarswirl' ? 'anemo' : 'cryo'
    const resistance = result.target.get({
      operation: 'read',
      path: ['enemy', `${element}_resMulti_`],
    } as never)!.value
    const defense = result.target.get({
      operation: 'read',
      path: ['enemy', 'transDef'],
    } as never)!.value
    expect(damage(true) - damage(false)).toBeCloseTo(
      6500 * multiplier * resistance * defense,
      6
    )
  }
  const elemental = attackHitData(database, teamId, 'F', {
    characterKey: 'Venti',
    bonusStats: { Vodyanitsa: { hp: 100000 } },
    attack: {
      ...attack,
      states: [
        {
          owner: 'Vodyanitsa',
          path: ['Vodyanitsa', 'a4Hit'],
          value: 'elemental',
        },
      ],
    },
  })!
  expect(
    elemental.target.get({
      operation: 'read',
      path: ['total', 'hydro_dmgInc'],
    } as never)?.value
  ).toBe(3500)
  const rolls = attackDamageOutcomes(database, teamId, 'F', 'Venti', attack, {
    bonusStats: { Vodyanitsa: { hp: 100000 } },
  })!
  expect(
    rolls.reduce((sum, r) => sum + r.damage * r.probability, 0)
  ).toBeCloseTo(result.hit!.value, 6)
})
