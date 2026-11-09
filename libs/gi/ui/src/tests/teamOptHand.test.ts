/**
 * Team Optimize against damage worked out by hand. Transformative reactions follow a published
 * formula with nothing hidden (no CRIT, no talent multiplier, DEF almost ignored), so a team's
 * damage, its DPS and its best artifacts and weapons can be found on paper, then compared with
 * what the engine computes and what the optimizer picks:
 *
 *   hit = 1446.8535 (level 90) × reaction (Overloaded 2.75, Swirl 0.6)
 *         × (1 + 16·EM / (EM + 2000) + bonus) × RES multiplier × DEF factor
 *   RES multiplier: 1 − RES, or 1 − RES/2 below 0 (Viridescent Venerer: 10% − 40% = −30% → 1.15)
 *   DEF factor: 99999999 / (99999999 + 5 × 100 + 500) for a level 100 enemy (≈ 0.99999), which
 *   the app applies to every transformative hit but Swirl (in game none of them has DEF: the
 *   0.001% is the app's; the tests follow it)
 *
 * Stats used: an EM main stat at +20 is 186.5, Xiangling's ascension EM at 90 is 96, Dragon's
 * Bane's EM at 90 is 220.512. Fillers only have HP, ATK and DEF, which these hits ignore.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type {
  ICachedArtifact,
  LoadoutDatum,
  TeamOpt,
  TeamOptAttack,
} from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { transformativeReactionLevelMultipliers } from '@genshin-optimizer/gi/keymap'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { precompute } from '@genshin-optimizer/gi/wr'
import type { TeamOptResult, TeamOptSolver } from '../'
import {
  evaluateTeamRotation,
  optimizeTeam,
  teamOptArtValues,
  teamOptBonusStats,
  teamSensitivity,
} from '../'

// ---------- the formula, by hand ----------
const LEVEL_90 = 1446.8535
const OVERLOADED = 2.75
const SWIRL = 0.6
const EM_MAIN = 186.5
const XIANGLING_EM = 96
const DRAGONS_BANE_EM = 220.512
const DEF = 99999999 / (99999999 + 5 * 100 + 500)
const resMulti = (res: number) =>
  res < 0 ? 1 - res / 2 : res >= 0.75 ? 1 / (4 * res + 1) : 1 - res
const emBonus = (em: number) => (16 * em) / (em + 2000)
/** One transformative hit, by hand (enemy RES 10% unless said otherwise) */
const hit = (
  reaction: number,
  em: number,
  { bonus = 0, res = 0.1, def = reaction !== SWIRL } = {}
) =>
  LEVEL_90 *
  reaction *
  (1 + emBonus(em) + bonus) *
  resMulti(res) *
  (def ? DEF : 1)

/** Equal to a hand-computed value, up to floating point */
const expectNear = (value: number, expected: number) =>
  expect(Math.abs(value / expected - 1)).toBeLessThan(1e-9)

// ---------- teams ----------
const fischl: CharacterKey = 'Fischl'
const xiangling: CharacterKey = 'Xiangling'
const sucrose: CharacterKey = 'Sucrose'
const raiden: CharacterKey = 'RaidenShogun'

type Piece = {
  set: ArtifactSetKey
  slot: ArtifactSlotKey
  main: MainStatKey
  /** Who wears it at the start ('' : nobody) */
  at: CharacterKey | ''
}
const fixedMain: Partial<Record<ArtifactSlotKey, MainStatKey>> = {
  flower: 'hp',
  plume: 'atk',
}
/** Substats that no transformative hit reads (4, none of them the main stat) */
function fillerSubstats(main: MainStatKey) {
  const all: { key: SubstatKey; value: number }[] = [
    { key: 'def', value: 23 },
    { key: 'hp', value: 299 },
    { key: 'atk', value: 19 },
    { key: 'hp_', value: 5.8 },
    { key: 'def_', value: 7.3 },
  ]
  return all.filter((s) => s.key !== main).slice(0, 4)
}

