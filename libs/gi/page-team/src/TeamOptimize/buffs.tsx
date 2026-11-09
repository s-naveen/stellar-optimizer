import { evalIfFunc, valueString } from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBGender } from '@genshin-optimizer/gi/db-ui'
import type {
  CharacterSheet,
  DocumentConditional,
  DocumentSection,
  IFieldDisplay,
} from '@genshin-optimizer/gi/sheets'
import {
  getArtSheet,
  getMoonsignSheet,
  getWeaponSheet,
  hexereiSheet,
  MoonsignConditionalSection,
  reactionConditionals,
  resonanceSheets,
} from '@genshin-optimizer/gi/sheets'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type { BuffRef, TeamData } from '@genshin-optimizer/gi/ui'
import {
  buffRefKey,
  getTeamDataWith,
  resolveInfo,
  teamConditionals,
  teamOptBonusStats,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTeamOpt } from './useTeamOpt'

/** A conditional that is on in the team, as Team Optimize lists it */
export interface TeamBuff {
  ref: BuffRef
  key: string
  /** The conditional's state */
  value: string
  /** Where it comes from: the talent, weapon, artifact set or resonance */
  title?: ReactNode
  icon?: ReactNode
  /** The conditional (and its state when it has several) */
  name: ReactNode
  /** The conditional, without its state */
  label?: ReactNode
  /** Its states, when it has several (one of them per attack) */
  states?: { value: string; name: ReactNode }[]
  /** What it gives in each state: the sheet's fields, as Team settings lists them */
  fields?: Partial<Record<string, IFieldDisplay[]>>
  /**
   * Why it does nothing now, whatever the attack: `gear`, its weapon or artifact set is not
   * equipped (it counts if Team Optimize picks them); `hidden`, its sheet hides it (an effect not
   * unlocked, a resonance the team does not have)
   */
  inactive?: 'gear' | 'hidden'
  /** Buffs the team (not only its owner) */
  teamBuff: boolean
}

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

function isConditional(
  section: DocumentSection
): section is DocumentConditional {
  return 'states' in section && !!section.states
}

/** A sheet section, and whether it is in use now (its weapon or set equipped, its resonance active) */
interface SectionEntry {
  section: DocumentSection
  inUse?: { reason: 'gear' | 'hidden'; test: (data: UIData) => boolean }
}

const entries = (
  sections: readonly DocumentSection[],
  inUse?: SectionEntry['inUse']
): SectionEntry[] => sections.map((section) => ({ section, inUse }))

/** The sections that may define the conditional at `ref` */
function sectionsFor(
  ref: BuffRef,
  teamData: TeamData
): { sections: SectionEntry[]; uiData?: UIData } {
  const [sheetKey] = ref.path
  if (ref.owner === 'team') {
    const uiData = Object.values(teamData)[0]?.target
    if (sheetKey === 'reaction')
      return { sections: entries(reactionConditionals), uiData }
    return {
      sections: [
        ...resonanceSheets.flatMap((r) =>
          entries(r.sections, { reason: 'hidden', test: r.canShow })
        ),
        ...entries(hexereiSheet.sections),
        ...entries(getMoonsignSheet(uiData).sections),
      ],
      uiData,
    }
  }
  const bundle = teamData[ref.owner]
  if (!bundle) return { sections: [] }
  const uiData = bundle.target
  if (allArtifactSetKeys.includes(sheetKey as ArtifactSetKey)) {
    const setKey = sheetKey as ArtifactSetKey
    const sheet = getArtSheet(setKey)
    return {
      sections: ([1, 2, 4] as const).flatMap((pieces) =>
        entries(sheet.setEffectDocument(pieces) ?? [], {
          reason: 'gear',
          test: (data) => (data.get(input.artSet[setKey]).value ?? 0) >= pieces,
        })
      ),
      uiData,
    }
  }
  if (allWeaponKeys.includes(sheetKey as WeaponKey))
    return {
      sections: entries(getWeaponSheet(sheetKey as WeaponKey).document, {
        reason: 'gear',
        test: (data) => data.get(input.weapon.key).value === sheetKey,
      }),
      uiData,
    }
  const characterSheet = bundle.characterSheet as CharacterSheet
  const characterKey = ref.owner as CharacterKey
  return {
    sections: entries([
      // as in Team settings: Nod-Krai characters have no such section
      ...(getCharStat(characterKey).region === 'nodKrai'
        ? []
        : [MoonsignConditionalSection(characterKey, characterSheet)]),
      ...Object.values(characterSheet.talent).flatMap((t) => t.sections),
    ]),
    uiData,
  }
}

