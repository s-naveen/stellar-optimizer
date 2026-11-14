import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { Cooldowns } from '../util/teamOpt/rotation/cooldowns'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Varka', 'Venti', 'Bennett']
const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Varka: 'anemo', Venti: 'anemo', Bennett: 'pyro' },
    constellations: { Varka: 0 },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
    ...extra,
  })

it('starts C0 with both special charges recharging, rather than a free special', () => {
  const sim = run('Varka E E W1')
  expect(sim.warnings).toEqual([])
  expect(sim.actions.map((a) => a.start)).toEqual([0, 666]) // 39 + 660 * .95
  expect(
    sim.hits.filter((h) => h.label === "Four Winds' Ascension").map((h) => h.t)
  ).toEqual([700, 709])
})

it('reduces recharge once per normal damage instance, including both parts of multi-hit steps', () => {
  const sim = run('Varka E N5 E W1')
  expect(sim.actions.map((a) => a.start)).toEqual([0, 58, 291])
  const normals = sim.hits.filter((h) => h.tag === 'normal')
  expect(normals).toHaveLength(9)
  expect(
    sim.hits.filter((h) => h.label === "Four Winds' Ascension").map((h) => h.t)
  ).toEqual([325, 334])
})

it('uses ordinary converted charged attacks while no special charge is available', () => {
  const sim = run('Varka E C W1')
  expect(
    sim.hits.filter((h) => h.label === 'Sturm und Drang Charged Attack')
  ).toHaveLength(2)
  expect(sim.hits.some((h) => h.label === 'Azure Devour')).toBe(false)
})

it('keeps Azure Devour hitmarks on the world clock and pauses its recovery twice', () => {
  const sim = run('Varka E N5 C N1 W1')
  const ca = sim.actions[2].start
  expect(
    sim.hits.filter((h) => h.label === 'Azure Devour').map((h) => h.t - ca)
  ).toEqual([40, 40, 60, 60])
  expect(sim.actions[3].start - ca).toBe(82) // 64f cancel + 18f hitlag
})

it('retains waiting recharge durations when restarting the active charge', () => {
  const cds = new Cooldowns(() => 2)
  cds.spend('special', 0, 500)
  cds.spend('special', 0, 400)
  cds.restart('special', 100, 600)
  expect(cds.readyAt('special', 100)).toBe(500)
  cds.spend('special', 500, 700)
  expect(cds.readyAt('special', 500)).toBe(1100)
  cds.reset('special', 600)
  expect(cds.readyAt('special', 600)).toBe(600)
})

it('polls A1 on Varka’s character clock and captures that source context on later hits', () => {
  const sim = run('Varka E N5 Q W1')
  const e = sim.hits.find((h) => h.label === 'Windbound Execution')!
  const normal = sim.hits.find((h) => h.label === 'Sturm und Drang N1')!
  expect(e.statSnapshots?.[0].t).toBe(0)
  expect(normal.statSnapshots?.[0].t).toBe(69) // initial E pauses the 60f poll by 9f
  expect(normal.statSnapshots?.[0].path).toEqual([
    'display',
    'passive1',
    'a1Phec_pyro_dmg_',
  ])
  expect(rotationAttacks(sim).Varka?.some((a) => a.statSnapshots?.length)).toBe(
    true
  )
})

it('uses separate Swirl ICDs per teammate, accepts Stellar Swirl and expires A4 on Varka’s clock', () => {
  const pulse = (
    characterKey: 'Venti' | 'Bennett',
    times: number[]
  ): KitModel => ({
    characterKey,
    element: characterKey === 'Venti' ? 'anemo' : 'pyro',
    source: 'test',
    act: () => ({ frames: 1 }),
    onStart(c) {
      for (const t of times)
        c.hit(t, {
          path: [
            '_reaction',
            characterKey === 'Venti' ? 'pyroSwirl' : 'stellarSwirl',
          ],
          tag: 'other',
          element: 'pyro',
          label: 'Swirl probe',
        })
    },
  })
  const sim = run('Varka E W12', {
    kits: {
      Varka: kitModels.Varka,
      Venti: pulse('Venti', [10, 30, 70]),
      Bennett: pulse('Bennett', [30]),
    },
  })
  const stacks = sim.buffWindows.filter(
    (w) => w.owner === 'Varka' && w.path[1] === 'a4Stacks'
  )
  expect(stacks.filter((w) => w.value).map((w) => [w.start, w.value])).toEqual([
    [10, '1'],
    [30, '2'],
    [70, '3'],
  ])
  expect(stacks.find((w) => w.value === '3')?.end).toBe(550)
  // No pause after the last refresh, so the final 480f status ends exactly at 550.
})
