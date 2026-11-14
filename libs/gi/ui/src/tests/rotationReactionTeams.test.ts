/**
 * One team per elemental reaction: the rotation, played by the kits and the reaction engine
 * (reactions.ts, gcsim's reactable), produces that reaction. Prints each team's reactions.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

function run(
  members: CharacterKey[],
  text: string,
  constellations: Partial<Record<CharacterKey, number>> = {}
) {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
  })
  /** Reaction → count: transformative hits by node, flagged hits by reaction, markers by kind */
  const counts = new Map<string, number>()
  const inc = (k: string, w = 1) => counts.set(k, (counts.get(k) ?? 0) + w)
  for (const h of sim.hits) {
    if (h.path[0] === 'reaction') inc(h.path[1], h.weight ?? 1)
    else if (h.path[0] === '_reaction') inc(`(${h.path[1]})`)
    if (h.reaction) inc(h.reaction)
  }
  return { sim, counts }
}

const teams: {
  reaction: string
  members: CharacterKey[]
  text: string
  cons?: Partial<Record<CharacterKey, number>>
  expect: string[]
}[] = [
  {
    reaction: 'Vaporize',
    members: ['HuTao', 'Xingqiu', 'Yelan', 'Zhongli'],
    text: 'Zhongli hE -> Xingqiu E Q -> Yelan E Q -> HuTao E N1 CA N1 CA N1 CA N1 CA N1 CA Q -> Zhongli',
    expect: ['vaporize'],
  },
  {
    reaction: 'Melt',
    members: ['Ganyu', 'Xiangling', 'Bennett', 'Zhongli'],
    text: 'Zhongli hE -> Bennett E Q -> Xiangling E Q -> Ganyu E Q CA CA CA -> Zhongli',
    expect: ['melt'],
  },
  {
    reaction: 'Overloaded',
    members: ['RaidenShogun', 'Xiangling', 'Bennett', 'Chevreuse'],
    text: 'RaidenShogun E -> Bennett E Q -> Xiangling E Q -> Chevreuse E -> RaidenShogun Q N4 N4 N4 -> RaidenShogun',
    expect: ['overloaded'],
  },
  {
    reaction: 'Superconduct',
    members: ['Eula', 'RaidenShogun', 'Rosaria', 'Zhongli'],
    text: 'Zhongli hE -> RaidenShogun E -> Rosaria E Q -> Eula E Q N3 N3 N3 hE -> Zhongli',
    expect: ['superconduct'],
  },
  {
    reaction: 'Electro-Charged',
    members: ['Beidou', 'Xingqiu', 'Fischl', 'KaedeharaKazuha'],
    text: 'Fischl E -> Xingqiu E Q -> Beidou E Q -> KaedeharaKazuha E P Q -> Beidou N3 N3 -> Fischl',
    expect: ['electrocharged'],
  },
  {
    reaction: 'Swirl',
    members: ['KaedeharaKazuha', 'Xiangling', 'Bennett', 'Xingqiu'],
    text: 'Xingqiu E Q -> Bennett E Q -> Xiangling E Q -> KaedeharaKazuha E P Q -> Xingqiu',
    // (Pyro comes first in gcsim's swirl order; the Electro-Charged team swirls Hydro too)
    expect: ['pyroSwirl'],
  },
  {
    reaction: 'Frozen + Shattered',
    members: ['Chongyun', 'SangonomiyaKokomi', 'Ganyu', 'Venti'],
    text: 'SangonomiyaKokomi E -> Ganyu E Q -> Chongyun E N4 N4 N4 -> SangonomiyaKokomi',
    expect: ['(frozen)', 'shattered'],
  },
  {
    reaction: 'Crystallize',
    members: ['Navia', 'Zhongli', 'Xiangling', 'Bennett'],
    text: 'Zhongli hE -> Bennett E Q -> Xiangling E Q -> Navia E N3 E Q -> Zhongli',
    expect: ['(crystallize)'],
  },
  {
    reaction: 'Burning',
    members: ['Nahida', 'Xiangling', 'Thoma', 'KaedeharaKazuha'],
    text: 'Nahida E Q -> Thoma E Q -> Xiangling E Q -> KaedeharaKazuha E P -> Nahida',
    expect: ['burning'],
  },
  {
    reaction: 'Bloom',
    members: ['Nahida', 'Xingqiu', 'Yelan', 'Zhongli'],
    text: 'Zhongli hE -> Nahida E Q -> Xingqiu E Q -> Yelan E Q -> Nahida N3 N3 -> Zhongli',
    expect: ['bloom'],
  },
  {
    reaction: 'Nilou Bloom (Bountiful Cores)',
    members: ['Nilou', 'Nahida', 'SangonomiyaKokomi', 'Baizhu'],
    text: 'Nahida E Q -> SangonomiyaKokomi E -> Baizhu E Q -> Nilou E N3 Q -> Nahida',
    expect: ['bloom', 'bountiful'],
  },
  {
    reaction: 'Hyperbloom',
    members: ['Nahida', 'Xingqiu', 'KukiShinobu', 'Yelan'],
    text: 'Nahida E Q -> KukiShinobu E -> Xingqiu E Q -> Yelan E Q -> Nahida N3 N3 -> Nahida',
    expect: ['hyperbloom'],
  },
  {
    reaction: 'Burgeon',
    members: ['Nahida', 'Xingqiu', 'Thoma', 'Yelan'],
    text: 'Nahida E Q -> Thoma E Q -> Xingqiu E Q -> Yelan E Q -> Nahida N3 N3 -> Nahida',
    expect: ['burgeon'],
  },
  {
    reaction: 'Aggravate',
    members: ['Nahida', 'Fischl', 'RaidenShogun', 'KaedeharaKazuha'],
    text: 'Fischl E -> Nahida E Q -> KaedeharaKazuha E P -> RaidenShogun E Q N4 N4 N4 -> Fischl',
    expect: ['aggravate'],
  },
  {
    reaction: 'Spread',
    members: ['Alhaitham', 'Nahida', 'Fischl', 'Zhongli'],
    text: 'Zhongli hE -> Fischl E -> Nahida E Q -> Alhaitham E N3 N3 Q N3 N3 -> Zhongli',
    expect: ['spread'],
  },
  {
    reaction: 'Lunar-Charged',
    members: ['Flins', 'Ineffa', 'Aino', 'Sucrose'],
    text: 'Ineffa E Q -> Aino E Q -> Sucrose E -> Flins E N3 N3 Q N3 -> Ineffa',
    expect: ['lunarcharged'],
  },
  {
    reaction: 'Lunar-Bloom',
    members: ['Lauma', 'Nahida', 'SangonomiyaKokomi', 'Yelan'],
    text: 'Lauma E Q -> Nahida E -> SangonomiyaKokomi E -> Yelan E Q -> Lauma N3 N3 -> Lauma',
    expect: ['(lunarBloom)'],
  },
  {
    reaction: 'Lunar-Crystallize',
    members: ['Zibai', 'Columbina', 'Linnea', 'Illuga'],
    text: 'Columbina E Q -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> Columbina',
    cons: { Zibai: 1, Linnea: 2, Illuga: 6 },
    expect: ['lunarcrystallize'],
  },
  {
    reaction: 'Stellar-Conduct',
    members: ['Odette', 'Fischl', 'Beidou', 'Kaeya'],
    text: 'Fischl E -> Kaeya E Q -> Odette E Q -> Beidou E Q N3 N3 -> Fischl',
    expect: ['(stellarConduct)', 'polestarStacks'],
  },
  {
    reaction: 'Stellar Swirl',
    members: ['Odette', 'Sucrose', 'Ganyu', 'KaedeharaKazuha'],
    text: 'Ganyu E Q -> Odette E Q -> Sucrose E -> KaedeharaKazuha E P -> Sucrose E -> Ganyu',
    expect: ['stellarswirl'],
  },
]

describe('one team per reaction', () => {
  it.each(teams)('$reaction', ({ members, text, cons, expect: want }) => {
    const { sim, counts } = run(members, text, cons)
    const bountiful = sim.hits.filter((h) =>
      h.label.includes('Bountiful')
    ).length
    if (bountiful) counts.set('bountiful', bountiful)
    const polestar = sim.buffWindows.filter(
      (w) => w.path[1] === 'polestarStacks' && w.value !== '0'
    )
    if (polestar.length)
      counts.set(
        'polestarStacks',
        Math.max(...polestar.map((w) => Number(w.value)))
      )
    console.log(
      `${text} (${(sim.frames / 60).toFixed(1)} s)\n  ${[...counts]
        .map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`)
        .join(
          ', '
        )}${sim.warnings.length ? `\n  warnings: ${sim.warnings.join(' / ')}` : ''}`
    )
    for (const r of want) expect(counts.get(r) ?? 0, r).toBeGreaterThan(0)
    // every reaction hit becomes an attack on a member
    const attacks = Object.values(rotationAttacks(sim)).flat()
    expect(attacks.length).toBeGreaterThan(0)
  })
})
