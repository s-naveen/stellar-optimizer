import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import {
  KQM_SUBSTAT_ROLLS,
  kqmConstellation,
  kqmRollCaps,
} from '../util/teamOpt/kqm'
import { attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { lohenWillAfterHit } from '../util/teamOpt/rotation/kits/Lohen'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  RotationCalculation,
} from '../util/teamOpt/rotation/types'
import fixtures from './fixtures/priority-missing-kits/teams.json'

it('uses rolled damage at both strict thresholds and clips each Will outcome before taking its mean', () => {
  const rolls = [
    { damage: 1000, probability: 0.25 },
    { damage: 1001, probability: 0.25 },
    { damage: 2999, probability: 0.25 },
    { damage: 3000, probability: 0.25 },
  ]
  expect([...lohenWillAfterHit(new Map([[0, 1]]), rolls, 100)]).toEqual([
    [1, 0.25],
    [20, 0.5],
    [80, 0.25],
  ])
  const capped = lohenWillAfterHit(new Map([[80, 1]]), rolls, 100)
  expect([...capped]).toEqual([
    [81, 0.25],
    [100, 0.75],
  ])
  expect([...capped].reduce((sum, [will, p]) => sum + will * p, 0)).toBe(95.25)
})

it('uses KQM constellations, talents and legal artifact roll budgets in the missing-kit fixture', () => {
  for (const team of fixtures.teams)
    for (const build of team.members) {
      expect(build.cons).toBe(kqmConstellation(build.key as CharacterKey))
      expect(build.talent).toEqual([10, 10, 10])
      expect(
        Object.values(build.liquidRolls).reduce((sum, n) => sum + n, 0)
      ).toBe(20)
      const caps = kqmRollCaps(build.mains as never)
      for (const [key, n] of Object.entries(build.liquidRolls)) {
        const stat = key as keyof typeof KQM_SUBSTAT_ROLLS
        expect(n).toBeLessThanOrEqual(caps[stat])
        expect(build.subs[stat]).toBeCloseTo(
          (2 + n) * KQM_SUBSTAT_ROLLS[stat] * (stat.endsWith('_') ? 100 : 1),
          4
        )
      }
    }
})

it('applies Will to talent scaling without multiplying flat damage additions', () => {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  database.chars.set('Lohen', {
    key: 'Lohen',
    level: 90,
    ascension: 6,
    talent: { auto: 10, skill: 10, burst: 10 },
    constellation: 0,
  })
  database.weapons.new({
    key: 'FavoniusLance',
    level: 90,
    ascension: 6,
    refinement: 5,
    location: 'Lohen',
    lock: false,
  })
  const teamCharId = database.teamChars.new('Lohen')
  const teamId = database.teams.new({ loadoutData: [{ teamCharId }] })
  const hit = (talentMultiplier: number, flat = 0, will = '') =>
    attackHitData(database, teamId, 'F', {
      characterKey: 'Lohen',
      attack: {
        path: ['skill', 'etchDmg'],
        hits: 1,
        hitMode: 'avgHit',
        talentMultiplier,
        bonusStats: { cryo_dmgInc: flat },
        states: will
          ? [{ owner: 'Lohen', path: ['Lohen', 'willConsumed'], value: will }]
          : [],
      },
    })!.hit!.value
  const base = hit(1)
  expect(base).toBeGreaterThan(0)
  expect(hit(1.4)).toBeCloseTo(base * 1.4, 6)
  expect(hit(1.4, 500) - hit(1, 500)).toBeCloseTo(base * 0.4, 6)
  expect(hit(1, 0, '7')).toBeCloseTo(base * 1.028, 6)
})

const members: CharacterKey[] = ['Lohen', 'Fischl']
const parse = (text: string) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
const calculate: RotationCalculation = (_member, path) =>
  path.join('.') === 'base.atk' ? 100 : path[1] === 'hp' ? 20000 : 9
