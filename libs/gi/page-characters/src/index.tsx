import {
  useDataEntryBase,
  useDataManagerKeys,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { useMediaQueryUp } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  EmptyState,
  PageHeader,
  ShowingAndSortOptionSelect,
  useInfScroll,
} from '@genshin-optimizer/common/ui'
import {
  catTotal,
  filterFunction,
  sortFunction,
} from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allCharacterRarityKeys,
  allElementKeys,
  allWeaponTypeKeys,
  isCharacterKey,
} from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import {
  getCharEle,
  getCharStat,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { CharacterSortKey } from '@genshin-optimizer/gi/ui'
import {
  CharacterCard,
  CharacterEditor,
  CharacterRarityToggle,
  CharacterSingleSelectionModal,
  characterFilterConfigs,
  characterSortConfigs,
  characterSortMap,
  ElementToggle,
  useCharSelectionCallback,
  WeaponToggle,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import PeopleIcon from '@mui/icons-material/People'
import {
  Box,
  Button,
  CardContent,
  Grid,
  Skeleton,
  TextField,
} from '@mui/material'
import type { ChangeEvent } from 'react'
import { Suspense, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMatch, useNavigate } from 'react-router-dom'

const numToShowMap = { xs: 5, sm: 8, md: 9, lg: 15, xl: 15 }
const sortKeys = Object.keys(characterSortMap)

export default function PageCharacter() {
  const database = useDatabase()
  const navigate = useNavigate()
  const {
    params: { characterKey: characterKeyRaw },
  } = useMatch({ path: '/characters/:characterKey', end: false }) ?? {
    params: {},
  }
  const characterKey = useMemo(() => {
    if (!characterKeyRaw) return null
    if (!isCharacterKey(characterKeyRaw)) {
      navigate('/characters')
      return null
    }
    const character = database.chars.get(characterKeyRaw)
    if (!character) database.chars.getWithInitWeapon(characterKeyRaw)
    return characterKeyRaw as CharacterKey
  }, [characterKeyRaw, navigate, database])

  const { t } = useTranslation([
    'page_character',
    // Always load these 2 so character names are loaded for searching/sorting
    'charNames_gen',
  ])

  const displayCharacter = useDataEntryBase(database.displayCharacter)

  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearchTerm = useDeferredValue(searchTerm)

  const brPt = useMediaQueryUp()

  const [newCharacter, setnewCharacter] = useState(false)

  // character favorite updater
  const characterMetaDirty = useDataManagerValues(database.charMeta)

  const editCharacter = useCharSelectionCallback()
  const charKeys = useDataManagerKeys(database.chars)
  const totalCharNum = charKeys.length

  const filteredCharKeys = useMemo(() => {
    const { element, weaponType, rarity, sortType, ascending } =
      displayCharacter
    return (
      characterMetaDirty &&
      charKeys
        .filter(
          filterFunction(
            { element, weaponType, rarity, name: deferredSearchTerm },
            characterFilterConfigs(database)
          )
        )
        .sort(
          sortFunction(
            characterSortMap[sortType] ?? [],
            ascending,
            characterSortConfigs(database),
            ['new', 'favorite']
          )
        )
    )
  }, [
    displayCharacter,
    characterMetaDirty,
    charKeys,
    deferredSearchTerm,
    database,
  ])

  const { weaponType, element, rarity, sortType, ascending } = displayCharacter

  const weaponTotals = useMemo(
    () =>
      catTotal(allWeaponTypeKeys, (ct) =>
        Object.entries(database.chars.data).forEach(([ck, char]) => {
          const weapon = database.weapons.get(char.equippedWeapon)
          if (!weapon) return
          const wtk = getWeaponStat(weapon.key).weaponType
          ct[wtk].total++
          if (filteredCharKeys.includes(ck)) ct[wtk].current++
        })
      ),
    [database, filteredCharKeys]
  )

  const elementTotals = useMemo(
    () =>
      catTotal(allElementKeys, (ct) =>
        Object.entries(database.chars.data).forEach(([ck, char]) => {
          const eleKey = getCharEle(char.key)
          ct[eleKey].total++
          if (filteredCharKeys.includes(ck)) ct[eleKey].current++
        })
      ),
    [database, filteredCharKeys]
  )

  const rarityTotals = useMemo(
    () =>
      catTotal(allCharacterRarityKeys, (ct) =>
        Object.entries(database.chars.data).forEach(([ck, char]) => {
          const key = getCharStat(char.key).rarity as 5 | 4
          ct[key].total++
          if (filteredCharKeys.includes(ck)) ct[key].current++
        })
      ),
    [database, filteredCharKeys]
  )

  const { numShow, setTriggerElement } = useInfScroll(
    numToShowMap[brPt],
    filteredCharKeys.length
  )
  const charKeysToShow = useMemo(
    () => filteredCharKeys.slice(0, numShow),
    [filteredCharKeys, numShow]
  )

  const totalShowing =
    filteredCharKeys.length !== totalCharNum
      ? `${filteredCharKeys.length}/${totalCharNum}`
      : `${totalCharNum}`

  const showingTextProps = {
    numShowing: charKeysToShow.length,
    total: totalShowing,
    t: t,
    namespace: 'page_character',
  }

  const sortByButtonProps = {
    sortKeys: [...sortKeys],
    value: sortType,
    onChange: (sortType: CharacterSortKey) => {
      if (sortType !== 'new') database.displayCharacter.set({ sortType })
    },
    ascending: ascending,
    onChangeAsc: (ascending: boolean) =>
      database.displayCharacter.set({ ascending }),
  }

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {characterKey && (
        <CharacterEditor
          characterKey={characterKey}
          onClose={() => navigate('/characters')}
        />
      )}
      <Suspense fallback={false}>
        <CharacterSingleSelectionModal
          newFirst
          show={newCharacter}
          onHide={() => setnewCharacter(false)}
          onSelect={editCharacter}
        />
      </Suspense>
      <PageHeader
        title={t('ui:tabs.characters')}
        count={totalCharNum}
        actions={
          <Button
            sx={giCtaSx}
            startIcon={<AddIcon />}
            onClick={() => setnewCharacter(true)}
          >
            {t('header.add')}
          </Button>
        }
      />
      <CardThemed>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Grid container spacing={1}>
            <Grid item>
              <WeaponToggle
                sx={{ height: '100%' }}
                onChange={(weaponType) =>
                  database.displayCharacter.set({ weaponType })
                }
                value={weaponType}
                totals={weaponTotals}
                size="small"
              />
            </Grid>
            <Grid item>
              <ElementToggle
                sx={{ height: '100%' }}
                onChange={(element) =>
                  database.displayCharacter.set({ element })
                }
                value={element}
                totals={elementTotals}
                size="small"
              />
            </Grid>
            <Grid item>
              <CharacterRarityToggle
                sx={{ height: '100%' }}
                onChange={(rarity) => database.displayCharacter.set({ rarity })}
                value={rarity}
                totals={rarityTotals}
                size="small"
              />
            </Grid>
            <Grid item flexGrow={1} />
            <Grid item>
              <TextField
                autoFocus
                value={searchTerm}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setSearchTerm(e.target.value)
                }
                label={t('characterName')}
                size="small"
                sx={{ height: '100%' }}
                InputProps={{
                  sx: { height: '100%' },
                }}
              />
            </Grid>
          </Grid>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
          >
            <ShowingAndSortOptionSelect
              showingTextProps={showingTextProps}
              sortByButtonProps={sortByButtonProps}
            />
          </Box>
        </CardContent>
      </CardThemed>
      {totalCharNum === 0 && (
        <EmptyState
          icon={<PeopleIcon />}
          title={t('page_character:empty.title')}
          description={t('page_character:empty.description')}
          actions={
            <Button
              onClick={() => setnewCharacter(true)}
              startIcon={<AddIcon />}
            >
              {t('page_character:empty.add')}
            </Button>
          }
        />
      )}
      <Suspense
        fallback={
          <Skeleton
            variant="rectangular"
            sx={{ width: '100%', height: '100%', minHeight: 5000 }}
          />
        }
      >
        {/* as many ~280px cards per row as fit (5 on a 1536px window) */}
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 1, md: 1.5 },
            gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))',
          }}
        >
          {charKeysToShow.map((charKey) => (
            <CharacterCard
              key={charKey}
              characterKey={charKey}
              onClick={() => navigate(`${charKey}`)}
              hideStats
            />
          ))}
        </Box>
      </Suspense>
      {filteredCharKeys.length !== charKeysToShow.length && (
        <Skeleton
          ref={(node) => {
            if (!node) return
            setTriggerElement(node)
          }}
          sx={{ borderRadius: 1 }}
          variant="rectangular"
          width="100%"
          height={100}
        />
      )}
    </Box>
  )
}
