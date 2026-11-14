import {
  BootstrapTooltip,
  InfoTooltipInline,
} from '@genshin-optimizer/common/ui'
import { artifactAsset } from '@genshin-optimizer/gi/assets'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KqmBuild } from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  ArtifactSetTooltip,
  kqmArtifactStats,
  kqmWeaponData,
  statName,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { TooltipProps } from '@mui/material'
import { Box, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { mainStatLabel } from './format'
import { WeaponDetails, WeaponThumb } from './TeamOptResults'
import { hairline, numSx, type } from './ui'

const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
export const artifactStatValue = (key: string, value: number) =>
  key.endsWith('_')
    ? `${(value * 100).toFixed(1)}%`
    : numberFormat.format(value)

export function KqmBuildView({
  characterKey,
  build,
  equipment,
}: {
  characterKey: CharacterKey
  build: KqmBuild
  equipment?: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const weapon = kqmWeaponData(build.weapon, characterKey)
  const order = [
    'critRate_',
    'critDMG_',
    'enerRech_',
    'eleMas',
    build.mains.goblet.endsWith('_dmg_') ? build.mains.goblet : 'heal_',
    'atk_',
    'atk',
    'hp_',
    'hp',
    'def_',
    'def',
  ]
  const stats = kqmArtifactStats(build).sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key)
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {equipment ?? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BootstrapTooltip title={<WeaponDetails weapon={weapon} />}>
            <Box>
              <WeaponThumb weapon={weapon} highlight={false} />
            </Box>
          </BootstrapTooltip>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              <WeaponName weaponKey={weapon.key} />
            </Typography>
            <SetLines sets={build.sets} />
          </Box>
        </Box>
      )}
      {/* the three main stats that are chosen: one aligned row each */}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>
          {t('teamOpt.kqm.mainStats', 'Main stats')}
        </Typography>
        {(['sands', 'goblet', 'circlet'] as const).map((slot, i) => (
          <Box
            key={slot}
            sx={{
              display: 'grid',
              gridTemplateColumns: '64px minmax(0, 1fr) auto',
              alignItems: 'baseline',
              columnGap: 1,
              py: 0.75,
              borderTop: i ? hairline : undefined,
            }}
          >
            <Typography sx={{ ...type.label, fontSize: 12 }}>
              {t(`teamOpt.kqm.${slot}`)}
            </Typography>
            <Typography sx={{ fontSize: 13.5, minWidth: 0, lineHeight: 1.4 }}>
              {mainStatLabel(build.mains[slot])}
            </Typography>
            <Typography
              sx={{
                fontSize: 14,
                fontWeight: 600,
                textAlign: 'right',
                ...numSx,
              }}
            >
              {artifactStatValue(
                build.mains[slot],
                getMainStatValue(build.mains[slot], 5, 20)
              )}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box
        component="section"
        aria-label={t('teamOpt.kqm.artifactTotals', 'Artifact totals')}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {t('teamOpt.kqm.artifactTotals', 'Artifact totals')}
          </Typography>
          <InfoTooltipInline
            title={t(
              'teamOpt.kqm.artifactTotalsTip',
              'Main stats, fixed and distributed rolls from all five artifacts. Excludes weapon, character and set bonuses.'
            )}
          />
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: 2.5,
          }}
        >
          {stats.map(({ key, total, main, fixed, distributed, rolls }, i) => (
            <Tooltip
              key={key}
              arrow
              title={
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    columnGap: 2,
                    rowGap: 0.5,
                    ...numSx,
                  }}
                >
                  <span>{t('teamOpt.kqm.mainStats', 'Main stats')}</span>
                  <span>{artifactStatValue(key, main)}</span>
                  <span>{t('teamOpt.kqm.fixedRolls', 'Fixed rolls')}</span>
                  <span>{artifactStatValue(key, fixed)}</span>
                  <span>
                    {t('teamOpt.kqm.distributedRolls', 'Distributed rolls')} (
                    {rolls})
                  </span>
                  <span>{artifactStatValue(key, distributed)}</span>
                </Box>
              }
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  columnGap: 1,
                  py: 0.75,
                  minWidth: 0,
                  cursor: 'help',
                  borderTop: i >= 2 ? hairline : undefined,
                }}
              >
                <Typography
                  sx={{
                    ...type.label,
                    fontSize: 12,
                    lineHeight: 1.4,
                    minWidth: 0,
                  }}
                >
                  {statName(key)}
                  {['hp_', 'atk_', 'def_'].includes(key) ? '%' : ''}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    ...numSx,
                  }}
                >
                  +{artifactStatValue(key, total)}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export function SetLines({
  sets,
  tooltipPlacement,
}: {
  sets: KqmBuild['sets']
  /** Where the sets' tooltips open (default: above) */
  tooltipPlacement?: TooltipProps['placement']
}) {
  const { t } = useTranslation('page_team')
  if (!Object.keys(sets).length)
    return (
      <Typography
        component="span"
        sx={{ fontSize: 13, color: 'text.secondary' }}
      >
        {t('teamOpt.kqm.noSetBonus', 'No set bonus')}
      </Typography>
    )
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 1.25,
        rowGap: 0.25,
        minWidth: 0,
      }}
    >
      {(Object.entries(sets) as [ArtifactSetKey, number][]).map(
        ([setKey, n]) => (
          <ArtifactSetTooltip
            key={setKey}
            setKey={setKey}
            numInSet={n}
            placement={tooltipPlacement}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                component="img"
                src={artifactAsset(setKey, 'flower')}
                alt=""
                sx={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <Typography component="span" sx={{ fontSize: 13 }}>
                <Box
                  component="span"
                  sx={{ color: 'text.secondary', ...numSx }}
                >
                  {n}×
                </Box>{' '}
                <ArtifactSetName setKey={setKey} />
              </Typography>
            </Box>
          </ArtifactSetTooltip>
        )
      )}
    </Box>
  )
}