/** Why the conditional of `entry` does nothing now (undefined: it may do something) */
function inactiveIn(
  { section, inUse }: SectionEntry,
  uiData: UIData | undefined
): TeamBuff['inactive'] {
  if (!uiData) return undefined
  try {
    if (inUse && !inUse.test(uiData)) return inUse.reason
    // as Team settings: a section the sheet hides (an effect not unlocked)
    if (section.canShow && !uiData.get(section.canShow).value) return 'hidden'
  } catch {
    // cannot tell: listed as in use
  }
  return undefined
}

function describe(
  ref: BuffRef,
  value: string,
  teamData: TeamData
): Omit<TeamBuff, 'ref' | 'key' | 'value'> {
  try {
    return describeFromSheets(ref, value, teamData)
  } catch {
    // a sheet that cannot describe it: still listed, by its path
    return { name: ref.path.join(' · '), teamBuff: false }
  }
}

function describeFromSheets(
  ref: BuffRef,
  value: string,
  teamData: TeamData
): Omit<TeamBuff, 'ref' | 'key' | 'value'> {
  const { sections, uiData } = sectionsFor(ref, teamData)
  for (const entry of sections) {
    const { section } = entry
    if (!isConditional(section)) continue
    const states = uiData
      ? evalIfFunc(section.states, uiData)
      : typeof section.states === 'function'
        ? {}
        : section.states
    const inactive = inactiveIn(entry, uiData)
    const header = {
      title: section.header?.title,
      icon: uiData ? evalIfFunc(section.header?.icon, uiData) : undefined,
      teamBuff: !!section.teamBuff,
      ...(inactive ? { inactive } : {}),
    }
    if ('path' in section && section.path) {
      if (!samePath(section.path, ref.path)) continue
      const entries = Object.entries(
        states as Record<string, { name?: ReactNode; fields?: IFieldDisplay[] }>
      )
      const all = entries.map(([key, state]) => ({
        value: key,
        name: state.name ?? key,
      }))
      const stateName = all.find((s) => s.value === value)?.name
      return {
        ...header,
        // a toggle's state ("on") says nothing: only states of a choice are named
        name:
          stateName && all.length > 1 ? (
            <>
              {section.name}: {stateName}
            </>
          ) : (
            section.name
          ),
        label: section.name,
        ...(all.length > 1 ? { states: all } : {}),
        fields: Object.fromEntries(
          entries.map(([key, state]) => [key, state.fields ?? []])
        ),
      }
    }
    for (const state of Object.values(
      states as Record<
        string,
        {
          path?: readonly string[]
          name?: ReactNode
          fields?: IFieldDisplay[]
        }
      >
    ))
      if (state.path && samePath(state.path, ref.path))
        return {
          ...header,
          name: state.name,
          fields: { [value]: state.fields ?? [] },
        }
  }
  // not found in the sheets (e.g. a leftover of a sheet that changed): its path is all there is
  return { name: ref.path.join(' · '), teamBuff: false }
}

/** Every conditional that is on in the team, with its name */
export function teamBuffsOf(
  database: ArtCharDatabase,
  teamId: string,
  teamData: TeamData
): TeamBuff[] {
  return teamConditionals(database, teamId).map(({ ref, value }) => ({
    ref,
    key: buffRefKey(ref),
    value,
    ...describe(ref, value, teamData),
  }))
}

export function useTeamBuffs(teamId: string, teamData: TeamData | undefined) {
  const database = useDatabase()
  // `teamData` is recomputed whenever a conditional changes
  return useMemo(
    () => (teamData ? teamBuffsOf(database, teamId, teamData) : []),
    [database, teamId, teamData]
  )
}