function team(
  roster: { key: CharacterKey; weapon: WeaponKey }[],
  pieces: Piece[],
  spareWeapons: WeaponKey[] = []
) {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  const teamCharIds: Partial<Record<CharacterKey, string>> = {}
  for (const { key, weapon } of roster) {
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
      constellation: 0,
    })
    database.weapons.new({
      key: weapon,
      level: 90,
      ascension: 6,
      refinement: 1,
      location: key,
      lock: false,
    })
    teamCharIds[key] = database.teamChars.new(key, {})
  }
  const weaponIds: Partial<Record<WeaponKey, string>> = {}
  for (const key of spareWeapons)
    weaponIds[key] = database.weapons.new({
      key,
      level: 90,
      ascension: 6,
      refinement: 1,
      location: '',
      lock: false,
    })
  const artIds = pieces.map(({ set, slot, main, at }) => {
    const mainStatKey = fixedMain[slot] ?? main
    const id = database.arts.new({
      setKey: set,
      slotKey: slot,
      level: 20,
      rarity: 5,
      mainStatKey,
      location: at,
      lock: false,
      substats: fillerSubstats(mainStatKey),
    })
    expect(database.arts.get(id)).toBeTruthy()
    return id
  })
  const teamId = database.teams.new({
    loadoutData: roster.map(({ key }) => ({
      teamCharId: teamCharIds[key],
    })) as LoadoutDatum[],
    // a level 100 enemy (else it has the characters' level)
    enemyOverride: { enemyLevel: 100 },
  } as never)
  return { database, teamId, teamCharIds, artIds, weaponIds }
}

const overloaded = (hits: number): TeamOptAttack => ({
  path: ['reaction', 'overloaded'],
  hits,
  hitMode: 'avgHit',
})
const pyroSwirl = (hits: number): TeamOptAttack => ({
  path: ['reaction', 'pyroSwirl'],
  hits,
  hitMode: 'avgHit',
})

/** Every build of the pool, for the best one: small pools only */
function evalAt(nodes: OptNode[], arts: ICachedArtifact[]): number[] {
  const compute = precompute(nodes, {}, (r) => r.path[1], arts.length)
  return compute(arts.map((a) => ({ values: teamOptArtValues(a, 0) })) as never)
}
const bruteForce: TeamOptSolver = async ({ arts, objective, constraints }) => {
  const bySlot = allArtifactSlotKeys.map((s) =>
    arts.filter((a) => a.slotKey === s)
  )
  const nodes = [objective, ...constraints.map((c) => c.value)]
  let best: { value: number; artifactIds: string[] } | undefined
  const rec = (i: number, picked: ICachedArtifact[]) => {
    if (i === bySlot.length) {
      const [value, ...cons] = evalAt(nodes, picked)
      if (constraints.some((c, j) => !(cons[j] >= c.min))) return
      if (!best || value > best.value)
        best = { value, artifactIds: picked.map((a) => a.id) }
      return
    }
    for (const art of bySlot[i]) rec(i + 1, [...picked, art])
  }
  rec(0, [])
  return best
}

const run = (
  database: ArtCharDatabase,
  teamId: string,
  teamOpt: TeamOpt
): Promise<TeamOptResult> =>
  optimizeTeam({
    database,
    teamId,
    gender: 'F',
    teamOpt,
    solve: bruteForce,
  }) as Promise<TeamOptResult>

/** The pieces of a member's build with an EM main stat */
const emPieces = (
  database: ArtCharDatabase,
  result: TeamOptResult,
  characterKey: CharacterKey
) =>
  Object.values(result.builds[characterKey] ?? {}).filter(
    (id) => id && database.arts.get(id)?.mainStatKey === 'eleMas'
  ).length

