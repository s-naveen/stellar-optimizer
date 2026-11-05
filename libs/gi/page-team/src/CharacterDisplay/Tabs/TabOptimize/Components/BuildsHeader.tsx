import { HitModeToggle, ReactionToggle } from '@genshin-optimizer/gi/ui'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { alpha, Box, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import CompareBtn from '../../../CompareBtn'
import ScalesWith from '../ScalesWith'
import { SettingsCard } from './SettingsCard'

/**
 * Above the generated builds: how many and when, Clear, how damage is shown (hit mode, reaction),
 * what to compare against, and the stats the target scales with.
 */
export function BuildsHeader({
  count,
  buildDate,
  canClear,
  onClear,
}: {
  count: number
  /** 0 or missing when there is no generated list */
  buildDate?: number
  canClear: boolean
  onClear: () => void
}) {
  const { t } = useTranslation('page_character_optimize')
  const summary = count
    ? [
        t('settings.buildCount', { count }),
        buildDate &&
          t('settings.generatedAt', {
            date: new Date(buildDate).toLocaleString(),
          }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('settings.noBuilds')
  return (
    <SettingsCard
      title={t('settings.builds')}
      summary={summary}
      action={
        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<DeleteOutlineIcon />}
          disabled={!canClear}
          onClick={onClear}
          sx={{
            color: 'text.secondary',
            '&:hover': {
              color: 'error.main',
              bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
            },
          }}
        >
          {t('settings.clearBuilds')}
        </Button>
      }
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <HitModeToggle size="small" quiet />
        <ReactionToggle size="small" quiet />
        <Box sx={{ flexGrow: 1 }} />
        <CompareBtn quiet />
      </Box>
      <ScalesWith />
    </SettingsCard>
  )
}
