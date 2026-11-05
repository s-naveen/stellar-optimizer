import type { GeneralAutocompleteOption } from '@genshin-optimizer/common/ui'
import { GeneralAutocompleteMulti } from '@genshin-optimizer/common/ui'
import type { LocationCharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allLocationCharacterKeys,
  allTravelerKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { Chip, Skeleton } from '@mui/material'
import { Suspense, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CharIconSide } from '.'

export function LocationFilterMultiAutocomplete({
  locations,
  setLocations,
  totals,
  disabled,
  size,
}: {
  locations: LocationCharacterKey[]
  setLocations: (v: LocationCharacterKey[]) => void
  totals: Record<LocationCharacterKey, string>
  disabled?: boolean
  size?: 'small' | 'medium'
}) {
  const { t } = useTranslation(['artifact', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const namesCB = useCallback(
    (key: LocationCharacterKey): string =>
      t(
        `charNames_gen:${charKeyToLocGenderedCharKey(
          database.chars.LocationToCharacterKey(key),
          gender
        )}`
      ),
    [database, gender, t]
  )

  const toImg = useCallback(
    (key: LocationCharacterKey) => (
      <CharIconSide characterKey={database.chars.LocationToCharacterKey(key)} />
    ),
    [database]
  )

  const toExLabel = useCallback(
    (key: LocationCharacterKey) => <strong>{totals[key]}</strong>,
    [totals]
  )
  const toExItemLabel = useCallback(
    (key: LocationCharacterKey) => <Chip size="small" label={totals[key]} />,
    [totals]
  )

  const isFavorite = useCallback(
    (key: LocationCharacterKey) =>
      key === 'Traveler'
        ? allTravelerKeys.some((key) => database.charMeta.get(key).favorite)
        : key
          ? database.charMeta.get(key).favorite
          : false,
    [database]
  )

  const toVariant = useCallback(
    (key: LocationCharacterKey) =>
      getCharEle(database.chars.LocationToCharacterKey(key)),
    [database]
  )

  const values = useMemo(
    () =>
      allLocationCharacterKeys
        .filter((lck) =>
          database.chars.get(database.chars.LocationToCharacterKey(lck))
        )
        .map(
          (v): GeneralAutocompleteOption<LocationCharacterKey> => ({
            key: v,
            label: namesCB(v),
            favorite: isFavorite(v),
            color: toVariant(v),
          })
        )
        .sort((a, b) => {
          if (a.favorite && !b.favorite) return -1
          if (!a.favorite && b.favorite) return 1
          return a.label.localeCompare(b.label)
        }),
    [database.chars, isFavorite, toVariant, namesCB]
  )

  return (
    <Suspense fallback={<Skeleton variant="text" width={100} />}>
      <GeneralAutocompleteMulti
        disabled={disabled}
        options={values}
        valueKeys={locations}
        onChange={(k) => setLocations(k)}
        toImg={toImg}
        toExLabel={toExLabel}
        toExItemLabel={toExItemLabel}
        label={t('artifact:filterLocation.location')}
        size={size}
        chipProps={{ variant: 'outlined', size }}
      />
    </Suspense>
  )
}