// ---------- Team 1: Fischl + Xiangling, Overloaded, three EM pieces to share ----------
/**
 * One EM sands, goblet and circlet (186.5 each), the rest fillers; both deal 4 Overloaded per
 * 20 s rotation. With k EM pieces on Fischl (3 − k on Xiangling, who has 96 EM of her own):
 *
 *   k   Fischl EM   Xiangling EM   1 + bonus (F)   1 + bonus (X)   sum        damage   DPS
 *   0       0          655.5          1.000000        4.949539     5.949539   85,219   4,261
 *   1     186.5        469.0          2.364738        4.039287     6.404025   91,729   4,586
 *   2     373.0        282.5          3.514960        2.980285     6.495245   93,036   4,652  ← best
 *   3     559.5         96.0          4.497558        1.732824     6.230383   89,242   4,462
 *
 * Damage = 4 × 1446.8535 × 2.75 × 0.9 × 0.99999 × sum = 14,323.71 × sum. All on Xiangling (the
 * bigger damage dealer, optimized first) is the worst split: only an exchange between the two
 * finds the best.
 */
function overloadTeam() {
  const g: ArtifactSetKey = 'GladiatorsFinale'
  return team(
    [
      { key: fischl, weapon: 'Slingshot' },
      { key: xiangling, weapon: 'WhiteTassel' },
    ],
    [
      { set: g, slot: 'flower', main: 'hp', at: fischl },
      { set: g, slot: 'flower', main: 'hp', at: xiangling },
      { set: g, slot: 'plume', main: 'atk', at: fischl },
      { set: g, slot: 'plume', main: 'atk', at: xiangling },
      { set: g, slot: 'sands', main: 'hp_', at: fischl },
      { set: g, slot: 'sands', main: 'eleMas', at: xiangling },
      { set: g, slot: 'goblet', main: 'def_', at: fischl },
      { set: g, slot: 'goblet', main: 'eleMas', at: xiangling },
      { set: g, slot: 'circlet', main: 'hp_', at: fischl },
      { set: g, slot: 'circlet', main: 'eleMas', at: xiangling },
    ]
  )
}
const overloadTotal = (k: number, extraEm = 0) =>
  4 * hit(OVERLOADED, EM_MAIN * k + extraEm) +
  4 * hit(OVERLOADED, XIANGLING_EM + EM_MAIN * (3 - k) + extraEm)

