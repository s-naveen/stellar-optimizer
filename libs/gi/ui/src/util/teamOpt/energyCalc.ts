import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptEnergyCalculator } from '@genshin-optimizer/gi/db'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import particleData from './energyCalcData.json'

/** Factual particle data and fixed-rotation equations from the user's ERC 7.3 workbook (v1.59.1). */
export const ENERGY_CALC_SOURCE =
  'https://docs.google.com/spreadsheets/d/1FQSiWb3Di5B8BexdzrbmTWXrONbo30JdBlUSkHfZxJA/edit#gid=613391376'
export const energyCalcData = particleData as Partial<
  Record<
    CharacterKey,
    {
      skills: {
        label: string
        particles: number
        flatEnergy: number
        variance: number
        perSecond: number
        duration: number
        cooldown: number
      }[]
      burstCost: number
      burstDiscount: number
      erDiscount: number
    }
  >
>

export interface EnergyCalcResult {
  targets: Partial<Record<CharacterKey, number>>
  members: Partial<
    Record<
      CharacterKey,
      {
        particleEnergy: number
        flatEnergy: number
        burstCost: number
        required: number
      }
    >
  >
  errors: string[]
}

/** Net flat energy per trigger, from the workbook's equipment reference. */
export function energyWeaponFlat(
  key: WeaponKey | undefined,
  refinement = 1
): number {
  switch (key) {
    case 'AmenomaKageuchi':
    case 'KatsuragikiriNagamasa':
    case 'KitainCrossSpear':
      return 4.5 + 1.5 * refinement
    case 'PrototypeAmber':
      return 10.5 + 1.5 * refinement
    case 'EverlastingMoonglow':
      return 0.6
    default:
      return 0
  }
}

export const isFavonius = (key: WeaponKey | undefined) =>
  !!key?.startsWith('Favonius')
/** A Favonius weapon triggers at most once per 12/10.5/9/7.5/6 s (R1–R5). */
export const favoniusCooldown = (refinement = 1) =>
  13.5 - 1.5 * Math.min(5, Math.max(1, Math.round(refinement)))

/** The constellation a skill option needs ("Constellation 2", "C2 proc"); 0 for any other. */
export const energySkillConstellation = (label: string) =>
  Number(/^(?:Constellation |C)(\d)\b/.exec(label)?.[1] ?? 0)