calculate.damage = () => [
  { damage: 1001, probability: 0.5 },
  { damage: 3000, probability: 0.5 },
]
const ally: KitModel = {
  characterKey: 'Fischl',
  element: 'electro',
  source: 'test',
  init: () => ({ fired: false }),
  act: () => ({ frames: 1 }),
  onPartyAction(c, s, actor, action) {
    if (actor !== 'Lohen' || action.kind !== 'skill' || s.fired) return
    s.fired = true
    c.hit(1, {
      characterKey: 'Fischl',
      path: ['skill', 'ozDmg'],
      tag: 'skill',
      element: 'physical',
      label: 'Damage probe',
    })
  },
}
const run = (
  text: string,
  calculation: RotationCalculation | undefined = calculate
) =>
  simulateRotation({
    rotation: parse(text),
    members,
    elements: { Lohen: 'cryo', Fischl: 'electro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    calculate: calculation,
    kits: { Lohen: kitModels.Lohen, Fischl: ally },
  })

it('consumes Joy on a special skill and refuses to reuse it without rebuilding Joy', () => {
  const sim = run('Fischl E -> Lohen E N4 E E W1')
  const hits = sim.hits.filter((h) => h.label === 'Etched Into Bone and Soul')
  expect(hits).toHaveLength(4)
  expect(hits.map((h) => h.t - hits[0].t)).toEqual([0, 7, 17, 24])
  expect(hits.every((h) => h.talentMultiplier === 1.2)).toBe(true)
  expect(sim.warnings).toEqual([
    'Lohen: Etched Into Bone and Soul needs 100 Joy and has three uses per Masterstroke.',
  ])
  const attacks = rotationAttacks(sim).Lohen!.filter(
    (a) => a.path[1] === 'etchDmg'
  )
  expect(attacks.reduce((sum, a) => sum + a.hits, 0)).toBe(4)
  expect(attacks.every((a) => a.talentMultiplier === 1.2)).toBe(true)
})

it('averages the Hexerei trigger probability without creating extra damage instances', () => {
  const sim = run('Fischl E -> Lohen E N4 E N1 W1')
  expect(sim.warnings).toEqual([])
  const normal = sim.hits.filter((h) => h.tag === 'normal').at(-1)!
  expect(normal.bonusStats?.normal_dmg_).toBeCloseTo(20)
  expect(
    rotationAttacks(sim).Lohen!.some((a) => a.bonusStats?.normal_dmg_ === 20)
  ).toBe(true)
})

it('allows only three special skills in one Masterstroke stance', () => {
  const sim = run('Fischl E -> Lohen E N4 E N4 E N4 E N4 E W1')
  expect(
    sim.hits.filter((h) => h.label === 'Etched Into Bone and Soul')
  ).toHaveLength(12)
  expect(sim.warnings).toContain(
    'Lohen: Etched Into Bone and Soul needs 100 Joy and has three uses per Masterstroke.'
  )
})

it('applies the per-member Will gain ICD without dropping later hits', () => {
  const damage = vi.fn((_member: CharacterKey, _attack: TeamOptAttack) => [
    { damage: 1001, probability: 1 },
  ])
  const calc: RotationCalculation = (...args) => calculate(...args)
  calc.damage = damage
  const probe: KitModel = {
    ...ally,
    onPartyAction(c, s, actor, action) {
      if (actor !== 'Lohen' || action.kind !== 'skill' || s.fired) return
      s.fired = true
      for (const t of [1, 2, 7])
        c.hit(t, {
          characterKey: 'Fischl',
          path: ['skill', 'ozDmg'],
          tag: 'skill',
          element: 'physical',
          label: 'Damage probe',
        })
    },
  }
  const sim = simulateRotation({
    rotation: parse('Fischl E -> Lohen E N4 E W1'),
    members,
    elements: { Lohen: 'cryo', Fischl: 'electro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    calculate: calc,
    kits: { Lohen: kitModels.Lohen, Fischl: probe },
  })
  expect(sim.warnings).toEqual([])
  expect(damage).toHaveBeenCalledTimes(2)
  expect(
    sim.hits.find((h) => h.label === 'Etched Into Bone and Soul')
      ?.talentMultiplier
  ).toBeCloseTo(1.16)
})

it('captures damage before hit-triggered buffs and resolves the reaction before notifying damage listeners', () => {
  const damage = vi.fn((_member: CharacterKey, _attack: TeamOptAttack) => [
    { damage: 1000, probability: 1 },
  ])
  const calc: RotationCalculation = (...args) => calculate(...args)
  calc.damage = damage
  const source: KitModel = {
    ...ally,
    onStart(c) {
      c.state('Fischl', ['NoblesseOblige', 'set4'], '')
    },
    onHit(c, _s, hit) {
      if (hit.characterKey === 'Fischl')
        c.state('Fischl', ['NoblesseOblige', 'set4'], 'on')
    },
  }
  const sim = simulateRotation({
    rotation: parse('Fischl E -> Lohen E N4 E W1'),
    members,
    elements: { Lohen: 'cryo', Fischl: 'electro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    calculate: calc,
    kits: { Lohen: kitModels.Lohen, Fischl: source },
    reactions: {
      onHit(_c, hit) {
        if (hit.characterKey === 'Fischl') hit.reaction = 'melt'
      },
    },
  })
  expect(sim.warnings).toEqual([])
  const attack = damage.mock.calls[0]![1]
  expect(attack.reaction).toBe('melt')
  expect(attack.limits).toContainEqual({
    owner: 'Fischl',
    path: ['NoblesseOblige', 'set4'],
    hits: 0,
  })
})

it('clears stance and resource on swap and requires a damage evaluator', () => {
  const sim = simulateRotation({
    rotation: parse('Lohen E'),
    members,
    elements: { Lohen: 'cryo', Fischl: 'electro' },
    constellations: {},
    repeats: 1,
  })
  expect(sim.warnings).toContain(
    'Lohen: teammate damage evaluation is required to calculate Will to Win.'
  )
  const swapped = run('Fischl E -> Lohen E N4 -> Fischl E -> Lohen N1 W1')
  expect(swapped.hits.filter((h) => h.tag === 'normal').at(-1)?.element).toBe(
    'physical'
  )
  expect(swapped.unsupported).toEqual([])
})