describe('hand-checked team: Fischl + Xiangling (Overloaded)', () => {
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    attacks: { [fischl]: [overloaded(4)], [xiangling]: [overloaded(4)] },
    rotationTime: 20,
  }

  it('computes the rotation as worked out by hand', () => {
    const { database, teamId } = overloadTeam()
    const evaluation = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks: teamOpt.attacks,
    })!
    // at the start, Xiangling wears all three EM pieces (k = 0)
    expectNear(evaluation.members[fischl]!, 4 * hit(OVERLOADED, 0))
    expectNear(
      evaluation.members[xiangling]!,
      4 * hit(OVERLOADED, XIANGLING_EM + 3 * EM_MAIN)
    )
    expectNear(evaluation.total, overloadTotal(0))
    // the worked example: 14,323.71 × 5.949539 = 85,219.45 per rotation
    expect(overloadTotal(0)).toBeCloseTo(85219.45, 1)
  })

  it('splits the EM pieces the way that deals the most (2 to Fischl, 1 to Xiangling)', async () => {
    const { database, teamId } = overloadTeam()
    const totals = [0, 1, 2, 3].map((k) => overloadTotal(k))
    expect(Math.max(...totals)).toBe(totals[2])
    const result = await run(database, teamId, teamOpt)
    expect(emPieces(database, result, fischl)).toBe(2)
    expect(emPieces(database, result, xiangling)).toBe(1)
    expectNear(result.after.total, totals[2])
    // as DPS: 20 s rotations
    expectNear(result.after.total / teamOpt.rotationTime!, totals[2] / 20)
    expect(result.after.total / 20).toBeCloseTo(4651.8, 1)
    // no piece in two builds
    const ids = [fischl, xiangling].flatMap((ck) =>
      Object.values(result.builds[ck]!)
    )
    expect(new Set(ids).size).toBe(10)
  })

  it('leaves a kept member’s build as it is', async () => {
    const { database, teamId } = overloadTeam()
    const result = await run(database, teamId, {
      ...teamOpt,
      keep: [xiangling],
    })
    // Xiangling keeps all three: Fischl cannot do better than fillers
    expect(emPieces(database, result, xiangling)).toBe(3)
    expect(emPieces(database, result, fischl)).toBe(0)
    expectNear(result.after.total, overloadTotal(0))
  })

  it('meets a requirement, at the cost the hand table shows', async () => {
    const { database, teamId, teamCharIds } = overloadTeam()
    // Xiangling needs 400 EM: two EM pieces (96 + 373 = 469), one is not enough (282.5)
    database.optConfigs.set(
      database.teamChars.get(teamCharIds[xiangling]!)!.optConfigId,
      {
        statFilters: {
          [JSON.stringify(['basic', 'eleMas'])]: [
            { value: 400, disabled: false },
          ],
        },
      }
    )
    const result = await run(database, teamId, teamOpt)
    expect(emPieces(database, result, xiangling)).toBe(2)
    expect(emPieces(database, result, fischl)).toBe(1)
    expectNear(result.after.total, overloadTotal(1))
    expect(result.after.unmet[xiangling]).toBeUndefined()
  })

  it('flags a requirement no build meets, and still fills every slot', async () => {
    const { database, teamId, teamCharIds } = overloadTeam()
    database.optConfigs.set(
      database.teamChars.get(teamCharIds[xiangling]!)!.optConfigId,
      {
        statFilters: {
          [JSON.stringify(['basic', 'eleMas'])]: [
            { value: 5000, disabled: false },
          ],
        },
      }
    )
    const result = await run(database, teamId, teamOpt)
    expect(result.after.unmet[xiangling]?.length).toBe(1)
    for (const ck of [fischl, xiangling])
      expect(Object.values(result.builds[ck]!).every(Boolean)).toBe(true)
  })

  it('counts fractional hits, extra buffs and an attack’s own stats by hand', () => {
    const { database, teamId } = overloadTeam()
    const evaluate = (
      attacks: TeamOpt['attacks'],
      bonusStats?: TeamOpt['bonusStats']
    ) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts: {},
        attacks,
        bonusStats: teamOptBonusStats({ bonusStats }, [fischl, xiangling]),
      })!.total
    // 2.5 hits on average
    expectNear(
      evaluate({ [fischl]: [overloaded(2.5)] }),
      2.5 * hit(OVERLOADED, 0)
    )
    // +100 EM for the whole team (e.g. food): both hit with 100 EM more
    expectNear(
      evaluate(teamOpt.attacks, { team: { eleMas: 100 } }),
      overloadTotal(0, 100)
    )
    // +40% Overloaded DMG for Fischl only (e.g. an Abyss blessing)
    expectNear(
      evaluate(teamOpt.attacks, { [fischl]: { overloaded_dmg_: 40 } }),
      4 * hit(OVERLOADED, 0, { bonus: 0.4 }) +
        4 * hit(OVERLOADED, XIANGLING_EM + 3 * EM_MAIN)
    )
    // +50% on one attack only
    expectNear(
      evaluate({
        [fischl]: [
          { ...overloaded(4), bonusStats: { overloaded_dmg_: 50 } },
          overloaded(2),
        ],
      }),
      4 * hit(OVERLOADED, 0, { bonus: 0.5 }) + 2 * hit(OVERLOADED, 0)
    )
  })

  it('values one more roll, talent level or level as worked out by hand', () => {
    const { database, teamId } = overloadTeam()
    // the best split (k = 2): Fischl the EM sands and goblet, Xiangling the EM circlet
    const pick = (ck: CharacterKey, slot: ArtifactSlotKey, em: boolean) =>
      database.arts.values.find(
        (a) =>
          a.slotKey === slot &&
          (a.mainStatKey === 'eleMas') === em &&
          (slot === 'flower' || slot === 'plume' ? a.location === ck : true)
      )!.id
    const builds = {
      [fischl]: {
        flower: pick(fischl, 'flower', false),
        plume: pick(fischl, 'plume', false),
        sands: pick(fischl, 'sands', true),
        goblet: pick(fischl, 'goblet', true),
        circlet: pick(fischl, 'circlet', false),
      },
      [xiangling]: {
        flower: pick(xiangling, 'flower', false),
        plume: pick(xiangling, 'plume', false),
        sands: pick(xiangling, 'sands', false),
        goblet: pick(xiangling, 'goblet', false),
        circlet: pick(xiangling, 'circlet', true),
      },
    }
    const sensitivity = teamSensitivity(database, teamId, 'F', teamOpt, {
      builds,
      weapons: {},
    })
    const member = (ck: CharacterKey) =>
      sensitivity.members.find((m) => m.characterKey === ck)!
    const fischlPart = 4 * hit(OVERLOADED, 2 * EM_MAIN)
    const xianglingPart = 4 * hit(OVERLOADED, XIANGLING_EM + EM_MAIN)
    expectNear(sensitivity.base!, fischlPart + xianglingPart)
    // an average 5★ EM roll: (16.32 + 18.65 + 20.98 + 23.31) / 4 = 19.815
    expect(sensitivity.rolls.eleMas).toBeCloseTo(19.815, 2)
    const rolls = sensitivity.substats(member(fischl))
    expectNear(
      rolls.eleMas!,
      4 * hit(OVERLOADED, 2 * EM_MAIN + sensitivity.rolls.eleMas) +
        xianglingPart
    )
    // +1.72%: Fischl's 1 + bonus 3.514960 → 3.626630, so 50,347 → 51,947 (Xiangling's 42,689 stays)
    expect(rolls.eleMas! / sensitivity.base! - 1).toBeCloseTo(0.01719, 5)
    // nothing else moves a transformative hit: no CRIT, no ATK, no talent multiplier
    for (const key of ['atk_', 'critRate_', 'critDMG_', 'hp_'] as const)
      expectNear(rolls[key]!, sensitivity.base!)
    expectNear(
      sensitivity.character(member(fischl), { talent: 'skill' })!,
      sensitivity.base!
    )
    // another level: the reaction's level multiplier (the enemy stays at 100)
    const L = transformativeReactionLevelMultipliers
    expect(L[90]).toBeCloseTo(1446.8535, 4)
    expect(L[80]).toBeCloseTo(1077.4437, 4)
    for (const level of [80, 95, 100] as const)
      expectNear(
        sensitivity.character(member(fischl), { level })!,
        (L[level] / L[90]) * fischlPart + xianglingPart
      )
  })

  it('has nothing to do without attacks', async () => {
    const { database, teamId } = overloadTeam()
    const result = await run(database, teamId, initTeamOpt())
    expect(result.after.total).toBe(0)
    expect(result.before.total).toBe(0)
  })
})

