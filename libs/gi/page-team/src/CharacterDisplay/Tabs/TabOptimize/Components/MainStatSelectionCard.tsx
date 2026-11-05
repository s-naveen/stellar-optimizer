import {
  BootstrapTooltip,
  filterToggleValue,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import { bulkCatTotal, handleMultiSelect } from '@genshin-optimizer/common/util'
import {
  allElementWithPhyKeys,
  artSlotMainKeys,
} from '@genshin-optimizer/gi/consts'
import {
  TeamCharacterContext,
  useDatabase,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import {
  AtkIcon,
  FlowerIcon,
  HpIcon,
  PlumeIcon,
  SlotIcon,
  StatIcon,
} from '@genshin-optimizer/gi/svgicons'
import { StatColoredWithUnit } from '@genshin-optimizer/gi/ui'
import { Box, ToggleButton, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const artifactsSlotsToSelectMainStats = ['sands', 'goblet', 'circlet'] as const

export default function MainStatSelectionCard({
  disabled = false,
  filteredArtIdMap,
}: {
  disabled?: boolean
  filteredArtIdMap: Record<string, boolean>
}) {
  const { t } = useTranslation('artifact')
  const {
    teamChar: { optConfigId },
  } = useContext(TeamCharacterContext)
  const { mainStatKeys } = useOptConfig(optConfigId)!
  const database = useDatabase()
  const { mainStatSlotTots, slotTots } = useMemo(() => {
    const catKeys = {
      flowerMainStatTots: artSlotMainKeys['flower'],
      plumeMainStatTots: artSlotMainKeys['plume'],
      sandsMainStatTots: artSlotMainKeys['sands'],
      gobletMainStatTots: artSlotMainKeys['goblet'],
      circletMainStatTots: artSlotMainKeys['circlet'],
      slotTots: artifactsSlotsToSelectMainStats,
    } as const
    const catTotals = bulkCatTotal(catKeys, (ctMap) =>
      database.arts.entries.forEach(([id, art]) => {
        const { slotKey, mainStatKey } = art
        if (
          (artifactsSlotsToSelectMainStats as readonly string[]).includes(
            slotKey
          )
        ) {
          ctMap.slotTots[slotKey].total++
          if (filteredArtIdMap[id]) ctMap.slotTots[slotKey].current++
        }
        ctMap[`${slotKey}MainStatTots`][mainStatKey].total++
        if (filteredArtIdMap[id])
          ctMap[`${slotKey}MainStatTots`][mainStatKey].current++
      })
    )
    return {
      mainStatSlotTots: {
        flower: catTotals.flowerMainStatTots,
        plume: catTotals.plumeMainStatTots,
        sands: catTotals.sandsMainStatTots,
        goblet: catTotals.gobletMainStatTots,
        circlet: catTotals.circletMainStatTots,
      },
      slotTots: catTotals.slotTots,
    }
  }, [database, filteredArtIdMap])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* flower and plume have a fixed main stat: just how many are in the filtered pool */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          color: 'text.secondary',
          fontSize: '0.8125rem',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <FixedMainStat
          slotIcon={<FlowerIcon fontSize="inherit" />}
          statIcon={<HpIcon fontSize="inherit" />}
          label={t('slotName.flower')}
          count={mainStatSlotTots.flower.hp}
        />
        <FixedMainStat
          slotIcon={<PlumeIcon fontSize="inherit" />}
          statIcon={<AtkIcon fontSize="inherit" />}
          label={t('slotName.plume')}
          count={mainStatSlotTots.plume.atk}
        />
      </Box>
      {artifactsSlotsToSelectMainStats.map((slotKey) => {
        const selectedMainKeys = mainStatKeys[slotKey]
        const mainKeys = artSlotMainKeys[slotKey]
        const mainKeysHandler = handleMultiSelect([...mainKeys])
        return (
          <Box key={slotKey}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                mb: 0.75,
                color: 'text.secondary',
              }}
            >
              <SlotIcon slotKey={slotKey} iconProps={{ fontSize: 'small' }} />
              <Typography variant="body2">
                {t(`slotName.${slotKey}`)}
              </Typography>
              <Typography
                variant="body2"
                sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
              >
                {slotTots[slotKey]}
              </Typography>
            </Box>
            <SolidToggleButtonGroup
              quiet
              size="small"
              value={filterToggleValue(selectedMainKeys, mainKeys)}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              }}
            >
              {mainKeys.map((mainStatKey) => {
                const element = allElementWithPhyKeys.find((ele) =>
                  mainStatKey.includes(ele)
                )
                return (
                  <BootstrapTooltip
                    key={mainStatKey}
                    placement="top"
                    // a disabled button gets no hover anyway (and MUI warns about it)
                    title={
                      disabled ? (
                        ''
                      ) : (
                        <Typography>
                          <strong>
                            <StatColoredWithUnit statKey={mainStatKey} />
                          </strong>
                        </Typography>
                      )
                    }
                    disableInteractive
                  >
                    <ToggleButton
                      value={mainStatKey}
                      disabled={disabled}
                      onClick={() =>
                        database.optConfigs.set(optConfigId, {
                          mainStatKeys: {
                            ...mainStatKeys,
                            [slotKey]: mainKeysHandler(
                              selectedMainKeys,
                              mainStatKey
                            ),
                          },
                        })
                      }
                    >
                      <StatIcon
                        statKey={mainStatKey}
                        iconProps={{
                          sx: {
                            fontSize: 16,
                            color: element ? `${element}.main` : undefined,
                          },
                        }}
                      />
                      <ToggleButtonCount>
                        {mainStatSlotTots[slotKey][mainStatKey]}
                      </ToggleButtonCount>
                    </ToggleButton>
                  </BootstrapTooltip>
                )
              })}
            </SolidToggleButtonGroup>
          </Box>
        )
      })}
    </Box>
  )
}

function FixedMainStat({
  slotIcon,
  statIcon,
  label,
  count,
}: {
  slotIcon: ReactNode
  statIcon: ReactNode
  label: ReactNode
  count: ReactNode
}) {
  return (
    <BootstrapTooltip placement="top" title={<Typography>{label}</Typography>}>
      <Box
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        {slotIcon}
        {statIcon}
        {count}
      </Box>
    </BootstrapTooltip>
  )
}
