/**
 * Computes the "computed build" shown on character landing pages (apps/frontend/seo-builds.json):
 * artifact set ranking, main stats, substat priority and weapon ranking for one stated scenario per
 * character (tools/seo-builds/scenarios.ts).
 *
 * It uses the same path as the Theorycraft tab: KQM Standards substats (2 rolls of every substat plus
 * 20 rolls placed by `optimizeTcUsingNodes`), `getBuildTcArtifactData`, `getTeamDataCalc`. Main stats
 * are first screened cheaply (as dynamic stats, rolls placed greedily), then the best few are solved
 * exactly.
 *
 * Run (one heavy task at a time):
 *   SEO_BUILDS=1 npx vitest run --config tools/seo-builds/vitest.config.mts generate
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { objPathValue } from '@genshin-optimizer/common/util'
import {
  allArtifactSetKeys,
  allMainSubStatKeys,
  allSubstatKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import type { BuildTc } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharSheet } from '@genshin-optimizer/gi/sheets'
import { optimizeTcUsingNodes } from '@genshin-optimizer/gi/solver-tc'
import {
  getArtSetStat,
  getCharEle,
  getCharStat,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import {
  getBuildTcArtifactData,
  getBuildTcWeaponData,
  getTeamDataCalc,
} from '@genshin-optimizer/gi/ui'
import { getMainStatValue, getSubstatValue } from '@genshin-optimizer/gi/util'
import {
  constant,
  dynamicData,
  mergeData,
  optimize,
  percent,
  precompute,
  sum,
} from '@genshin-optimizer/gi/wr'
import { CYCLES, itemConditionals, PARTY, REFINEMENTS } from './conditionals'
import { type Scenario, scenarios } from './scenarios'

const OUT = resolve(__dirname, '../../apps/frontend/seo-builds.json')
const ROLLS = 20 // KQM Standards: 20 rolls to place on top of 2 of every substat
const EXACT = 4 // main stat combinations solved exactly per configuration

type Mains = { sands: string; goblet: string; circlet: string }
type SetCombo = Record<string, number>
type Result = { value: number; mains: Mains; rolls: Record<string, number> }

const SANDS = ['atk_', 'hp_', 'def_', 'eleMas', 'enerRech_']
const GOBLET_BASE = ['atk_', 'hp_', 'def_', 'eleMas', 'physical_dmg_']
const CIRCLET = [
  'critRate_',
  'critDMG_',
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'heal_',
]

function run(sc: Scenario) {
  const charKey = sc.charKey as any
  const { weaponType } = getCharStat(charKey) as any
  const ele = getCharEle(charKey)
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set(charKey, {
    key: charKey,
    level: 90,
    ascension: 6,
    talent: { auto: 9, skill: 9, burst: 9 },
    constellation: 0,
  } as any)
  const quick = !!process.env['SEO_BUILDS_QUICK']
  const weapons = (allWeaponKeys as readonly string[])
    .filter((w) => {
      const s = getWeaponStat(w as any) as any
      return s.weaponType === weaponType && s.rarity >= 4
    })
    .slice(0, quick ? 3 : undefined)
  if (quick) {
    // the character's own conditional states, to check the scenario's values against
    const sheet = getCharSheet(charKey, 'F') as any
    for (const tk of [
      'auto',
      'skill',
      'burst',
      'passive1',
      'passive2',
      'passive3',
      'constellation1',
      'constellation2',
    ]) {
      for (const d of sheet?.getTalentOfKey?.(tk)?.sections ?? [])
        if (d?.states && d?.path)
          console.log(
            `  cond ${d.path.join('.')}: ${Object.keys(d.states).join(',')}`
          )
    }
  }
  db.weapons.new({
    key: weapons[0] as any,
    level: 90,
    ascension: 6,
    refinement: 1,
    location: charKey,
    lock: true,
  })
  const { conditional: itemConds, picked } = itemConditionals(sc.ctx)
  const conditional = { ...itemConds, ...sc.conditional }
  const teamCharId = db.teamChars.new(charKey, {
    conditional,
    hitMode: 'avgHit',
    reaction: undefined,
  } as any)
  const teamId = db.teams.new({ loadoutData: [{ teamCharId }] } as any)

  const fixedSubs = Object.fromEntries(
    allSubstatKeys.map((k) => [k, 2 * getSubstatValue(k, 5, 'mid')])
  ) // percent units, like the KQMS button
  const rollValue = (k: string) => getSubstatValue(k as any, 5, 'mid', false)
  // a weapon id is its key, or "key@refinement" for the extra refinements in REFINEMENTS
  const weaponIds = weapons.flatMap(
    (w) => REFINEMENTS[w]?.map((r) => `${w}@${r}`) ?? [w]
  )
  const parseWeapon = (id: string) => {
    const [key, r] = id.split('@')
    const rarity: number = (getWeaponStat(key as any) as any).rarity
    return { key, rarity, refinement: r ? Number(r) : rarity === 5 ? 1 : 5 }
  }
  const weaponOf = (id: string) => {
    const { key, refinement } = parseWeapon(id)
    return { key, level: 90, ascension: 6, refinement }
  }
  /** Party-counting passives that the sheet can't see in a solo team, as bonus stats (PARTY) */
  let bonusFor: string | undefined
  const applyPartyBonus = (id: string) => {
    if (bonusFor === id) return
    const { key, refinement } = parseWeapon(id)
    db.teamChars.set(teamCharId, {
      bonusStats: PARTY[key]?.bonus?.(refinement) ?? {},
    } as any)
    bonusFor = id
  }
  const slotMains = (m: Mains) => ['hp', 'atk', m.sands, m.goblet, m.circlet]
  const caps = (m: Mains) =>
    Object.fromEntries(
      allSubstatKeys.map((k) => [
        k,
        (5 - slotMains(m).filter((s) => s === k).length) * 2,
      ])
    )

  // Optimization target nodes for one team data (same as optimizeNodesForScaling, with a summed target)
  function targetNodes(teamData: any) {
    const workerData = teamData[charKey]?.target.data[0]
    const display = workerData.display
    const paths = Array.isArray(sc.targets)
      ? sc.targets
      : Object.keys(display[sc.targets.talent] ?? {})
          .filter((k) => (sc.targets as any).match.test(k))
          .map((k) => [(sc.targets as any).talent, k])
    const parts = paths.map((p) => objPathValue(display, p))
    if (!parts.length || parts.some((p) => !p))
      throw new Error(`${charKey}: target missing ${JSON.stringify(paths)}`)
    Object.assign(workerData, mergeData([workerData, dynamicData]))
    const nodes = optimize(
      [parts.length === 1 ? parts[0] : sum(...parts)],
      workerData,
      ({ path: [p, stat] }) =>
        p !== 'dyn' || !allMainSubStatKeys.includes(stat as any)
    )
    return { nodes, paths }
  }
  function computeOf(nodes: any) {
    const scales = new Set<string>()
    const f = precompute(
      nodes,
      {},
      (r) => (scales.add(r.path[1]), r.path[1]),
      1
    )
    return {
      f: (values: Record<string, number>) => f([{ values }] as any)[0],
      scales,
    }
  }

  // Screening: main stats as dynamic stats, flower/plume and the fixed substats as artifact stats
  function screen(weapon: string, sets: SetCombo, mainsList: Mains[]) {
    applyPartyBonus(weapon)
    const art: Record<string, number> = {}
    for (const [k, v] of Object.entries(fixedSubs))
      art[k] = k.endsWith('_') ? v / 100 : v
    art.hp += getMainStatValue('hp', 5, 20)
    art.atk += getMainStatValue('atk', 5, 20)
    const overrideArt = {
      art: Object.fromEntries(
        Object.entries(art).map(([k, v]) => [
          k,
          k.endsWith('_') ? percent(v) : constant(v),
        ])
      ),
      artSet: Object.fromEntries(
        Object.entries(sets).map(([k, v]) => [k, constant(v)])
      ),
    }
    const teamData = getTeamDataCalc(
      db,
      teamId,
      'F',
      teamCharId,
      0,
      overrideArt as any,
      { id: '', location: '', lock: false, ...weaponOf(weapon) } as any
    )
    const { nodes } = targetNodes(teamData)
    const { f, scales } = computeOf(nodes)
    const scored = mainsList
      .filter((m) => [m.sands, m.goblet, m.circlet].every((k) => scales.has(k)))
      .map((m) => {
        const values: Record<string, number> = {}
        for (const k of [m.sands, m.goblet, m.circlet])
          values[k] = (values[k] ?? 0) + getMainStatValue(k as any, 5, 20)
        const cap = caps(m)
        const subs = allSubstatKeys.filter((k) => scales.has(k) && cap[k] > 0)
        const rolls: Record<string, number> = {}
        for (let i = 0; i < ROLLS; i++) {
          let best = '',
            bestV = Number.NEGATIVE_INFINITY
          for (const k of subs) {
            if ((rolls[k] ?? 0) >= cap[k]) continue
            const v = f({ ...values, [k]: (values[k] ?? 0) + rollValue(k) })
            if (v > bestV) (best = k), (bestV = v)
          }
          if (!best) break
          values[best] = (values[best] ?? 0) + rollValue(best)
          rolls[best] = (rolls[best] ?? 0) + 1
        }
        return { mains: m, value: f(values) }
      })
      .sort((a, b) => b.value - a.value)
      // main stat values don't depend on the slot: ATK% sands + EM goblet == EM sands + ATK% goblet
      .filter(
        (s, i, all) =>
          all.findIndex((o) => mainsId(o.mains) === mainsId(s.mains)) === i
      )
    return { scored, scales }
  }

  // Exact: the Theorycraft tab's own solver on a KQMS build with the main stats in place
  function exact(weapon: string, sets: SetCombo, mains: Mains): Result {
    applyPartyBonus(weapon)
    const buildTc = {
      artifact: {
        slots: {
          flower: { level: 20, rarity: 5, statKey: 'hp' },
          plume: { level: 20, rarity: 5, statKey: 'atk' },
          sands: { level: 20, rarity: 5, statKey: mains.sands },
          goblet: { level: 20, rarity: 5, statKey: mains.goblet },
          circlet: { level: 20, rarity: 5, statKey: mains.circlet },
        },
        substats: { type: 'mid', rarity: 5, stats: { ...fixedSubs } },
        sets,
      },
      weapon: weaponOf(weapon),
      optimization: {
        distributedSubstats: ROLLS,
        maxSubstats: Object.fromEntries(
          Object.entries(caps(mains)).map(([k, v]) => [k, v + 2])
        ),
      },
    } as unknown as BuildTc
    const teamData = getTeamDataCalc(
      db,
      teamId,
      'F',
      teamCharId,
      0,
      getBuildTcArtifactData(buildTc),
      getBuildTcWeaponData(buildTc)
    )
    const { nodes } = targetNodes(teamData)
    let rolls: Record<string, number> = {}
    let buffer: Record<string, number> = {}
    optimizeTcUsingNodes(nodes as any, [], buildTc, (r) => {
      if (r.resultType !== 'finalize') return
      buffer = r.maxBuffer as any
      rolls = Object.fromEntries(
        Object.entries(r.maxBufferRolls).filter(([k, v]) => k !== 'other' && v)
      ) as any
    })
    return { value: computeOf(nodes).f(buffer), mains, rolls }
  }

  const goblets = [`${ele}_dmg_`, ...GOBLET_BASE]
  const allMains: Mains[] = SANDS.flatMap((sands) =>
    goblets.flatMap((goblet) =>
      CIRCLET.map((circlet) => ({ sands, goblet, circlet }))
    )
  )
  function best(weapon: string, sets: SetCombo): Result {
    const { scored } = screen(weapon, sets, allMains)
    return scored
      .slice(0, EXACT)
      .map((s) => exact(weapon, sets, s.mains))
      .sort((a, b) => b.value - a.value)[0]
  }

  const fiveStarSets = (allArtifactSetKeys as readonly string[])
    .filter((k) => (getArtSetStat(k as any) as any)?.rarities?.includes(5))
    .filter(
      (k, i) =>
        !quick || i < 3 || k === 'GladiatorsFinale' || k === 'ThunderingFury'
    )
  /** Runs `fn` with extra conditional values on the team character */
  function withConds<T>(
    extra: Record<string, Record<string, string>>,
    fn: () => T
  ): T {
    db.teamChars.set(teamCharId, {
      conditional: { ...conditional, ...extra },
    } as any)
    try {
      return fn()
    } finally {
      db.teamChars.set(teamCharId, { conditional } as any)
    }
  }
  function rankWeapons(sets: SetCombo) {
    return weaponIds
      .map((id) => {
        const { key, rarity, refinement } = parseWeapon(id)
        const cycle = CYCLES[key]
        if (!cycle)
          return {
            id,
            key,
            rarity,
            refinement,
            cycled: false,
            ...best(id, sets),
          }
        // average over the cycle; show the build of the state closest to that average
        const results = cycle.map((v) =>
          withConds({ [key]: v }, () => best(id, sets))
        )
        const value = results.reduce((a, r) => a + r.value, 0) / results.length
        const pick = results.reduce((a, b) =>
          Math.abs(b.value - value) < Math.abs(a.value - value) ? b : a
        )
        return { id, key, rarity, refinement, cycled: true, ...pick, value }
      })
      .sort((a, b) => b.value - a.value)
      .map((r) => {
        if (process.env['SEO_BUILDS_DEBUG'])
          console.log(
            `  ${r.id}: ${r.value.toFixed(3)} ${JSON.stringify(r.mains)} ${JSON.stringify(r.rolls)}`
          )
        return r
      })
  }
  function rankSets(weapon: string) {
    // 2-piece screening picks the stat 2-pieces for the 2+2 combinations. Sets with the same
    // 2-piece bonus score the same; keep the best-known one of each.
    const two = fiveStarSets
      .map((k) => ({
        k,
        v: screen(weapon, { [k]: 2 }, allMains).scored[0]?.value ?? 0,
      }))
      .sort((a, b) => b.v - a.v || pref(a.k) - pref(b.k))
      .filter(
        (x, i, all) =>
          all.findIndex((o) => Math.abs(o.v - x.v) <= 1e-9 * x.v) === i
      )
      .slice(0, 4)
      .map((x) => x.k)
    const combos: SetCombo[] = [
      ...fiveStarSets.map((k) => ({ [k]: 4 })),
      ...two.flatMap((a, i) =>
        two.slice(i + 1).map((b) => ({ [a]: 2, [b]: 2 }))
      ),
    ]
    return combos
      .map((sets) => ({ sets, ...best(weapon, sets) }))
      .sort((a, b) => b.value - a.value)
      .filter(
        (x, i, all) =>
          all.findIndex(
            (o) => Math.abs(o.value - x.value) <= 1e-9 * x.value
          ) === i
      )
  }

  const t0 = Date.now()
  const log = (s: string) =>
    console.log(`[${charKey} ${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
  // Start from a neutral 2+2, then alternate weapon and set until both settle
  const twoPieceEle = fiveStarSets.find(
    (k) => getArtSheetStat2(k) === `${ele}_dmg_`
  )
  let sets: SetCombo = twoPieceEle
    ? { GladiatorsFinale: 2, [twoPieceEle]: 2 }
    : { GladiatorsFinale: 2 }
  let weaponRank = rankWeapons(sets)
  log(
    `weapons (neutral 2+2): ${weaponRank
      .slice(0, 3)
      .map((w) => w.key)
      .join(', ')}`
  )
  let setRank = rankSets(weaponRank[0].id)
  log(
    `sets: ${setRank
      .slice(0, 3)
      .map((s) => JSON.stringify(s.sets))
      .join(', ')}`
  )
  for (let i = 0; i < 2; i++) {
    sets = setRank[0].sets
    const prevWeapon = weaponRank[0].id
    weaponRank = rankWeapons(sets)
    log(
      `weapons: ${weaponRank
        .slice(0, 3)
        .map((w) => w.key)
        .join(', ')}`
    )
    if (weaponRank[0].id === prevWeapon) break
    setRank = rankSets(weaponRank[0].id)
    log(
      `sets: ${setRank
        .slice(0, 3)
        .map((s) => JSON.stringify(s.sets))
        .join(', ')}`
    )
  }

  const top = setRank[0]
  const weapon = weaponRank[0].id
  // Main stat options for the final build, each solved exactly
  const { scored, scales } = screen(weapon, top.sets, allMains)
  const mainsRank = scored
    .slice(0, 6)
    .map((s) => exact(weapon, top.sets, s.mains))
    .sort((a, b) => b.value - a.value)
  const bestValue = mainsRank[0].value
  const rel = (v: number) => Math.round((v / bestValue) * 1000) / 10
  applyPartyBonus(weapon)
  const { paths } = targetNodes(
    getTeamDataCalc(
      db,
      teamId,
      'F',
      teamCharId,
      0,
      { art: {}, artSet: {} } as any,
      { id: '', location: '', lock: false, ...weaponOf(weapon) } as any
    )
  )
  log(
    `done: best ${JSON.stringify(top.sets)} + ${weapon}, ${bestValue.toFixed(0)}`
  )
  return {
    charKey,
    ...(sc.variant ? { variant: sc.variant } : {}),
    label: sc.label,
    target: sc.target,
    targetPaths: paths.map((p) => p.join('.')),
    weapon,
    sets: setRank
      .slice(0, 15)
      .map((s) => ({ sets: s.sets, rel: rel(s.value), mains: s.mains })),
    mains: mainsRank.slice(0, 4).map((m) => ({
      ...m.mains,
      rel: rel(m.value),
      // e.g. ATK% sands + EM goblet is the same build as EM sands + ATK% goblet
      swappable:
        m.mains.sands !== m.mains.goblet &&
        SANDS.includes(m.mains.goblet) &&
        goblets.includes(m.mains.sands),
    })),
    rolls: Object.entries(mainsRank[0].rolls)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k, rolls: n })),
    // the top 15, plus every weapon listed in REFINEMENTS wherever it ranks
    weapons: weaponRank
      .filter((w, i) => i < 15 || REFINEMENTS[w.key])
      .map((w) => ({
        key: w.key,
        rarity: w.rarity,
        refinement: w.refinement,
        rel: Math.round((w.value / weaponRank[0].value) * 1000) / 10,
        ...(w.cycled ? { cycled: true } : {}),
        ...(REFINEMENTS[w.key] ? { pinned: true } : {}),
        ...(PARTY[w.key] ? { note: PARTY[w.key].note(w.refinement) } : {}),
      })),
    scalesWith: [...scales].filter((k) =>
      allMainSubStatKeys.includes(k as any)
    ),
    value: Math.round(bestValue),
    itemConditionals: picked,
  }
}

/** Same main stats in any slot order */
const mainsId = (m: Mains) => [m.sands, m.goblet, m.circlet].sort().join('+')

/** Among sets with the same 2-piece bonus, the one players know best is shown */
const WELL_KNOWN_2PC = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'ThunderingFury',
  'BlizzardStrayer',
  'EmblemOfSeveredFate',
  'ShimenawasReminiscence',
  'GildedDreams',
]
const pref = (k: string) => {
  const i = WELL_KNOWN_2PC.indexOf(k)
  return i < 0 ? WELL_KNOWN_2PC.length : i
}

/** The stat a set's 2-piece gives, for picking the neutral starting 2+2 */
function getArtSheetStat2(setKey: string): string | undefined {
  const stat2: Record<string, string> = {
    ThunderingFury: 'electro_dmg_',
    BlizzardStrayer: 'cryo_dmg_',
    CrimsonWitchOfFlames: 'pyro_dmg_',
    NymphsDream: 'hydro_dmg_',
    ViridescentVenerer: 'anemo_dmg_',
    ArchaicPetra: 'geo_dmg_',
    DeepwoodMemories: 'dendro_dmg_',
  }
  return stat2[setKey]
}

describe.runIf(process.env['SEO_BUILDS'])('seo builds', () => {
  it('computes and writes apps/frontend/seo-builds.json', () => {
    const only = process.env['SEO_BUILDS_ONLY']?.split(',')
    const out: Record<string, unknown> = {
      generated: new Date().toISOString().slice(0, 10),
      assumptions: {
        level: 90,
        talents: '9/9/9',
        constellation: 0,
        artifacts:
          '5★ +20, KQM Standards substats (2 rolls of each substat, 20 more placed by the optimizer)',
        weapons: '5★ at R1, 4★ at R5, level 90',
        enemy: 'level 100, 10% RES, no DEF reduction',
        team: 'solo; set and weapon effects the character can trigger alone are at full stacks',
        energy: 'no Energy Recharge requirement',
      },
      // one or more builds per character (one per scenario); a run limited to some characters
      // keeps the others' results
      characters:
        only && existsSync(OUT)
          ? JSON.parse(readFileSync(OUT, 'utf8')).characters
          : {},
    }
    const characters = out.characters as Record<string, unknown[]>
    for (const key of new Set(scenarios.map((sc) => sc.charKey))) {
      if (only && !only.includes(key)) continue
      characters[key] = scenarios.filter((sc) => sc.charKey === key).map(run)
    }
    // a quick (partial) run never replaces the real data
    const file = process.env['SEO_BUILDS_QUICK'] ? `${OUT}.quick` : OUT
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
    console.log(`wrote ${file}`)
  })
})