// ---------- Team 2: Sucrose + Xiangling + Fischl, a support set ----------
/**
 * Sucrose swirls Pyro 3 times; Xiangling and Fischl deal 4 Overloaded each. With 4 Viridescent
 * Venerer, Sucrose's Swirls get +60% and every Pyro hit meets 10% − 40% = −30% RES (×1.15
 * instead of ×0.9):
 *
 *   Sucrose in VV, EM pieces 2 / 1 to Fischl / Xiangling:   123,671 (6,184 DPS)  ← best
 *     Swirls 3 × 1446.8535 × 0.6 × 1.6 × 1.15 = 4,792, Overloaded 64,333 + 54,547
 *   VV, and one EM piece on Sucrose (1 / 1 to the others):  106,707
 *   Best without VV (Sucrose 0 EM, 2 / 1):                   95,380
 *
 * So Sucrose wears the support set and no EM piece, even though her own Swirls would like the EM:
 * the team gains 29.7% over the best build without it. The VV pieces start scattered, so no single
 * swap completes the set: a member taking from the others has to find it.
 */
function swirlTeam() {
  const g: ArtifactSetKey = 'GladiatorsFinale'
  const vv: ArtifactSetKey = 'ViridescentVenerer'
  const built = team(
    [
      { key: sucrose, weapon: 'ThrillingTalesOfDragonSlayers' },
      { key: xiangling, weapon: 'WhiteTassel' },
      { key: fischl, weapon: 'Slingshot' },
    ],
    [
      { set: vv, slot: 'flower', main: 'hp', at: xiangling },
      { set: g, slot: 'flower', main: 'hp', at: sucrose },
      { set: g, slot: 'flower', main: 'hp', at: fischl },
      { set: vv, slot: 'plume', main: 'atk', at: xiangling },
      { set: g, slot: 'plume', main: 'atk', at: sucrose },
      { set: g, slot: 'plume', main: 'atk', at: fischl },
      { set: vv, slot: 'sands', main: 'hp_', at: fischl },
      { set: g, slot: 'sands', main: 'eleMas', at: sucrose },
      { set: g, slot: 'sands', main: 'hp_', at: xiangling },
      { set: vv, slot: 'goblet', main: 'def_', at: fischl },
      { set: g, slot: 'goblet', main: 'eleMas', at: sucrose },
      { set: g, slot: 'goblet', main: 'def_', at: xiangling },
      { set: vv, slot: 'circlet', main: 'hp_', at: sucrose },
      { set: g, slot: 'circlet', main: 'eleMas', at: xiangling },
      { set: g, slot: 'circlet', main: 'hp_', at: fischl },
    ]
  )
  // Sucrose swirls Pyro: her VV shreds Pyro RES
  built.database.teamChars.set(built.teamCharIds[sucrose]!, {
    conditional: { ViridescentVenerer: { swirlpyro: 'pyro' } },
  })
  return built
}

