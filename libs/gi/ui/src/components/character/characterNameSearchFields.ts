import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import {
  allCharacterKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import { i18n } from '@genshin-optimizer/gi/i18n'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  matchesCommandSearchAny,
  splitCamelCaseForSearch,
} from '../../util/commandPaletteSearch'

export type CharacterNameSearchFieldsCache = ReadonlyMap<
  CharacterKey,
  readonly string[]
>

export function characterNameSearchFieldsFor(
  ck: CharacterKey,
  gender: GenderKey
): readonly string[] {
  const locKey = charKeyToLocGenderedCharKey(ck, gender)
  const displayName = i18n.t(`charNames_gen:${locKey}` as const).toString()
  const fields: string[] = [
    displayName,
    ck,
    splitCamelCaseForSearch(ck),
    getCharEle(ck),
  ]
  return fields
}

export function buildCharacterNameSearchFieldsCache(
  gender: GenderKey
): CharacterNameSearchFieldsCache {
  const map = new Map<CharacterKey, readonly string[]>()
  for (const ck of allCharacterKeys) {
    map.set(ck, characterNameSearchFieldsFor(ck, gender))
  }
  return map
}

export function characterMatchesNameSearch(
  searchFields: CharacterNameSearchFieldsCache,
  ck: CharacterKey,
  filter: string | undefined
): boolean {
  if (filter === undefined || filter === '') return true
  const fields = searchFields.get(ck)
  if (!fields) return false
  return matchesCommandSearchAny([...fields], filter)
}

/** Rebuild when locale / name namespaces load so search strings stay translated. */
export function useCharacterNameSearchFieldsCache(
  gender: GenderKey
): CharacterNameSearchFieldsCache | undefined {
  const { i18n: i18nInst } = useTranslation('charNames_gen')
  const lang = i18nInst.resolvedLanguage ?? i18nInst.language
  const namesReady = i18nInst.hasResourceBundle(lang, 'charNames_gen')
  return useMemo(() => {
    if (!namesReady) return undefined
    return buildCharacterNameSearchFieldsCache(gender)
  }, [gender, lang, namesReady])
}
