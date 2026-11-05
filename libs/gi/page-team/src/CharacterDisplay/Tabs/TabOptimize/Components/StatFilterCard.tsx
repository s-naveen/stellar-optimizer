import type { StatFilters } from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useDatabase,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import { Box, Typography } from '@mui/material'
import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import OptimizationTargetEditorList from './OptimizationTargetEditorList'
import { SettingsCard } from './SettingsCard'

export default function StatFilterCard({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { t } = useTranslation('page_character_optimize')
  const {
    teamChar: { optConfigId },
  } = useContext(TeamCharacterContext)
  const { statFilters } = useOptConfig(optConfigId)!
  const database = useDatabase()
  const setStatFilters = useCallback(
    (statFilters: StatFilters) =>
      database.optConfigs.set(optConfigId, { statFilters }),
    [database, optConfigId]
  )

  return (
    <SettingsCard
      title={t('constraintFilter.title')}
      info={<Typography>{t('constraintFilter.tooltip')}</Typography>}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <OptimizationTargetEditorList
          statFilters={statFilters}
          setStatFilters={setStatFilters}
          disabled={disabled}
        />
      </Box>
    </SettingsCard>
  )
}