describe('hand-checked team: Sucrose + Xiangling + Fischl (Swirl, Viridescent Venerer)', () => {
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    attacks: {
      [sucrose]: [pyroSwirl(3)],
      [xiangling]: [overloaded(4)],
      [fischl]: [overloaded(4)],
    },
    rotationTime: 20,
  }
  const shred = { res: -0.3 }
  const withVv =
    3 * hit(SWIRL, 0, { ...shred, bonus: 0.6 }) +
    4 * hit(OVERLOADED, 2 * EM_MAIN, shred) +
    4 * hit(OVERLOADED, XIANGLING_EM + EM_MAIN, shred)
  const withoutVv =
    3 * hit(SWIRL, 0) +
    4 * hit(OVERLOADED, 2 * EM_MAIN) +
    4 * hit(OVERLOADED, XIANGLING_EM + EM_MAIN)
  const vvAndEm =
    3 * hit(SWIRL, EM_MAIN, { ...shred, bonus: 0.6 }) +
    4 * hit(OVERLOADED, EM_MAIN, shred) +
    4 * hit(OVERLOADED, XIANGLING_EM + EM_MAIN, shred)

  it('puts the support set on Sucrose, and the EM pieces on the others', async () => {
    expect(withVv / withoutVv).toBeCloseTo(1.2966, 3)
    expect(withVv).toBeCloseTo(123671.28, 1)
    expect(withVv).toBeGreaterThan(vvAndEm)
    const { database, teamId } = swirlTeam()
    const result = await run(database, teamId, teamOpt)
    const vvOn = Object.values(result.builds[sucrose]!).filter(
      (id) => database.arts.get(id!)?.setKey === 'ViridescentVenerer'
    ).length
    expect(vvOn).toBeGreaterThanOrEqual(4)
    expect(emPieces(database, result, sucrose)).toBe(0)
    expect(emPieces(database, result, fischl)).toBe(2)
    expect(emPieces(database, result, xiangling)).toBe(1)
    expectNear(result.after.total, withVv)
    expect(result.after.total / 20).toBeCloseTo(withVv / 20, 6)
  })

  it('applies the shred to the hits a limit leaves it on, by hand', () => {
    const { database, teamId } = swirlTeam()
    // Sucrose in VV (all five pieces), Xiangling with one EM piece
    const vvIds = database.arts.values
      .filter((a) => a.setKey === 'ViridescentVenerer')
      .map((a) => a)
    const xianglingArts = database.arts.values.filter(
      (a) => a.location === xiangling && a.setKey !== 'ViridescentVenerer'
    )
    const evaluate = (attack: TeamOptAttack) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts: { [sucrose]: vvIds, [xiangling]: xianglingArts },
        attacks: { [xiangling]: [attack] },
      })!.total
    const em = XIANGLING_EM + EM_MAIN
    const vvShred = {
      owner: sucrose,
      path: ['ViridescentVenerer', 'swirlpyro'],
    }
    expectNear(evaluate(overloaded(4)), 4 * hit(OVERLOADED, em, shred))
    // the shred covers the first 2 of 4 hits
    expectNear(
      evaluate({ ...overloaded(4), limits: [{ ...vvShred, hits: 2 }] }),
      2 * hit(OVERLOADED, em, shred) + 2 * hit(OVERLOADED, em)
    )
    // Sucrose swirls Electro during this attack: no Pyro shred for it
    expectNear(
      evaluate({
        ...overloaded(4),
        states: [
          {
            owner: sucrose,
            path: ['ViridescentVenerer', 'swirlpyro'],
            value: 'electro',
          },
        ],
      }),
      4 * hit(OVERLOADED, em)
    )
  })
})