/** Validates all inputs so incomplete settings cannot silently produce an ER target. */
export function calculateEnergyRecharge(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  /**
   * The members' actual weapons (KQM's picks): Favonius particles then count only for a
   * Favonius wielder (at most once per its cooldown), weapon flat energy only for an energy
   * weapon. Absent: Favonius triggers count as entered and no weapon gives flat energy.
   */
  weapons?: Partial<Record<CharacterKey, WeaponKey>>,
  refinements?: Partial<Record<CharacterKey, number>>
): EnergyCalcResult {
  const result: EnergyCalcResult = { targets: {}, members: {}, errors: [] }
  const finite = (n: number, min: number, max = Number.POSITIVE_INFINITY) =>
    Number.isFinite(n) && n >= min && n <= max
  if (
    !finite(settings.rotationTime, 0.1) ||
    !finite(settings.clearTime, 0.1) ||
    !finite(settings.enemyParticles, 0) ||
    !finite(settings.electroInterval, 0)
  )
    result.errors.push('Check rotation time, clear time and enemy particles.')
  const fieldSum = keys.reduce(
    (n, key) => n + (settings.members[key]?.fieldTime ?? 0),
    0
  )
  if (Math.abs(fieldSum - 100) > 0.1)
    result.errors.push('Field time must add up to 100%.')
  for (const key of keys) {
    const member = settings.members[key]
    const data = energyCalcData[key]
    if (!member || !data) {
      result.errors.push(`Particle data or inputs are missing for ${key}.`)
      continue
    }
    if (
      !finite(member.fieldTime, 0, 100) ||
      !finite(member.burstEvery, 0) ||
      !finite(member.skillUses, 0) ||
      !finite(member.secondaryUses, 0) ||
      !finite(member.funnelShare, 0, 100) ||
      !finite(member.favoniusProcs, 0) ||
      !finite(member.weaponEnergyTriggers ?? 0, 0) ||
      !Number.isFinite(member.flatEnergy) ||
      !Number.isInteger(member.skillMode) ||
      !data.skills[member.skillMode] ||
      !Number.isInteger(member.secondaryMode) ||
      !data.skills[member.secondaryMode] ||
      (member.catchBy && !keys.includes(member.catchBy)) ||
      (member.favoniusCatchBy && !keys.includes(member.favoniusCatchBy))
    )
      result.errors.push(`Check the energy inputs for ${key}.`)
  }
  if (result.errors.length) return result
  const rng = settings.rng === 'worst' ? 1 : settings.rng === 'safe' ? 0.5 : 0
  // Off field, a member gets 60% of a particle's energy in a party of 4 (70% of 3, 80% of 2).
  const offField = 1 - 0.1 * Math.min(4, Math.max(2, keys.length))
  /** A particle's share of its energy for a member on the field `caught` of the time */
  const share = (caught: number) => offField + (1 - offField) * caught
  // (elemental resonance needs a party of four)
  const hasElectroResonance =
    keys.length === 4 &&
    keys.filter((key) => getCharEle(key) === 'electro').length >= 2 &&
    keys.some((key) =>
      ['pyro', 'hydro', 'cryo', 'dendro'].includes(getCharEle(key))
    )
  for (const recipient of keys) {
    const own = settings.members[recipient]!
    const ownData = energyCalcData[recipient]!
    const field = own.fieldTime / 100
    // A skill's particles are of its element: 3 energy to a matching member, 1 to another.
    const elementValue = (source: CharacterKey) =>
      getCharEle(source) === getCharEle(recipient) ? 3 : 1
    let particles = 0
    for (const source of keys) {
      const member = settings.members[source]!
      const data = energyCalcData[source]!
      const modes = [
        { mode: member.skillMode, uses: member.skillUses },
        { mode: member.secondaryMode, uses: member.secondaryUses },
      ]
      let turretTime = 0
      for (const [i, { mode, uses }] of modes.entries()) {
        const skill = data.skills[mode]
        // Fischl's burst also summons Oz. Kokomi's refresh extends her existing turret.
        // (once per burst: with the primary skill only, even when the second one is the same)
        const burstSummons =
          i === 0 &&
          (source === 'Fischl' ||
            (source === 'SangonomiyaKokomi' && skill.label === 'Refresh')) &&
          member.burstEvery > 0
            ? 1 / member.burstEvery
            : 0
        const uptime = Math.min(
          skill.duration * (uses + burstSummons),
          Math.max(0, settings.rotationTime - turretTime)
        )
        const isTurret = skill.perSecond > 0
        if (isTurret) turretTime += uptime
        const count =
          (isTurret ? skill.perSecond * uptime : skill.particles * uses) *
          (1 - skill.variance * rng)
        const catchBy = member.catchBy ?? source
        const fed = member.funnelShare / 100
        const caught = isTurret
          ? field
          : (recipient === catchBy ? fed : 0) +
            (recipient === source ? 1 - fed : 0)
        particles += count * elementValue(source) * share(caught)
      }
      // A Favonius trigger makes 3 clear particles (2 energy each on the field) for whoever
      // is on the field then.
      const weapon = weapons?.[source]
      const favoniusProcs = !weapons
        ? member.favoniusProcs
        : isFavonius(weapon)
          ? Math.min(
              member.favoniusProcs,
              settings.rotationTime / favoniusCooldown(refinements?.[source])
            )
          : 0
      particles +=
        3 *
        favoniusProcs *
        2 *
        share(recipient === (member.favoniusCatchBy ?? source) ? 1 : 0)
    }
    particles +=
      (settings.enemyParticles * 2 * share(field) * settings.rotationTime) /
      settings.clearTime
    if (hasElectroResonance && settings.electroInterval > 0)
      particles +=
        (settings.rotationTime / Math.max(5, settings.electroInterval)) *
        (getCharEle(recipient) === 'electro' ? 3 : 1) *
        share(field)
    // Dori's A4 converts each skill use into energy that scales with her ER.
    if (recipient === 'Dori')
      particles += 5 * (own.skillUses + own.secondaryUses)
    const flat =
      own.flatEnergy +
      energyWeaponFlat(weapons?.[recipient], refinements?.[recipient]) *
        (own.weaponEnergyTriggers ?? 0) +
      ownData.skills[own.skillMode].flatEnergy * own.skillUses +
      ownData.skills[own.secondaryMode].flatEnergy * own.secondaryUses
    const cost = Math.max(0, ownData.burstCost - ownData.burstDiscount)
    const needed =
      own.burstEvery === 0 || cost === 0 ? 0 : cost / own.burstEvery - flat
    const required =
      needed <= 0
        ? 100
        : particles > 0
          ? Math.max(100, (needed / particles - ownData.erDiscount) * 100)
          : Number.POSITIVE_INFINITY
    result.members[recipient] = {
      particleEnergy: particles,
      flatEnergy: flat,
      burstCost: cost,
      required,
    }
    if (!Number.isFinite(required))
      result.errors.push(
        `${recipient} has no particle energy. Add particle sources or disable its burst.`
      )
    else result.targets[recipient] = Math.ceil(required * 10 - 1e-9) / 10
  }
  return result
}