/** One thing a buff gives, as its sheet shows it: a stat and its value, or a line of text */
export interface BuffEffect {
  /** Its field's place in the sheet */
  key: string
  name: ReactNode
  /** With its unit: "40%", "1,234" (none: a line of text) */
  value?: ReactNode
  /** The stat's colour (an element, a reaction) */
  variant?: string
}

/** "90.0%" → "90%", "12.50" → "12.5": the value as the sheet gives it, without trailing zeros */
const tidy = (text: string) =>
  text.replace(/(\.\d*?)0+(?=\D*$)/, '$1').replace(/\.(?=\D*$)/, '')

/**
 * What `fields` (a buff's, in one state) show in `data`, like Team settings: the stats it gives
 * and their values. Values that are 0 or hidden there are left out; without any value, a line of
 * text that says what it does (e.g. "gains the Radiance effect"), not durations or cooldowns.
 */
export function buffEffects(
  fields: readonly IFieldDisplay[] | undefined,
  data: UIData | undefined
): BuffEffect[] {
  if (!fields?.length || !data) return []
  const values: BuffEffect[] = []
  const texts: BuffEffect[] = []
  fields.forEach((field, index) => {
    const key = `${index}`
    try {
      if (field.canShow && !field.canShow(data)) return
      if ('node' in field) {
        const calc = data.get(field.node)
        if (
          calc.isEmpty ||
          typeof calc.value !== 'number' ||
          !calc.value ||
          !Number.isFinite(calc.value)
        )
          return
        const { name, unit, fixed, variant, textSuffix, multi } = resolveInfo(
          calc.info
        )
        if (!name) return
        values.push({
          key,
          name: textSuffix ? (
            <>
              {name} {textSuffix}
            </>
          ) : (
            name
          ),
          value: `${multi ? `${multi}×` : ''}${tidy(valueString(calc.value, unit, fixed))}`,
          variant: variant && variant !== 'invalid' ? variant : undefined,
        })
      } else if (field.text) {
        const value = evalIfFunc(field.value, data)
        if (value === undefined || value === null || value === '')
          texts.push({ key, name: field.text })
      }
    } catch {
      // a field this data cannot compute: left out
    }
  })
  return values.length ? values : texts.slice(0, 1)
}

/**
 * The team's data during `attack`, as the rotation computes it: the buffs in the states it uses,
 * its member on the field, the extra buffs counted. Where the editor reads what each buff gives.
 * Built in the background (the editor opens first); `version` (the team's buffs) rebuilds it.
 */
export function useAttackTeamData(
  teamId: string,
  attack: TeamOptAttack,
  onField: CharacterKey,
  mainStatAssumptionLevel: number,
  version: unknown
) {
  const database = useDatabase()
  const gender = useDBGender()
  const [teamOpt] = useTeamOpt(teamId)
  const [teamData, setTeamData] = useState<
    Partial<Record<CharacterKey, { target: UIData }>> | undefined
  >()
  const statesKey = JSON.stringify(attack.states ?? [])
  const active = attack.onField ?? onField
  // biome-ignore lint/correctness/useExhaustiveDependencies: `statesKey` stands for `attack.states`, `version` for the team
  useEffect(() => {
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const data = getTeamDataWith(database, teamId, {
        states: attack.states ?? [],
        mainStatAssumptionLevel,
        bonusStats: teamOptBonusStats(teamOpt, keys),
      })
      if (!data) return
      const onFieldNow = data[active] ? active : keys[0]
      if (!onFieldNow || !data[onFieldNow]) return
      // the member on the field first, as in the app (its data is the team's "active" one)
      const ordered = { [onFieldNow]: data[onFieldNow], ...data }
      setTeamData(uiDataForTeam(ordered, gender, onFieldNow))
    }, 0)
    return () => clearTimeout(timer)
  }, [
    database,
    teamId,
    gender,
    statesKey,
    active,
    mainStatAssumptionLevel,
    teamOpt.bonusStats,
    version,
  ])
  return teamData
}

/** The buffs that can change an attack of `characterKey`: its own, the team's, and teammates' team buffs */
export function buffsForAttacker(
  buffs: readonly TeamBuff[],
  characterKey: CharacterKey
) {
  return buffs.filter(
    (b) => b.ref.owner === characterKey || b.ref.owner === 'team' || b.teamBuff
  )
}