// ---------- Team 3: Raiden + Xiangling, one Dragon's Bane ----------
/**
 * Both are polearm users dealing 4 Overloaded, with no EM on their artifacts. One Dragon's Bane
 * (220.512 EM) and White Tassels (none):
 *
 *   Dragon's Bane on Raiden:     (1 + bonus(220.512)) + (1 + bonus(96))      = 4.321734
 *                                → 14,323.71 × 4.321734 = 61,903 (3,095 DPS)  ← best
 *   Dragon's Bane on Xiangling:  (1 + bonus(0))       + (1 + bonus(316.512)) = 4.186128
 *                                → 59,961 (2,998 DPS)
 *
 * The EM spear goes to the member with no EM: the bonus grows slower the more EM there is.
 * Xiangling deals more at the start, so she is optimized first and takes it: only an exchange of
 * weapons finds the better way.
 */
describe('hand-checked team: Raiden + Xiangling (one Dragon’s Bane)', () => {
  const g: ArtifactSetKey = 'GladiatorsFinale'
  const fillers = (at: CharacterKey): Piece[] =>
    allArtifactSlotKeys.map((slot) => ({
      set: g,
      slot,
      main: slot === 'goblet' ? 'def_' : 'hp_',
      at,
    }))
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    optimizeWeapons: true,
    attacks: { [raiden]: [overloaded(4)], [xiangling]: [overloaded(4)] },
    rotationTime: 20,
  }
  const onRaiden =
    4 * hit(OVERLOADED, DRAGONS_BANE_EM) + 4 * hit(OVERLOADED, XIANGLING_EM)
  const onXiangling =
    4 * hit(OVERLOADED, 0) + 4 * hit(OVERLOADED, XIANGLING_EM + DRAGONS_BANE_EM)

  it('gives the EM weapon to the member it helps most', async () => {
    expect(onRaiden).toBeCloseTo(61903.24, 1)
    expect(onXiangling).toBeCloseTo(59960.87, 1)
    const { database, teamId, weaponIds } = team(
      [
        { key: xiangling, weapon: 'DragonsBane' },
        { key: raiden, weapon: 'WhiteTassel' },
      ],
      [...fillers(xiangling), ...fillers(raiden)],
      ['WhiteTassel']
    )
    const before = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks: teamOpt.attacks,
    })!
    expectNear(before.total, onXiangling)
    const result = await run(database, teamId, teamOpt)
    const dragonsBane = database.weapons.values.find(
      (w) => w.key === 'DragonsBane'
    )!
    expect(result.weapons[raiden]).toBe(dragonsBane.id)
    expect(result.weapons[xiangling]).not.toBe(dragonsBane.id)
    expect(
      Object.values(result.weapons).filter((id) => id === dragonsBane.id)
    ).toHaveLength(1)
    expectNear(result.after.total, onRaiden)
    // a weapon left out is not chosen, even where it would be better
    const kept = await run(database, teamId, {
      ...teamOpt,
      excludedWeapons: [dragonsBane.id, weaponIds['WhiteTassel']!],
    })
    expect(kept.weapons[xiangling]).toBe(dragonsBane.id)
    expectNear(kept.after.total, onXiangling)
    // Xiangling kept a weapon that is not ticked (Raiden's, the only ticked one, cannot be
    // swapped for it): the result says so
    expect(kept.untickedWeapons).toEqual([xiangling])
  })
})
