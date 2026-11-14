/**
 * `teamRotationNodes` computed with one team calculation for all buff contexts (`sharedSource`)
 * gives the same formulas as one calculation per context: for rotations of every kind (played by
 * the kits, with set and weapon effects worn and as candidates), each member's problem is built
 * both ways and evaluated at random artifact stats.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { OptNode, ReadNode } from '@genshin-optimizer/gi/wr'
import { forEachNodes, precompute } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../'
import {
  kqmArtData,
  kqmWeaponData,
  kqmWeapons,
  teamRotationEngine,
  teamRotationNodes,
} from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

const teams: {
  name: string
  members: CharacterKey[]
  text: string
  cons?: Partial<Record<CharacterKey, number>>
}[] = [
  {
    name: 'Stellar Swirl, Viridescent Venerer',
    members: ['YumemizukiMizuki', 'Odette', 'Anastasya', 'TravelerCryo'],
    text: 'Anastasya E Q -> TravelerCryo E CA Q -> Odette E E -> YumemizukiMizuki E W10 -> Anastasya',
    cons: { YumemizukiMizuki: 2, TravelerCryo: 6 },
  },
  {
    name: 'Vaporize',
    members: ['HuTao', 'Xingqiu', 'Yelan', 'Zhongli'],
    text: 'Zhongli hE -> Xingqiu E Q -> Yelan E Q -> HuTao E N1 CA N1 CA N1 CA N1 CA N1 CA Q -> Zhongli',
  },
  {
    name: 'Melt',
    members: ['Ganyu', 'Xiangling', 'Bennett', 'Zhongli'],
    text: 'Zhongli hE -> Bennett E Q -> Xiangling E Q -> Ganyu E Q CA CA CA -> Zhongli',
    cons: { Bennett: 6 },
  },
  {
    name: 'Superconduct, physical',
    members: ['Eula', 'RaidenShogun', 'Rosaria', 'Zhongli'],
    text: 'Zhongli hE -> RaidenShogun E -> Rosaria E Q -> Eula E Q N3 N3 N3 hE -> Zhongli',
  },
  {
    name: 'Swirl',
    members: ['KaedeharaKazuha', 'Xiangling', 'Bennett', 'Xingqiu'],
    text: 'Xingqiu E Q -> Bennett E Q -> Xiangling E Q -> KaedeharaKazuha E P Q -> Xingqiu',
  },
  {
    name: 'Frozen, infusion',
    members: ['Chongyun', 'SangonomiyaKokomi', 'Ganyu', 'Venti'],
    text: 'SangonomiyaKokomi E -> Ganyu E Q -> Chongyun E N4 N4 N4 -> SangonomiyaKokomi',
  },
  {
    name: 'Hyperbloom',
    members: ['Nahida', 'Xingqiu', 'KukiShinobu', 'Yelan'],
    text: 'Nahida E Q -> KukiShinobu E -> Xingqiu E Q -> Yelan E Q -> Nahida N3 N3 -> Nahida',
  },
  {
    name: 'Aggravate',
    members: ['Nahida', 'Fischl', 'RaidenShogun', 'KaedeharaKazuha'],
    text: 'Fischl E -> Nahida E Q -> KaedeharaKazuha E P -> RaidenShogun E Q N4 N4 N4 -> Fischl',
  },
  {
    name: 'Lunar-Charged',
    members: ['Flins', 'Ineffa', 'Aino', 'Sucrose'],
    text: 'Ineffa E Q -> Aino E Q -> Sucrose E -> Flins E N3 N3 Q N3 -> Ineffa',
  },
  {
    name: 'Lunar-Crystallize',
    members: ['Zibai', 'Columbina', 'Linnea', 'Illuga'],
    text: 'Columbina E Q -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> Columbina',
    cons: { Illuga: 6 },
  },
  {
    name: 'Stellar-Conduct',
    members: ['Odette', 'Fischl', 'Beidou', 'Kaeya'],
    text: 'Fischl E -> Kaeya E Q -> Odette E Q -> Beidou E Q N3 N3 -> Fischl',
  },
  {
    name: 'Natlan, Nightsoul',
    members: ['Mualani', 'Furina', 'Xilonen', 'Xiangling'],
    text: 'Furina E Q -> Xilonen E N2 -> Xiangling E Q -> Mualani Q E J J N1 J J N1 J J N1 -> Furina',
  },
]

/** Sets with effects the rotation plays, worn by the members in turn */
const WORN: ArtifactSetKey[] = [
  'NoblesseOblige',
  'TenacityOfTheMillelith',
  'Instructor',
  'ScrollOfTheHeroOfCinderCity',
]
/** What the optimized member may get (its candidates in the rotation) */
const CANDIDATES: ArtifactSetKey[] = [
  'ViridescentVenerer',
  'ScarletProof',
  'NoblesseOblige',
  'CrimsonWitchOfFlames',
  'GoldenTroupe',
  'MarechausseeHunter',
  'DeepwoodMemories',
]
const SETS: ReadonlySet<string> = new Set(allArtifactSetKeys)

