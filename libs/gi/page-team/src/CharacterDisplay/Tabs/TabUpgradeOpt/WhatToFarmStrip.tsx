import { CardThemed } from '@genshin-optimizer/common/ui'
import { getUnitStr } from '@genshin-optimizer/common/util'
import type { MainStatKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import { TeamCharacterContext } from '@genshin-optimizer/gi/db-ui'
import type { MainStatValueResult } from '@genshin-optimizer/gi/ui'
import { statName } from '@genshin-optimizer/gi/ui'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import UpgradeIcon from '@mui/icons-material/Upgrade'
import { Box, Button, Skeleton, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { useStatValues } from './SubstatValueCard'

/** A stat's name (in the current language) with its unit, e.g. "CRIT Rate%" */
const statLabel = (key: SubstatKey | MainStatKey) =>
  `${statName(key)}${getUnitStr(key)}`

/**
 * The Overview's one-line answer to "what should I farm for this build?": the substats worth
 * the most per roll, and per sands / goblet / circlet whether to keep the main stat or which one
 * is better (exact values, as on the Improve tab, which has the details).
 */
export function WhatToFarmStrip() {
  const { t } = useTranslation('page_character_optimize')
  const { loadoutDatum } = useContext(TeamCharacterContext)
  // later than the Improve tab's card: never in the way of the Overview's own rendering
  const { result, optimizationTarget } = useStatValues({ delay: 300 })
  if (loadoutDatum.buildType === 'tc') return null
  return (
    <CardThemed bgt="light" sx={{ px: 1.5, py: 1, flexShrink: 0 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2.5,
          rowGap: 0.5,
          minHeight: 28,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            color: 'text.secondary',
          }}
        >
          <UpgradeIcon fontSize="small" />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('farm.title', 'What to farm')}
          </Typography>
        </Box>
        {!optimizationTarget ? (
          <Typography variant="body2" color="text.secondary">
            {t(
              'farm.noTarget',
              'Pick an optimization target to see which stats to farm.'
            )}
          </Typography>
        ) : result === undefined ? (
          <Skeleton variant="text" sx={{ flex: '1 1 240px', maxWidth: 480 }} />
        ) : !result ? (
          <Typography variant="body2" color="text.secondary">
            {t(
              'substatValue.unavailable',
              'Substat value is not available for this target.'
            )}
          </Typography>
        ) : (
          <>
            {!!result.sub?.gains.length && (
              <Item label={t('farm.substats', 'Substats')}>
                {result.sub.gains
                  .filter((g) => g.one > 0)
                  .slice(0, 3)
                  .map((g) => statLabel(g.key))
                  .join(' > ')}
              </Item>
            )}
            {result.main?.slots.map((slot) => (
              <MainStatVerdict
                key={slot.slotKey}
                slot={slot}
                base={result.main!.base}
              />
            ))}
          </>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          color="inherit"
          component={RouterLink}
          to={optimizationTarget ? 'upopt' : 'optimize'}
          endIcon={<ArrowForwardIcon />}
          sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          {optimizationTarget
            ? t('farm.openImprove', 'Open Improve')
            : t('farm.openOptimize', 'Open Optimize')}
        </Button>
      </Box>
    </CardThemed>
  )
}

function Item({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Typography variant="body2" component="span" sx={{ whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {label}:{' '}
      </Box>
      {children}
    </Typography>
  )
}

/** "Sands: keep ATK%", or "Goblet: Cryo DMG Bonus% +3.10%" when another main stat beats it */
function MainStatVerdict({
  slot: { slotKey, current, options },
  base,
}: {
  slot: MainStatValueResult['slots'][number]
  base: number
}) {
  const { t } = useTranslation('page_character_optimize')
  const label = {
    sands: t('farm.sands', 'Sands'),
    goblet: t('farm.goblet', 'Goblet'),
    circlet: t('farm.circlet', 'Circlet'),
  }[slotKey]
  const best = options[0]
  const share = base > 0 ? (best.gain / base) * 100 : 0
  const keep = current && (best.current || share < 0.05)
  return (
    <Item label={label}>
      {keep ? (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {t('farm.keep', {
            defaultValue: 'keep {{stat}}',
            stat: statLabel(current.statKey),
          })}
        </Box>
      ) : (
        <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
          {statLabel(best.key)}
          {share >= 0.05 && ` +${share.toFixed(2)}%`}
          {!current && (
            <Box
              component="span"
              sx={{ color: 'text.secondary', fontWeight: 400 }}
            >
              {' '}
              {t('statValue.emptySlot', '(empty)')}
            </Box>
          )}
        </Box>
      )}
    </Item>
  )
}
