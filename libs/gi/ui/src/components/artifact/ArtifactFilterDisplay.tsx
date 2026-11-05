import {
  BootstrapTooltip,
  FilterGrid,
  FilterGroup,
  filterToggleValue,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import {
  bulkCatTotal,
  handleMultiSelect,
  objKeyMap,
} from '@genshin-optimizer/common/util'
import {
  allArtifactRarityKeys,
  allArtifactSetKeys,
  allArtifactSlotKeys,
  allLocationCharacterKeys,
  allMainStatKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import { useDatabase, useDisplayArtifact } from '@genshin-optimizer/gi/db-ui'
import type { FilterOption } from '@genshin-optimizer/gi/schema'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import PersonSearchIcon from '@mui/icons-material/PersonSearch'
import { Box, ToggleButton, Typography } from '@mui/material'
import { Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ExcludeIcon, OptimizationIcon } from '../../consts'
import { LocationFilterMultiAutocomplete } from '../character/LocationFilterMultiAutocomplete'
import { SubstatMultiAutocomplete } from '../SubstatMultiAutocomplete'
import { ArtifactSlotToggle, QuietStars } from '../toggles'
import { ArtifactMainStatMultiAutocomplete } from './ArtifactMainStatMultiAutocomplete'
import { ArtifactSetMultiAutocomplete } from './ArtifactSetMultiAutocomplete'
import { RangeFilterRow } from './RangeFilterRow'
import { SubstatToggle } from './SubstatToggle'

const lockedValues = ['locked', 'unlocked'] as const
const excludedValues = ['excluded', 'included'] as const

const rarityHandler = handleMultiSelect([...allArtifactRarityKeys])
const lockedHandler = handleMultiSelect([...lockedValues])
const lineKeys = [1, 2, 3, 4] as const
const lineHandler = handleMultiSelect<number>([...lineKeys])
const excludedHandler = handleMultiSelect([...excludedValues])

interface ArtifactFilterDisplayProps {
  filterOption: FilterOption
  filterOptionDispatch: (option: Partial<FilterOption>) => void
  disableSlotFilter?: boolean
  filteredIds: string[]
  enableExclusionFilter?: boolean
  excludedIds?: string[]
}
export function ArtifactFilterDisplay({
  filterOption,
  filterOptionDispatch,
  filteredIds,
  disableSlotFilter = false,
  enableExclusionFilter = false,
  excludedIds = [],
}: ArtifactFilterDisplayProps) {
  const { t } = useTranslation(['artifact', 'ui'])

  const filteredIdMap = useMemo(
    () => objKeyMap(filteredIds, (_) => true),
    [filteredIds]
  )

  const {
    artSetKeys = [],
    mainStatKeys = [],
    rarity = [],
    slotKeys = [],
    levelLow = 0,
    levelHigh = 20,
    substats = [],
    locations,
    showEquipped,
    showInventory,
    locked = [...lockedValues],
    rvLow = 0,
    rvHigh = 900,
    useMaxRV = false,
    lines = [],
    excluded = [...excludedValues],
  } = filterOption

  const database = useDatabase()

  const {
    rarityTotal,
    slotTotal,
    lockedTotal,
    linesTotal,
    equippedTotal,
    setTotal,
    mainStatTotal,
    subStatTotal,
    locationTotal,
    excludedTotal,
  } = useMemo(() => {
    const catKeys = {
      rarityTotal: allArtifactRarityKeys,
      slotTotal: allArtifactSlotKeys,
      lockedTotal: ['locked', 'unlocked'],
      linesTotal: [0, 1, 2, 3, 4],
      equippedTotal: ['equipped', 'unequipped'],
      setTotal: allArtifactSetKeys,
      mainStatTotal: allMainStatKeys,
      subStatTotal: allSubstatKeys,
      locationTotal: [...allLocationCharacterKeys, ''],
      excludedTotal: ['excluded', 'included'],
    } as const
    return bulkCatTotal(catKeys, (ctMap) =>
      database.arts.entries.forEach(([id, art]) => {
        const { rarity, slotKey, location, setKey, mainStatKey, substats } = art
        const lock = art.lock ? 'locked' : 'unlocked'
        const lns = art.substats.filter((s) => s.value).length
        const equipped = location ? 'equipped' : 'unequipped'
        const excluded = excludedIds.includes(id) ? 'excluded' : 'included'
        // The slot filter is disabled during artifact swapping, in which case our artifact total displayed by
        // the filter should reflect only the slot being swapped.
        if (!disableSlotFilter || art.slotKey === filterOption.slotKeys[0]) {
          ctMap['rarityTotal'][rarity].total++
          ctMap['slotTotal'][slotKey].total++
          ctMap['lockedTotal'][lock].total++
          ctMap['linesTotal'][lns].total++
          ctMap['equippedTotal'][equipped].total++
          ctMap['setTotal'][setKey].total++
          ctMap['mainStatTotal'][mainStatKey].total++
          substats.forEach((sub) => {
            const subKey = sub.key
            if (!subKey) return
            ctMap['subStatTotal'][subKey].total++
            if (filteredIdMap[id]) ctMap['subStatTotal'][subKey].current++
          })
          ctMap['locationTotal'][location].total++
          ctMap['excludedTotal'][excluded].total++
        }

        if (filteredIdMap[id]) {
          ctMap['rarityTotal'][rarity].current++
          ctMap['slotTotal'][slotKey].current++
          ctMap['lockedTotal'][lock].current++
          ctMap['linesTotal'][lns].current++
          ctMap['equippedTotal'][equipped].current++
          ctMap['setTotal'][setKey].current++
          ctMap['mainStatTotal'][mainStatKey].current++
          // substats handled above
          ctMap['locationTotal'][location].current++
          ctMap['excludedTotal'][excluded].current++
        }
      })
    )
  }, [database, disableSlotFilter, excludedIds, filteredIdMap, filterOption])

  const { effFilter } = useDisplayArtifact()

  const equippedValue = [
    ...(showInventory ? ['unequipped'] : []),
    ...(showEquipped ? ['equipped'] : []),
  ]

  return (
    <FilterGrid
      narrowAreas={'"artifact" "stats" "inventory" "rv"'}
      wideAreas={'"artifact inventory" "stats rv"'}
      xwideAreas={'"artifact inventory stats rv"'}
    >
      <FilterGroup area="artifact" title={t('filters.groups.artifact')}>
        <RangeFilterRow
          label={t('levelSliderTitle')}
          low={levelLow}
          high={levelHigh}
          min={0}
          max={20}
          marks
          setLow={(levelLow) => filterOptionDispatch({ levelLow })}
          setHigh={(levelHigh) => filterOptionDispatch({ levelHigh })}
          setBoth={(levelLow, levelHigh) =>
            filterOptionDispatch({ levelLow, levelHigh })
          }
        />
        <SolidToggleButtonGroup
          quiet
          fullWidth
          size="small"
          value={filterToggleValue(rarity, allArtifactRarityKeys)}
        >
          {allArtifactRarityKeys.map((star) => (
            <ToggleButton
              key={star}
              value={star}
              onClick={() =>
                filterOptionDispatch({ rarity: rarityHandler(rarity, star) })
              }
            >
              <QuietStars stars={star} />
              <ToggleButtonCount>{rarityTotal[star]}</ToggleButtonCount>
            </ToggleButton>
          ))}
        </SolidToggleButtonGroup>
        <SolidToggleButtonGroup
          quiet
          fullWidth
          size="small"
          value={filterToggleValue(lines, lineKeys)}
        >
          {lineKeys.map((line) => (
            <ToggleButton
              key={line}
              value={line}
              onClick={() =>
                filterOptionDispatch({
                  lines: lineHandler(lines, line) as Array<1 | 2 | 3 | 4>,
                })
              }
            >
              <span>{t('sub', { count: line })}</span>
              <ToggleButtonCount>{linesTotal[line]}</ToggleButtonCount>
            </ToggleButton>
          ))}
        </SolidToggleButtonGroup>
        <ArtifactSlotToggle
          quiet
          disabled={disableSlotFilter}
          onChange={(slotKeys) => filterOptionDispatch({ slotKeys })}
          totals={slotTotal}
          value={slotKeys}
        />
      </FilterGroup>

      <FilterGroup area="stats" title={t('filters.groups.stats')}>
        <ArtifactSetMultiAutocomplete
          size="small"
          totals={setTotal}
          artSetKeys={artSetKeys}
          setArtSetKeys={(artSetKeys) => filterOptionDispatch({ artSetKeys })}
        />
        <ArtifactMainStatMultiAutocomplete
          size="small"
          totals={mainStatTotal}
          mainStatKeys={mainStatKeys}
          setMainStatKeys={(mainStatKeys) =>
            filterOptionDispatch({ mainStatKeys })
          }
        />
        <SubstatMultiAutocomplete
          size="small"
          totals={subStatTotal}
          substatKeys={substats}
          setSubstatKeys={(substats) => filterOptionDispatch({ substats })}
          allSubstatKeys={[...allSubstatKeys]}
        />
      </FilterGroup>

      <FilterGroup area="inventory" title={t('subheadings.inventory')}>
        <SolidToggleButtonGroup
          quiet
          fullWidth
          size="small"
          value={filterToggleValue(locked, lockedValues)}
        >
          {lockedValues.map((v) => (
            <ToggleButton
              key={v}
              value={v}
              onClick={() =>
                filterOptionDispatch({ locked: lockedHandler(locked, v) })
              }
            >
              {v === 'locked' ? (
                <LockIcon fontSize="small" />
              ) : (
                <LockOpenIcon fontSize="small" />
              )}
              <span>{t(`ui:${v}`)}</span>
              <ToggleButtonCount>{lockedTotal[v]}</ToggleButtonCount>
            </ToggleButton>
          ))}
        </SolidToggleButtonGroup>
        {enableExclusionFilter && (
          <SolidToggleButtonGroup
            quiet
            fullWidth
            size="small"
            value={filterToggleValue(excluded, excludedValues)}
          >
            {excludedValues.map((v) => (
              <ToggleButton
                key={v}
                value={v}
                onClick={() =>
                  filterOptionDispatch({
                    excluded: excludedHandler(excluded, v),
                  })
                }
              >
                {v === 'excluded' ? (
                  <ExcludeIcon fontSize="small" />
                ) : (
                  <OptimizationIcon fontSize="small" />
                )}
                <span>{t(`ui:${v}`)}</span>
                <ToggleButtonCount>{excludedTotal[v]}</ToggleButtonCount>
              </ToggleButton>
            ))}
          </SolidToggleButtonGroup>
        )}
        <SolidToggleButtonGroup
          quiet
          fullWidth
          size="small"
          value={equippedValue}
        >
          <ToggleButton
            value="unequipped"
            onClick={() =>
              filterOptionDispatch({ showInventory: !showInventory })
            }
          >
            <BusinessCenterIcon fontSize="small" />
            <span>{t('filters.unequipped')}</span>
            <ToggleButtonCount>{equippedTotal['unequipped']}</ToggleButtonCount>
          </ToggleButton>
          <ToggleButton
            value="equipped"
            onClick={() =>
              filterOptionDispatch({ showEquipped: !showEquipped })
            }
          >
            <PersonSearchIcon fontSize="small" />
            <span>{t('filters.equipped')}</span>
            <ToggleButtonCount>{equippedTotal['equipped']}</ToggleButtonCount>
          </ToggleButton>
        </SolidToggleButtonGroup>
        <Suspense fallback={null}>
          <BootstrapTooltip
            title={showEquipped ? t('locationsTooltip') : ''}
            placement="top"
          >
            <span>
              <LocationFilterMultiAutocomplete
                size="small"
                totals={locationTotal}
                locations={showEquipped ? [] : locations}
                setLocations={(locations) =>
                  filterOptionDispatch({ locations })
                }
                disabled={showEquipped}
              />
            </span>
          </BootstrapTooltip>
        </Suspense>
      </FilterGroup>

      <FilterGroup
        area="rv"
        title={t('subheadings.rollvalue')}
        action={
          <SolidToggleButtonGroup
            quiet
            exclusive
            size="small"
            value={useMaxRV ? 'max' : 'current'}
            onChange={(_e, value: string | null) =>
              value && filterOptionDispatch({ useMaxRV: value === 'max' })
            }
            aria-label={t('filters.rvType')}
            sx={{
              '& .MuiToggleButtonGroup-grouped': {
                minHeight: 26,
                px: 1.25,
                fontSize: '0.75rem',
              },
            }}
          >
            <ToggleButton value="current">
              {t('filters.rvCurrent')}
            </ToggleButton>
            <ToggleButton value="max">{t('filters.rvMax')}</ToggleButton>
          </SolidToggleButtonGroup>
        }
      >
        <RangeFilterRow
          label={useMaxRV ? t('rvSliderBtn.maximum') : t('rvSliderBtn.current')}
          low={rvLow}
          high={rvHigh}
          min={0}
          max={900}
          setLow={(rvLow) => filterOptionDispatch({ rvLow })}
          setHigh={(rvHigh) => filterOptionDispatch({ rvHigh })}
          setBoth={(rvLow, rvHigh) => filterOptionDispatch({ rvLow, rvHigh })}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {t('efficiencyFilter.title')}
          </Typography>
          <SubstatToggle
            quiet
            selectedKeys={effFilter}
            onChange={(n) => database.displayArtifact.set({ effFilter: n })}
          />
        </Box>
      </FilterGroup>
    </FilterGrid>
  )
}