/**
 * Before KQM picks the weapons, the weapons an estimate assumes: per member, from the weapons it
 * may use, a Favonius one when it has Favonius triggers, else an energy weapon when it has
 * energy weapon triggers. With none allowed, those triggers count for nothing (as in the run).
 */
export function energyCalcWeapons(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  allowed: (
    key: CharacterKey
  ) => readonly { key: WeaponKey; refinement: number }[]
) {
  const weapons: Partial<Record<CharacterKey, WeaponKey>> = {}
  const refinements: Partial<Record<CharacterKey, number>> = {}
  for (const key of keys) {
    const member = settings.members[key]
    if (!member) continue
    const candidates = allowed(key)
    const weapon =
      (member.favoniusProcs > 0
        ? candidates.find((w) => isFavonius(w.key))
        : undefined) ??
      ((member.weaponEnergyTriggers ?? 0) > 0
        ? candidates.find((w) => energyWeaponFlat(w.key) > 0)
        : undefined)
    if (!weapon) continue
    weapons[key] = weapon.key
    refinements[key] = weapon.refinement
  }
  return { weapons, refinements }
}

/** Starting assumptions are visible and editable; skill uses are casts, not damage hits. */
export function defaultEnergyCalculator(
  keys: readonly CharacterKey[],
  rotationTime = 20,
  onField = keys[0],
  /** Per member; absent: KQM's standard (4★ C6, 5★ C0) */
  constellations?: Partial<Record<CharacterKey, number>>
): TeamOptEnergyCalculator {
  return {
    rotationTime,
    clearTime: 90,
    enemyParticles: 9,
    rng: 'safe',
    electroInterval: 0,
    members: Object.fromEntries(
      keys.map((key) => {
        const mode = defaultSkillMode(key, constellations?.[key])
        return [
          key,
          {
            fieldTime:
              keys.length === 1
                ? 100
                : key === onField
                  ? 50
                  : 50 / (keys.length - 1),
            burstEvery: energyCalcData[key]?.burstCost === 0 ? 0 : 1,
            skillMode: mode,
            skillUses: 1,
            secondaryMode: mode,
            secondaryUses: 0,
            catchBy: key,
            funnelShare: 100,
            favoniusProcs: 0,
            weaponEnergyTriggers: 0,
            favoniusCatchBy: key,
            flatEnergy: 0,
          },
        ]
      })
    ),
  }
}

