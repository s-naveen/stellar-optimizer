/**
 * The simulation's shared mechanics on known teams: auras (Vaporize/Melt), gcsim's ICD groups,
 * the normal-attack watchers (Xingqiu, Yelan, Thoma, Fischl C6) and party infusions.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

function run(
  members: CharacterKey[],
  text: string,
  constellations: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
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
}
const hitsOf = (
  sim: ReturnType<typeof run>,
  characterKey: CharacterKey,
  label: RegExp
) =>
  sim.hits.filter((h) => h.characterKey === characterKey && label.test(h.label))

function ecProbe(
  hits: {
    t: number
    actor: CharacterKey
    element: SimHit['element']
    durability?: number
  }[]
) {
  const members: CharacterKey[] = ['Mona', 'Fischl', 'Sucrose']
  const probe: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act(c) {
      for (const h of hits)
        c.hit(h.t, {
          characterKey: h.actor,
          path: ['skill', '0'],
          tag: 'skill',
          element: h.element,
          applies: true,
          icd: 'none',
          durability: h.durability ?? 25,
          label: 'Aura probe',
        })
      return { frames: 1 }
    },
  }
  return simulateRotation({
    rotation: parseRotation(
      'Mona E W2',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Mona: 'hydro', Fischl: 'electro', Sucrose: 'anemo' },
    repeats: 1,
    keep: 'all',
    kits: {
      Mona: probe,
      Fischl: { ...probe, characterKey: 'Fischl', element: 'electro' },
      Sucrose: { ...probe, characterKey: 'Sucrose', element: 'anemo' },
    },
  }).hits.filter((h) => h.path.join('.') === 'reaction.electrocharged')
}

it('keeps the queued Electro-Charged owner and snapshots until the next tick uses the refreshed owner', () => {
  const hits = ecProbe([
    { t: 0, actor: 'Mona', element: 'hydro' },
    { t: 1, actor: 'Fischl', element: 'electro' },
    { t: 5, actor: 'Mona', element: 'hydro' },
  ])
  expect(hits.map((h) => [h.t, h.characterKey])).toEqual([
    [11, 'Fischl'],
    [71, 'Mona'],
  ])
  expect(hits.map((h) => h.statSnapshots?.[0].t)).toEqual([1, 5])
})

it('applies Electro-Charged damage ICD to rapid restarts without consuming aura for the suppressed hit', () => {
  const hits = ecProbe([
    { t: 0, actor: 'Mona', element: 'hydro' },
    { t: 1, actor: 'Fischl', element: 'electro' },
    { t: 12, actor: 'Sucrose', element: 'anemo', durability: 200 },
    { t: 13, actor: 'Mona', element: 'hydro', durability: 50 },
    { t: 14, actor: 'Fischl', element: 'electro', durability: 50 },
  ])
  expect(hits.map((h) => h.t)).toEqual([11, 84])
  expect(hits.map((h) => h.statSnapshots?.[0].t)).toEqual([1, 14])
})

describe('rotation reactions', () => {
  const hutao = run(
    ['HuTao', 'Xingqiu', 'Yelan', 'Zhongli'],
    'Zhongli hE -> Xingqiu E Q -> Yelan E Q -> HuTao E N1 CA N1 CA N1 CA N1 CA N1 CA N1 CA N1 CA Q -> Zhongli',
    { Xingqiu: 6 }
  )
  it('double Hydro: Hu Tao charged attacks vaporize (PoleExtraAttack ICD)', () => {
    const ca = hitsOf(hutao, 'HuTao', /Charged/)
    expect(ca.length).toBe(7)
    expect(
      ca.filter((h) => h.reaction === 'vaporize').length
    ).toBeGreaterThanOrEqual(6)
  })
  it("Raincutter and Exquisite Throw fire on Hu Tao's normal attacks", () => {
    expect(hitsOf(hutao, 'Xingqiu', /Raincutter/).length).toBeGreaterThan(10)
    expect(hitsOf(hutao, 'Yelan', /Exquisite/).length).toBeGreaterThan(10)
  })
  it("Thoma's Fiery Collapse fires on the active character's normal attacks", () => {
    const sim = run(
      ['Thoma', 'Keqing', 'Xingqiu', 'Zhongli'],
      'Zhongli hE -> Thoma E Q -> Keqing N3 N3 N3 -> Zhongli'
    )
    expect(
      hitsOf(sim, 'Thoma', /Fiery Collapse/).length
    ).toBeGreaterThanOrEqual(3)
  })
  it("Fischl C6: Oz attacks with the active character's normal attacks", () => {
    const sim = run(
      ['Fischl', 'Keqing', 'Xingqiu', 'Zhongli'],
      'Fischl E -> Keqing N3 N3 N3 -> Fischl',
      { Fischl: 6 }
    )
    expect(hitsOf(sim, 'Fischl', /C6/).length).toBeGreaterThanOrEqual(3)
  })
  it('Bennett C6 infuses the active melee member with Pyro', () => {
    const sim = run(
      ['Bennett', 'Keqing', 'Xingqiu', 'Zhongli'],
      'Bennett Q -> Keqing N3 N3 -> Bennett',
      { Bennett: 6 }
    )
    // (her hits while on the field: a string's last hit can land after the swap)
    const entry = sim.actions.find((a) => a.characterKey === 'Keqing')!.start
    const n = hitsOf(sim, 'Keqing', /^N\d/).filter(
      (h) => h.onField === 'Keqing' && h.t >= entry
    )
    expect(n.length).toBeGreaterThan(0)
    // Physical until the field's first tick infuses her, Pyro from then on
    const first = n.findIndex((h) => h.element === 'pyro')
    expect(first).toBeGreaterThan(0)
    expect(n.slice(0, first).every((h) => h.element === 'physical')).toBe(true)
    expect(n.slice(first).every((h) => h.element === 'pyro')).toBe(true)
  })
})
