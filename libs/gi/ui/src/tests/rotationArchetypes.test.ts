import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  KQM_SUBSTAT_ROLLS,
  kqmConstellation,
  kqmRollCaps,
} from '../util/teamOpt/kqm'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import coverageFixtures from './fixtures/priority-coverage/teams.json'
import cryoTravelerFixtures from './fixtures/priority-cryo-traveler/teams.json'
import freezeFixtures from './fixtures/priority-freeze/teams.json'
import freezeMechanicsFixtures from './fixtures/priority-freeze-mechanics/teams.json'
import priorityFixtures from './fixtures/priority-mechanics/teams.json'
import stellarAdaptedFixtures from './fixtures/priority-stellar-adapted/teams.json'
import varkaFixtures from './fixtures/priority-varka/teams.json'
import fixtures from './fixtures/rotation-archetypes/teams.json'

const previouslyCompared = new Set([
  'Keqing',
  'Fischl',
  'Nahida',
  'Xilonen',
  'Arlecchino',
  'Bennett',
  'Sucrose',
  'Nilou',
  'Mona',
  'Baizhu',
  'Dori',
  'Furina',
  'Yelan',
  'Neuvillette',
  'Columbina',
  'Ineffa',
  'HuTao',
  'Zhongli',
  'Xingqiu',
  'Danica',
  'Anastasya',
  'Mitya',
  'Odette',
])

it('covers seven archetypes with 28 new characters, without reusing earlier comparison members', () => {
  const members = fixtures.teams.flatMap((t) => t.members.map((m) => m.key))
  expect(fixtures.teams).toHaveLength(7)
  expect(new Set(fixtures.teams.map((t) => t.archetype)).size).toBe(7)
  expect(members).toHaveLength(28)
  expect(new Set(members).size).toBe(28)
  expect(members.filter((k) => previouslyCompared.has(k))).toEqual([])
})

describe.each([
  ...fixtures.teams,
  ...priorityFixtures.teams,
  ...coverageFixtures.teams,
  ...freezeFixtures.teams,
  ...varkaFixtures.teams,
  ...cryoTravelerFixtures.teams,
  ...stellarAdaptedFixtures.teams,
  ...freezeMechanicsFixtures.teams,
])('$archetype: $id', (team) => {
  it('uses C6 four-stars / C0 five-stars, 10/10/10 talents, and legal KQM artifact roll budgets', () => {
    for (const b of team.members) {
      expect(b.cons, b.key).toBe(kqmConstellation(b.key as CharacterKey))
      expect(b.talent).toEqual([10, 10, 10])
      const caps = kqmRollCaps(b.mains as never)
      expect(
        Object.values(b.liquidRolls).reduce((s, n) => s + (n ?? 0), 0)
      ).toBe(20)
      for (const [k, n] of Object.entries(b.liquidRolls)) {
        const stat = k as keyof typeof KQM_SUBSTAT_ROLLS
        expect(n, `${b.key} ${k}`).toBeLessThanOrEqual(caps[stat])
        expect(b.subs[stat]).toBeCloseTo(
          (2 + n!) * KQM_SUBSTAT_ROLLS[stat] * (k.endsWith('_') ? 100 : 1),
          4
        )
      }
    }
  })

  it('parses and simulates core attacks and reactions without skipped actions', () => {
    const members = team.members.map((m) => m.key as CharacterKey)
    const rotation = parseRotation(
      team.text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    )
    expect(rotation.warnings).toEqual([])
    const sim = simulateRotation({
      rotation,
      members,
      keep: 'all',
      repeats: 4,
      elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
      constellations: Object.fromEntries(
        team.members.map((m) => [m.key, m.cons])
      ),
      gear: Object.fromEntries(
        team.members.map((m) => [
          m.key,
          {
            sets: m.sets,
            weapon: String(m.weapon[0]),
            refinement: Number(m.weapon[1]),
          },
        ])
      ),
    })
    expect(sim.unsupported).toEqual([])
    expect(sim.warnings).toEqual([])
    expect(Number.isFinite(sim.frames) && sim.frames > 0).toBe(true)
    const attacks = rotationAttacks(sim)
    for (const [key, path] of Object.entries(team.checks.nodes))
      expect(
        attacks[key as CharacterKey]?.some((a) => a.path.join('.') === path),
        `${key} ${path}`
      ).toBe(true)
    if ('reaction' in team.checks && team.checks.reaction) {
      const reaction = team.checks.reaction
      expect(
        sim.hits.some(
          (h) =>
            h.reaction === reaction ||
            h.path.join('.') === `_reaction.${reaction}` ||
            h.path.join('.') === `reaction.${reaction}`
        ),
        reaction
      ).toBe(true)
    }
    console.log(
      `${team.id}: ${(sim.frames / 60).toFixed(2)} s, ${sim.hits.length} events; ${sim.notes.join(' | ')}`
    )
  })
})

it('Beidou C2 does not create extra bounces against the simulator’s single enemy', () => {
  const members: CharacterKey[] = ['Beidou', 'Clorinde']
  const rotation = parseRotation(
    'Beidou Q -> Clorinde N3 D N3 D N3',
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
  const hits = (cons: number) =>
    simulateRotation({
      rotation,
      members,
      constellations: { Beidou: cons },
      elements: { Beidou: 'electro', Clorinde: 'electro' },
      repeats: 1,
    }).hits.filter((h) => h.path.join('.') === 'burst.lightningDmg').length
  expect(hits(0)).toBeGreaterThan(0)
  expect(hits(6)).toBe(hits(0))
})

it('Xianyun consumes only eight Adeptal Assistance stacks on teammates’ plunges', () => {
  const members: CharacterKey[] = ['Xianyun', 'Xiao']
  const sim = simulateRotation({
    rotation: parseRotation(
      `Xianyun Q -> Xiao E E Q ${Array(10).fill('J P').join(' ')}`,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Xianyun: 'anemo', Xiao: 'anemo' },
    constellations: {},
    repeats: 1,
  })
  const plunges = sim.hits.filter(
    (h) => h.characterKey === 'Xiao' && h.tag === 'plunge'
  )
  const followups = sim.hits.filter(
    (h) =>
      h.characterKey === 'Xianyun' &&
      h.path.join('.') === 'burst.coordinatedDmg'
  )
  expect(plunges).toHaveLength(10)
  expect(followups).toHaveLength(8)
  followups.forEach((h, i) => expect(h.t).toBe(plunges[i].t + 5))
})