/** The "Constellation N" option for the member's constellation (others are extra uses, like "C2 proc") */
function defaultSkillMode(key: CharacterKey, constellation?: number) {
  const cons = constellation ?? (getCharStat(key).rarity === 4 ? 6 : 0)
  let mode = 0
  energyCalcData[key]?.skills.forEach((skill, i) => {
    if (
      skill.label.startsWith('Constellation ') &&
      energySkillConstellation(skill.label) <= cons
    )
      mode = i
  })
  return mode
}

/**
 * Saved calculator settings for the team as it is now: members added since get the starting
 * assumptions (and the field time is shared out again), catchers who left are replaced by the
 * member itself, and a skill option the member's constellation does not have by its default.
 */
export function syncEnergyCalculator(
  keys: readonly CharacterKey[],
  saved: TeamOptEnergyCalculator | undefined,
  rotationTime = 20,
  onField = keys[0],
  constellations?: Partial<Record<CharacterKey, number>>
): TeamOptEnergyCalculator {
  const defaults = defaultEnergyCalculator(
    keys,
    rotationTime,
    onField,
    constellations
  )
  if (!saved) return defaults
  const members: TeamOptEnergyCalculator['members'] = {}
  for (const key of keys) {
    const member = { ...(saved.members[key] ?? defaults.members[key]!) }
    const fallback = defaults.members[key]!
    const skills = energyCalcData[key]?.skills ?? []
    const cons = constellations?.[key]
    const usable = (mode: number) =>
      !!skills[mode] &&
      (cons === undefined ||
        energySkillConstellation(skills[mode].label) <= cons)
    if (!usable(member.skillMode)) member.skillMode = fallback.skillMode
    if (!usable(member.secondaryMode))
      member.secondaryMode = fallback.secondaryMode
    if (member.catchBy && !keys.includes(member.catchBy)) member.catchBy = key
    if (member.favoniusCatchBy && !keys.includes(member.favoniusCatchBy))
      member.favoniusCatchBy = key
    members[key] = member
  }
  const changed =
    keys.some((key) => !saved.members[key]) ||
    Object.keys(saved.members).some(
      (key) => !keys.includes(key as CharacterKey)
    )
  const total = keys.reduce((n, key) => n + members[key]!.fieldTime, 0)
  if (changed && Number.isFinite(total) && Math.abs(total - 100) > 0.1)
    for (const key of keys)
      members[key]!.fieldTime =
        total > 0
          ? (members[key]!.fieldTime / total) * 100
          : defaults.members[key]!.fieldTime
  return { ...saved, members }
}

/**
 * Sets a member's field time and shares the rest of the rotation among the others in proportion
 * to their field time (evenly if they had none), so the team's field time stays 100%.
 */
export function withFieldTime(
  settings: TeamOptEnergyCalculator,
  keys: readonly CharacterKey[],
  key: CharacterKey,
  fieldTime: number
): TeamOptEnergyCalculator {
  const member = settings.members[key]
  if (!member) return settings
  if (!Number.isFinite(fieldTime))
    return {
      ...settings,
      members: { ...settings.members, [key]: { ...member, fieldTime } },
    }
  const others = keys.filter((k) => k !== key && settings.members[k])
  const own = others.length ? Math.max(0, Math.min(100, fieldTime)) : 100
  const oldTotal = others.reduce(
    (n, k) => n + (settings.members[k]!.fieldTime || 0),
    0
  )
  const members = { ...settings.members, [key]: { ...member, fieldTime: own } }
  for (const other of others)
    members[other] = {
      ...settings.members[other]!,
      fieldTime:
        (100 - own) *
        (oldTotal > 0
          ? (settings.members[other]!.fieldTime || 0) / oldTotal
          : 1 / others.length),
    }
  return { ...settings, members }
}
