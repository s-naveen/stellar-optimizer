import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import { attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

const state = (hit: SimHit | undefined, name: string) =>
  hit?.states?.find((s) => s.owner === 'Valeriy' && s.path[1] === name)?.value
const run = (
  text: string,
  cons = 6,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Valeriy']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Valeriy: 'electro', Mona: 'hydro' },
    constellations: { Valeriy: cons },
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}
const probe = (tag: SimHit['tag'], count = 20, spacing = 1): KitModel => ({
  characterKey: 'Mona',
  element: 'hydro',
  source: 'test',
  act(c) {
    for (let i = 0; i < count; i++)
      c.hit(i * spacing, {
        path: ['normal', '0'],
        tag,
        element: 'electro',
        label: 'Probe',
      })
    return { frames: count * spacing + 1 }
  },
})

it('preserves C4 half-point Momentum and spends it after the mortar hit', () => {
  const sim = run('Valeriy E Q C N1 W1')
  expect(sim.warnings).toEqual([])
  expect(
    state(
      sim.hits.find((h) => h.label === 'Special Charge'),
      'a4Momentum'
    )
  ).toBe('0')
  expect(
    state(
      sim.hits.find((h) => h.label === 'Normal 1'),
      'a4Momentum'
    )
  ).toBe('97.5')
  const c0 = run('Valeriy E C C W1', 0)
  expect(c0.hits.filter((h) => h.label === 'Special Charge')).toHaveLength(1)
  expect(c0.hits.filter((h) => h.label === 'Charge')).toHaveLength(1)
})

it('only boosts fifteen eligible active-character hits and does not spend on physical hits', () => {
  const sim = run('Valeriy E C N1 -> Mona N1 W1', 6, {
    members: ['Valeriy', 'Mona'],
    kits: { Valeriy: kitModels.Valeriy, Mona: probe('normal') },
  })
  expect(
    state(
      sim.hits.find((h) => h.label === 'Normal 1'),
      'offensiveDirective'
    )
  ).toBe('')
  const hits = sim.hits.filter((h) => h.label === 'Probe')
  expect(
    hits.filter((h) => state(h, 'offensiveDirective') === 'on')
  ).toHaveLength(15)
  expect(state(hits[15], 'offensiveDirective')).toBe('')
  expect(hits.every((h) => state(h, 'a4Momentum') === '78')).toBe(true)
})

it('requires direct Stellar Conduct while its radiance is active', () => {
  for (const tag of ['normal', 'directStellarConduct'] as const) {
    const sim = run('Valeriy E C -> Mona N1 W1', 6, {
      members: ['Valeriy', 'Mona'],
      kits: { Valeriy: kitModels.Valeriy, Mona: probe(tag) },
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
    })
    expect(
      sim.hits.filter(
        (h) => h.label === 'Probe' && state(h, 'offensiveDirective') === 'on'
      )
    ).toHaveLength(tag === 'normal' ? 0 : 15)
  }
})

it('leaves off-field Electro damage outside the Directive pool', () => {
  const mona: KitModel = {
    ...probe('skill'),
    act(c) {
      for (let i = 0; i < 5; i++)
        c.hit(120 + i, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'electro',
          label: 'Off-field probe',
        })
      return { frames: 1 }
    },
  }
  const sim = run('Valeriy E C -> Mona E -> Valeriy W4', 6, {
    members: ['Valeriy', 'Mona'],
    kits: { Valeriy: kitModels.Valeriy, Mona: mona },
  })
  expect(
    sim.hits
      .filter((h) => h.label === 'Off-field probe')
      .every((h) => state(h, 'offensiveDirective') === '')
  ).toBe(true)
})

it('does not give the first special hit its own C6 debuff', () => {
  const sim = run('Valeriy E C Q W14')
  const mortar = sim.hits.find((h) => h.label === 'Special Charge')
  expect(state(mortar, 'c6Hit')).toBe('')
  expect(
    state(
      sim.hits.find((h) => h.label === 'Burst'),
      'c6Hit'
    )
  ).toBe('on')
  const ticks = sim.hits.filter((h) => h.label === 'Burst (Tick)')
  expect(ticks.length).toBeGreaterThan(24)
  expect(ticks.every((h) => h.icdGroup === 'ValeriyBurst')).toBe(true)
  expect(ticks.slice(0, 6).map((h) => h.t - ticks[0].t)).toEqual([
    0, 28, 58, 70, 110, 137,
  ])
})

it('expires the Directive on Valeriy’s character clock', () => {
  const sim = run('Valeriy E C W19 -> Mona N1', 6, {
    members: ['Valeriy', 'Mona'],
    kits: { Valeriy: kitModels.Valeriy, Mona: probe('skill', 1) },
  })
  expect(
    state(
      sim.hits.find((h) => h.label === 'Probe'),
      'offensiveDirective'
    )
  ).toBe('')
})

it('restricts C6 Stellar Conduct CRIT DMG to Electro hits in the damage formula', () => {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData = (['Valeriy', 'Sandrone', 'Mitya'] as const).map((key) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: key === 'Valeriy' ? 6 : 0,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    db.weapons.new({
      key:
        key === 'Valeriy'
          ? 'FavoniusSword'
          : key === 'Mitya'
            ? 'FavoniusCodex'
            : 'FavoniusGreatsword',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
    return { teamCharId: db.teamChars.new(key) }
  })
  const teamId = db.teams.new({ loadoutData })
  const damage = (characterKey: 'Sandrone' | 'Mitya', on: boolean) =>
    attackHitData(db, teamId, 'F', {
      characterKey,
      attack: {
        path:
          characterKey === 'Sandrone'
            ? ['skill', 'prismStellarDmg']
            : ['charged', 'gradientStellarDmg'],
        hits: 1,
        hitMode: 'critHit',
        states: [
          {
            owner: 'Sandrone',
            path: ['Sandrone', 'a0StellarRadianceSc'],
            value: 'on',
          },
          {
            owner: 'Valeriy',
            path: ['Valeriy', 'c6Hit'],
            value: on ? 'on' : '',
          },
        ],
      } as TeamOptAttack,
    })!.hit!.value
  expect(damage('Sandrone', false)).toBeGreaterThan(0)
  expect(damage('Sandrone', true)).toBeCloseTo(damage('Sandrone', false), 6)
  expect(damage('Mitya', true) / damage('Mitya', false)).toBeCloseTo(
    // Mitya has 38.4% ascension CRIT DMG in addition to the base 50%.
    2.284 / 1.884,
    6
  )
})

it('tags Mitya and Danica’s direct Conduct hits for limited-hit support buffs', () => {
  for (const [key, text] of [
    ['Mitya', 'Mitya hE Q C W3'],
    ['Danica', 'Danica Q W4'],
  ] as const) {
    const sim = run(text, 6, {
      members: [key],
      elements: { [key]: 'electro' },
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
    })
    const hits = sim.hits.filter((h) => h.label.includes('Stellar-Conduct'))
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.tag === 'directStellarConduct')).toBe(true)
  }
})
