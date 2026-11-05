import { AppBar, Box, Skeleton, Typography } from '@mui/material'
import { Suspense } from 'react'
import { Trans, useTranslation } from 'react-i18next'

export default function Footer() {
  return (
    <Suspense fallback={<Skeleton variant="rectangular" height={64} />}>
      <FooterContent />
    </Suspense>
  )
}
function FooterContent() {
  const { t } = useTranslation('ui')
  return (
    <AppBar
      component="footer"
      position="static"
      sx={{ bgcolor: 'neutral800.main' }}
      elevation={0}
    >
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
          <Trans t={t} i18nKey="ui:rightsDisclaimer">
            Stellar Optimizer is not affiliated with or endorsed by HoYoverse.
          </Trans>
        </Typography>
      </Box>
    </AppBar>
  )
}
