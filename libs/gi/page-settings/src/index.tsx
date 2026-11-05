import { LocalStorageUsageCard } from '@genshin-optimizer/common/react-util'
import { PageHeader } from '@genshin-optimizer/common/ui'
import { DatabaseCard } from '@genshin-optimizer/gi/ui'
import { Box, Grid } from '@mui/material'
import { useTranslation } from 'react-i18next'
import LanguageCard from './LanguageCard'
import { SnowToggle } from './SnowToggle'

export default function PageSettings() {
  const { t } = useTranslation('ui')

  return (
    <Box display="flex" flexDirection="column" gap={2} sx={{ mb: 1 }}>
      <PageHeader title={t('tabs.setting')} />
      {/* Preferences */}
      <Grid container spacing={1}>
        <Grid item xs={12} sm={6}>
          <LanguageCard />
        </Grid>
        <Grid item xs={12} sm={6}>
          <SnowToggle />
        </Grid>
      </Grid>
      <DatabaseCard />
      <LocalStorageUsageCard />
    </Box>
  )
}
