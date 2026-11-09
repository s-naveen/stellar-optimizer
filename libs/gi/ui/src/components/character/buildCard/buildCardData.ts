import { getUnitStr, notEmpty } from '@genshin-optimizer/common/util'
import {
  artifactAsset,
  artifactDefIcon,
  characterAsset,
  weaponAsset,
} from '@genshin-optimizer/gi/assets'
import {
  charCard,
  charIllustration,
  charSplash,
} from '@genshin-optimizer/gi/char-cards'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  ElementKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
  charKeyToLocGenderedCharKey,
  getCharLevelString,
  getLevelString,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  useCharMeta,
  useDatabase,
  useDBMeta,
} from '@genshin-optimizer/gi/db-ui'
import type { TalentSheetElementKey } from '@genshin-optimizer/gi/sheets'
import { getCharSheet, getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { getWeaponStat, weaponHasRefinement } from '@genshin-optimizer/gi/stats'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import { computeUIData, uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import {
  artDisplayValue,
  getArtifactEfficiency,
  getMainStatDisplayStr,
  getMainStatDisplayValue,
} from '@genshin-optimizer/gi/util'
import { dataObjForWeapon, input } from '@genshin-optimizer/gi/wr'
import type { Theme } from '@mui/material'
import { useTheme } from '@mui/material'
import type { TFunction } from 'i18next'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataContext } from '../../../context'
import { getCharDataBundle } from '../../../hooks/useTeamData'
import { GetCalcDisplay, statName } from '../../../util'

/** A stat on the card: its key (for its icon), name and formatted value */
export type CardStat = { key: string; label: string; value: string }

export type CardArtifact = {
  slotKey: ArtifactSlotKey
  setName: string
  icon: string
  rarity: number
  level: number
  main: CardStat
  /** substats, with how many times each rolled (0: unknown) */
  subs: (CardStat & { rolls: number })[]
  /**
   * Roll Value: its substats that count (`rvKeys`) in maximum rolls, as a percentage (the app's
   * "Current Roll Value")
   */
  rv: number
  /** Crit Value: 2 × CRIT Rate + CRIT DMG of its substats */
  cv: number
}

/** Everything the build card shows, as plain text and image URLs (the canvas draws only this) */
export type BuildCardData = {
  characterKey: CharacterKey
  name: string
  element: ElementKey | 'physical'
  elementName: string
  elementColor: string
  /** the character's namecard art: blurred, it is the card's backdrop */
  backdrop: string
  level: string
  constellation: number
  constellationIcons: string[]
  talents: { level: number; boosted: boolean; icon: string }[]
  /** the character's art when there is no splash art: official art, or its card */
  art: string
  /** how much of `art`'s left and top edges to cut (the cards have a logo band and a pattern) */
  artCrop: { left: number; top: number }
  /** the character's splash art, if it has one (large: downloaded only when the card is drawn) */
  splash?: string
  weapon?: {
    name: string
    icon: string
    rarity: number
    level: string
    refinement?: number
    main?: CardStat
    sub?: CardStat
  }
  /** one per slot, flower to circlet: undefined when the slot is empty */
  artifacts: (CardArtifact | undefined)[]
  /** the active set bonuses: 2 or 4 pieces ("4-piece") */
  sets: { name: string; pieces: string; icon: string }[]
  stats: CardStat[]
  /** each stat summed over the artifacts (main stats and substats), in a fixed order */
  artifactTotals: CardStat[]
  /**
   * the artifacts' Roll Value, summed, and Crit Value: 2 × CRIT Rate + CRIT DMG over all their
   * stats, main stats included
   */
  rv: number
  /** the substats that count toward Roll Value (the character's choice; all by default) */
  rvKeys: SubstatKey[]
  cv: number
  /** colors of substats rolled 1…6 times */
  rollColors: string[]
  labels: {
    emptySlot: string
    level: string
    siteName: string
    rv: string
    cv: string
  }
}

const elementColors: Record<string, string> = {
  anemo: '#61dbbb',
  geo: '#f8ba4e',
  electro: '#b25dcd',
  dendro: '#a5c83b',
  hydro: '#5680ff',
  pyro: '#ff3c32',
  cryo: '#77a2e6',
  physical: '#aaaaaa',
}

/** The substats that count toward Roll Value: a character's choice (all when none is saved) */
export function rvKeysOf(rvFilter: readonly unknown[]): SubstatKey[] {
  const keys = allSubstatKeys.filter((k) => rvFilter.includes(k))
  return keys.length ? keys : [...allSubstatKeys]
}

/** The theme's colors of substats rolled 1…6 times */
export function rollColorsOf(theme: Theme): string[] {
  return [1, 2, 3, 4, 5, 6].map(
    (n) =>
      (theme.palette as unknown as Record<string, { main: string }>)[`roll${n}`]
        ?.main ?? '#ece5d8'
  )
}

/** What a card's data is made from, besides the character's calculation data */
export type BuildCardDeps = {
  database: ArtCharDatabase
  gender: GenderKey
  /** with the ui, sheet_gen, charNames_gen, weaponNames_gen and artifactNames_gen namespaces */
  t: TFunction
  rollColors: string[]
  rvKeys: SubstatKey[]
}

/**
 * The character's own stats with a build, as its in-game attributes show them: the character,
 * weapon and artifacts alone, without a team's buffs or any conditional effect (those depend on
 * the fight, so they would make cards incomparable). `undefined` without the character or weapon.
 */
function panelData(
  database: ArtCharDatabase,
  gender: GenderKey,
  characterKey: CharacterKey,
  weaponId: string | undefined,
  artifactIds: (string | undefined)[]
): UIData | undefined {
  const char = database.chars.get(characterKey)
  const weapon = weaponId ? database.weapons.get(weaponId) : undefined
  if (!char || !weapon) return undefined
  const arts = artifactIds
    .map((id) => (id ? database.arts.get(id) : undefined))
    .filter(notEmpty)
  const bundle = getCharDataBundle(
    database,
    false,
    0,
    {
      key: characterKey,
      level: char.level,
      constellation: char.constellation,
      ascension: char.ascension,
      talent: char.talent,
      infusionAura: '',
      customMultiTargets: [],
      conditional: { resonance: {}, reaction: {} },
      bonusStats: {},
      enemyOverride: {},
      hitMode: 'avgHit',
      reaction: undefined,
    },
    weapon,
    arts
  )
  if (!bundle) return undefined
  return uiDataForTeam({ [characterKey]: bundle.data }, gender, characterKey)[
    characterKey
  ]?.target
}

/**
 * A character's build as card data, from its calculation data (`build`: which character, weapon
 * and artifacts; on a team page, with the team's buffs). Its stats are the character's own with
 * that build (see `panelData`). `undefined` when it has no character.
 */
export function makeBuildCardData(
  build: UIData,
  { database, gender, t, rollColors, rvKeys }: BuildCardDeps
): BuildCardData | undefined {
  const characterKey = build.get(input.charKey).value as
    | CharacterKey
    | undefined
  if (!characterKey) return undefined
  const weaponId = build.get(input.weapon.id).value as string | undefined
  const artifactIds = allArtifactSlotKeys.map(
    (slotKey) => build.get(input.art[slotKey].id).value as string | undefined
  )
  const data =
    panelData(database, gender, characterKey, weaponId, artifactIds) ?? build
  const sheet = getCharSheet(characterKey, gender)
  const element = (data.get(input.charEle).value ?? 'physical') as
    | ElementKey
    | 'physical'
  const total = (key: string) =>
    data.get(input.total[key as keyof typeof input.total] as any)
  // flat stats (HP, ATK, DEF, Elemental Mastery) as whole numbers, the rest as the app shows them
  const stat = (key: string): CardStat => ({
    key,
    label: statName(key),
    value: getUnitStr(key)
      ? GetCalcDisplay(total(key)).valueString
      : String(Math.round(Number(total(key).value))),
  })

  // talents: their levels with constellation boosts (boosted ones are highlighted)
  const talents = (['auto', 'skill', 'burst'] as const).map((key) => ({
    level: Number(data.get(input.total[key]).value),
    boosted: !!data.get(input.total[`${key}Boost`]).value,
    icon: sheet?.getTalentOfKey(key)?.img ?? '',
  }))

  // weapon: its own main and secondary stats, as its card shows them
  const dbWeapon = weaponId ? database.weapons.get(weaponId) : undefined
  const weaponSheet = dbWeapon && getWeaponSheet(dbWeapon.key)
  let weapon: BuildCardData['weapon']
  if (dbWeapon && weaponSheet) {
    const weaponData = computeUIData([
      weaponSheet.data,
      dataObjForWeapon(dbWeapon),
    ])
    const weaponStat = (node: typeof input.weapon.main) => {
      const res = weaponData.get(node)
      const key = res.info.path
      return key && res.value
        ? {
            key,
            label: statName(key),
            value: GetCalcDisplay(res).valueString,
          }
        : undefined
    }
    weapon = {
      name: t(`weaponNames_gen:${dbWeapon.key}`),
      icon: weaponAsset(dbWeapon.key, dbWeapon.ascension >= 2),
      rarity: getWeaponStat(dbWeapon.key).rarity,
      level: getLevelString(dbWeapon.level, dbWeapon.ascension),
      refinement: weaponHasRefinement(dbWeapon.key)
        ? dbWeapon.refinement
        : undefined,
      main: weaponStat(input.weapon.main),
      sub: weaponStat(input.weapon.sub),
    }
  }

  // artifacts, slot by slot; and each stat summed over them
  const rvSet = new Set<SubstatKey>(rvKeys)
  const setCounts = new Map<ArtifactSetKey, number>()
  const sums = new Map<string, number>()
  const add = (key: string, value: number) =>
    sums.set(key, (sums.get(key) ?? 0) + value)
  const artifacts = allArtifactSlotKeys.map((slotKey) => {
    const id = build.get(input.art[slotKey].id).value as string | undefined
    const art = id ? database.arts.get(id) : undefined
    if (!art) return undefined
    setCounts.set(art.setKey, (setCounts.get(art.setKey) ?? 0) + 1)
    add(
      art.mainStatKey,
      getMainStatDisplayValue(art.mainStatKey, art.rarity, art.level)
    )
    const subs = art.substats.filter((s) => s.key && s.value)
    for (const s of subs) add(s.key, s.value)
    const subValue = (key: string) =>
      subs.find((s) => s.key === key)?.value ?? 0
    return {
      slotKey,
      setName: t(`artifactNames_gen:${art.setKey}`),
      icon: artifactAsset(art.setKey, slotKey),
      rarity: art.rarity,
      level: art.level,
      main: {
        key: art.mainStatKey,
        label: statName(art.mainStatKey),
        value: getMainStatDisplayStr(art.mainStatKey, art.rarity, art.level),
      },
      // (the efficiency counts maximum rolls: 7.7 is the 770% the app shows)
      rv: getArtifactEfficiency(art, rvSet).currentEfficiency * 100,
      cv: 2 * subValue('critRate_') + subValue('critDMG_'),
      subs: subs.map((s) => {
        const unit = getUnitStr(s.key)
        return {
          key: s.key,
          label: statName(s.key),
          value: `${artDisplayValue(s.value, unit)}${unit}`,
          rolls: s.rolls?.length ?? 0,
        }
      }),
    } satisfies CardArtifact
  })
  const sets = [...setCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([setKey, n]) => ({
      name: t(`artifactNames_gen:${setKey}`),
      pieces: t('ui:buildCard.pieces', {
        count: n >= 4 ? 4 : 2,
        defaultValue: '{{count}}-piece',
      }),
      icon: artifactDefIcon(setKey),
    }))

  // final stats: the essentials, then the element's DMG bonus and healing if any
  const stats = [
    'hp',
    'atk',
    'def',
    'eleMas',
    'critRate_',
    'critDMG_',
    'enerRech_',
  ].map(stat)
  const dmgKey = `${element}_dmg_`
  stats.push(stat(dmgKey))
  if (element !== 'physical' && Number(total('physical_dmg_').value) > 0)
    stats.push(stat('physical_dmg_'))
  if (Number(total('heal_').value) > 0) stats.push(stat('heal_'))

  // the artifacts' totals: the usual stats first (flat before %), then any DMG bonus or healing
  const totalOrder = [
    'hp',
    'hp_',
    'atk',
    'atk_',
    'def',
    'def_',
    'eleMas',
    'enerRech_',
    'critRate_',
    'critDMG_',
  ]
  const artifactTotals = [...sums.keys()]
    .filter((key) => (sums.get(key) ?? 0) > 0)
    .sort((a, b) => {
      const ia = totalOrder.indexOf(a)
      const ib = totalOrder.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map((key) => {
      const unit = getUnitStr(key)
      return {
        key,
        label: statName(key),
        value: `${artDisplayValue(sums.get(key) ?? 0, unit)}${unit}`,
      }
    })
  const present = artifacts.filter((a) => !!a)

  const illustration = charIllustration(characterKey)
  return {
    characterKey,
    name: t(
      `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
    ),
    element,
    elementName: t(`sheet_gen:element.${element}`, {
      defaultValue: element.charAt(0).toUpperCase() + element.slice(1),
    }),
    elementColor: elementColors[element] ?? elementColors['physical'],
    backdrop: characterAsset(characterKey, 'banner', gender) ?? '',
    level: getCharLevelString(
      Number(data.get(input.lvl).value),
      Number(data.get(input.asc).value) as Parameters<
        typeof getCharLevelString
      >[1]
    ),
    constellation: Number(data.get(input.constellation).value),
    constellationIcons: ([1, 2, 3, 4, 5, 6] as const).map(
      (i) =>
        sheet?.getTalentOfKey(`constellation${i}` as TalentSheetElementKey)
          ?.img ?? ''
    ),
    talents,
    art: illustration ?? charCard(characterKey, gender),
    artCrop: illustration ? { left: 0, top: 0 } : { left: 0.07, top: 0.13 },
    splash: charSplash(characterKey, gender),
    weapon,
    artifacts,
    sets,
    stats,
    artifactTotals,
    rv: present.reduce((sum, a) => sum + a.rv, 0),
    rvKeys,
    // the build's Crit Value counts main stats too (a crit circlet): it matches the totals
    cv: 2 * (sums.get('critRate_') ?? 0) + (sums.get('critDMG_') ?? 0),
    rollColors,
    labels: {
      emptySlot: t('ui:buildCard.emptySlot', 'Empty'),
      level: t('ui:buildCard.level', 'Lv.'),
      siteName: 'Stellar Optimizer',
      rv: t('ui:buildCard.rv', 'RV'),
      cv: t('ui:buildCard.cv', 'CV'),
    },
  }
}

/**
 * The build of the DataContext's character as card data: on the character page, its equipped
 * artifacts and weapon; on a team page, the loadout's build. `undefined` until the data is ready.
 */
export function useBuildCardData(): BuildCardData | undefined {
  const { t } = useTranslation([
    'ui',
    'sheet_gen',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
    'keymap',
  ])
  const { data } = useContext(DataContext)
  const database = useDatabase()
  const { gender } = useDBMeta()
  const theme = useTheme()
  const characterKeyOf = data?.get(input.charKey).value as
    | CharacterKey
    | undefined
  const { rvFilter } = useCharMeta((characterKeyOf ?? '') as CharacterKey)
  const rvKeys = useMemo(() => rvKeysOf(rvFilter), [rvFilter])
  const rollColors = useMemo(() => rollColorsOf(theme), [theme])
  return useMemo(
    () =>
      data &&
      makeBuildCardData(data, {
        database,
        gender,
        t: t as unknown as TFunction,
        rollColors,
        rvKeys,
      }),
    [data, database, gender, t, rollColors, rvKeys]
  )
}