function setup({ members, text, cons = {} }: (typeof teams)[number]) {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of members)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: cons[key] ?? 0,
    })
  const ids = members.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const weapons = Object.fromEntries(
    members.map((k) => [
      k,
      kqmWeaponData(kqmWeapons(k, undefined, { all: true })[0], k),
    ])
  )
  const builds = Object.fromEntries(
    members.map((k, i): [CharacterKey, KqmBuild] => [
      k,
      {
        weapon: kqmWeapons(k, undefined, { all: true })[0],
        sets: { [WORN[i % WORN.length]]: 4 },
        mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
        rolls: { critRate_: 6, critDMG_: 6, atk_: 4, enerRech_: 4 },
      },
    ])
  ) as Record<CharacterKey, KqmBuild>
  const played = (dyn: CharacterKey) => {
    const gear = Object.fromEntries(
      members.map((k): [CharacterKey, SimGear] => [
        k,
        k === dyn
          ? { weapon: builds[k].weapon.key, candidates: { sets: CANDIDATES } }
          : { weapon: builds[k].weapon.key, sets: builds[k].sets },
      ])
    )
    return rotationAttacks(
      simulateRotation({
        rotation: parseRotation(
          text,
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: cons,
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear,
      })
    )
  }
  return { database, teamId, weapons, builds, played }
}

/** Deterministic pseudo-random numbers in [0, 1) */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('one team calculation for all buff contexts', () => {
  for (const team of teams)
    it(`${team.name}: the same formulas as one calculation per context`, () => {
      const { database, teamId, weapons, builds, played } = setup(team)
      const before = teamRotationEngine.fallbacks
      let contexts = 0
      for (const dyn of team.members) {
        const attacks = played(dyn)
        contexts += new Set(
          Object.values(attacks)
            .flat()
            .map((a) => JSON.stringify(a?.states ?? []))
        ).size
        const settings = {
          dyn,
          arts: Object.fromEntries(
            team.members
              .filter((k) => k !== dyn)
              .map((k) => [k, kqmArtData(builds[k])])
          ),
          attacks,
          weapons,
          statFilters: {
            [dyn]: {
              [JSON.stringify(['basic', 'enerRech_'])]: [
                { value: 120, disabled: false },
              ],
            },
          },
        }
        teamRotationEngine.shared = false
        const each = teamRotationNodes(database, teamId, 'F', settings)!
        teamRotationEngine.shared = true
        const shared = teamRotationNodes(database, teamId, 'F', settings)!
        expect(shared.terms.map((t) => [t.characterKey, t.attack])).toEqual(
          each.terms.map((t) => [t.characterKey, t.attack])
        )
        expect(shared.constraints.map((c) => c.min)).toEqual(
          each.constraints.map((c) => c.min)
        )
        const nodesOf = (r: typeof each) => [
          ...r.terms.map((t) => t.node),
          ...r.constraints.map((c) => c.value),
        ]
        const reads = new Set<string>()
        forEachNodes<OptNode>([...nodesOf(each), ...nodesOf(shared)], (n) => {
          if (n.operation === 'read') reads.add(n.path[1])
        })
        // (no switch is left in a formula)
        expect([...reads].filter((k) => k.startsWith('§'))).toEqual([])
        const bind = (r: ReadNode<number>) => r.path[1]
        const a = precompute(nodesOf(each), {}, bind, 1)
        const b = precompute(nodesOf(shared), {}, bind, 1)
        const next = random(team.members.indexOf(dyn) + 7)
        for (let trial = 0; trial < 24; trial++) {
          const values: Record<string, number> = {}
          for (const key of reads)
            values[key] = SETS.has(key)
              ? // (one candidate at a time at 4 pieces, then mixes)
                trial < CANDIDATES.length
                ? key === CANDIDATES[trial]
                  ? 4
                  : 0
                : [0, 0, 2, 4][Math.floor(next() * 4)]
              : key.endsWith('_')
                ? next() * 1.5
                : next() * (key === 'hp' ? 20000 : 1500)
          const x = a([{ values }])
          const y = b([{ values }])
          expect(y.length).toBe(x.length)
          for (let i = 0; i < x.length; i++)
            expect(
              Math.abs(y[i] - x[i]),
              `${dyn} formula ${i} of ${x.length}: ${x[i]} vs ${y[i]}`
            ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(x[i])))
        }
      }
      // (the shared calculation was used, not its fallback; and there was something to share)
      expect(
        teamRotationEngine.fallbacks,
        String(teamRotationEngine.lastError)
      ).toBe(before)
      expect(contexts).toBeGreaterThan(team.members.length)
    }, 180_000)
})
