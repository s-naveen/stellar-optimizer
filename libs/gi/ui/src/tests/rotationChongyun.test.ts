import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  RotationCalculation,
  SimHit,
} from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Chongyun']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Chongyun: 'cryo', Kaeya: 'cryo', Mona: 'hydro' },
    constellations: { Chongyun: 6 },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
    ...extra,
  })
}

it('reduces abilities cast in the field and during the recipient’s lingering infusion', () => {
  const sim = run('Chongyun E Q Q Q Q')
  expect(sim.actions.map((a) => a.start)).toEqual([0, 57, 669, 1281, 2001])
  expect(
    sim.hits
      .filter((h) => h.label === 'Layered Frost hitlag')
      .map((h) => h.animationPause)
  ).toEqual([6])
})

it.each([
  'Kaeya',
  'Mona',
] as const)('grants C2 to %s on entry while A1 attack speed is limited to melee weapons', (member) => {
  const speeds: number[] = []
  const probe: KitModel = {
    characterKey: member,
    element: member === 'Kaeya' ? 'cryo' : 'hydro',
    source: 'test',
    act(c) {
      speeds.push(c.attackSpeed)
      return { frames: 1, cooldown: { key: 'skill', frames: 100 } }
    },
  }
  const sim = run(`Chongyun E -> ${member} E E W13 E`, {
    members: ['Chongyun', member],
    kits: { Chongyun: kitModels.Chongyun, [member]: probe },
  })
  const actions = sim.actions.filter((a) => a.characterKey === member)
  expect(actions[1].start - actions[0].start).toBe(85)
  expect(speeds).toEqual(member === 'Kaeya' ? [0.08, 0.08, 0] : [0, 0, 0])
})

it('keeps Chongyun’s melee pauses and C1 blades on their native hit timelines', () => {
  const sim = run('Chongyun N4 W1')
  expect(
    sim.hits.filter((h) => h.path[1] === 'hitlag').map((h) => h.animationPause)
  ).toEqual([10, 9, 11, 11])
  expect(
    sim.hits.filter((h) => h.path[0] === 'constellation1').map((h) => h.t)
  ).toEqual([206, 211, 216])
})

it('retains the original field’s ATK snapshot for its expiry blade', () => {
  const sim = run('Chongyun E Q W12', {
    gear: { Chongyun: { sets: { NoblesseOblige: 4 } } },
  })
  const blade = sim.hits.find(
    (h) => h.label === 'Spirit Blade (A4, field expiry)'
  )!
  expect(blade.t).toBe(655)
  expect(blade.statSnapshots?.[0].t).toBe(0)
  expect(blade.blunt).toBe(true)
  expect(blade.states?.find((s) => s.path[1] === 'asc4')?.value).toBe('')
})

it('allows burst blades to Shatter an existing Frozen aura', () => {
  const mona: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act(c) {
      c.hit(0, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'hydro',
        applies: true,
        durability: 100,
        icd: 'none',
        label: 'Hydro probe',
      })
      return { frames: 1 }
    },
  }
  const sim = run('Mona E -> Chongyun E Q W2', {
    members: ['Mona', 'Chongyun'],
    kits: { Mona: mona, Chongyun: kitModels.Chongyun },
    reactions: undefined,
  })
  const q = sim.actions.find(
    (a) => a.characterKey === 'Chongyun' && a.text === 'Q'
  )!.start
  expect(sim.hits.some((h) => h.label === 'Shattered' && h.t === q + 50)).toBe(
    true
  )
})

const c6State = (hit: SimHit) =>
  hit.states?.find((s) => s.owner === 'Chongyun' && s.path[1] === 'c6')?.value

it('checks C6 before each blade and uses that condition when evaluating damage', () => {
  const evaluated: unknown[] = []
  const calculate: RotationCalculation = (_member, path) =>
    path.join('.') === 'total.hp' ? 20000 : 0
  calculate.damage = (_member, attack) => {
    const off = attack.limits?.some(
      (s) => s.owner === 'Chongyun' && s.path[1] === 'c6' && s.hits === 0
    )
    evaluated.push(
      attack.states?.find((s) => s.owner === 'Chongyun' && s.path[1] === 'c6')
        ?.value ?? (off ? '' : undefined)
    )
    return [{ damage: 250, probability: 1 }]
  }
  const sim = run('Chongyun Q W1', {
    calculate,
    target: { radius: 2, distance: 2.4, maxHp: 1000 },
  })
  // An enemy at full HP is not below Chongyun's full HP. The first blade
  // damages it, so subsequent blades gain the bonus without changing blade 1.
  expect(sim.hits.filter((h) => h.tag === 'burst').map(c6State)).toEqual([
    '',
    'on',
    'on',
    'on',
  ])
  expect(evaluated).toEqual(['', 'on', 'on', 'on'])
})

it('requires the enemy HP percentage to be strictly below Chongyun’s current HP percentage', () => {
  const calculate: RotationCalculation = (_member, path) =>
    path.join('.') === 'total.hp' ? 20000 : 0
  calculate.damage = (member) => [
    { damage: member === 'Mona' ? 500 : 250, probability: 1 },
  ]
  const mona: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act(c) {
      c.drainHp('Chongyun', 0.5)
      c.hit(0, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'hydro',
        label: 'Enemy HP probe',
      })
      return { frames: 1 }
    },
  }
  const sim = run('Mona E -> Chongyun Q W1', {
    members: ['Mona', 'Chongyun'],
    kits: { Mona: mona, Chongyun: kitModels.Chongyun },
    calculate,
    target: { radius: 2, distance: 2.4, maxHp: 1000 },
  })
  expect(sim.hits.filter((h) => h.tag === 'burst').map(c6State)).toEqual([
    '',
    'on',
    'on',
    'on',
  ])
})

it('does not infer C6 from hits that deal zero damage', () => {
  const calculate: RotationCalculation = (_member, path) =>
    path.join('.') === 'total.hp' ? 20000 : 0
  calculate.damage = () => [{ damage: 0, probability: 1 }]
  const sim = run('Chongyun E Q W1', { calculate })
  expect(sim.hits.filter((h) => h.tag === 'burst').map(c6State)).toEqual([
    '',
    '',
    '',
    '',
  ])
})
