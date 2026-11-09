import { ChangelogDialog, currentRelease } from '@genshin-optimizer/gi/ui'
import GitHubIcon from '@mui/icons-material/GitHub'
import LocalCafeOutlinedIcon from '@mui/icons-material/LocalCafeOutlined'
import { AppBar, Box, Link, Skeleton, Typography } from '@mui/material'
import { Suspense, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const GITHUB_URL = 'https://github.com/s-naveen/stellar-optimizer'
const BUY_ME_A_COFFEE_URL = 'https://www.buymeacoffee.com/neevans'
/** Buy Me a Coffee's yellow, kept to the cup and the outline so the footer stays quiet */
const COFFEE = '#FFDD00'

export default function Footer() {
  return (
    <Suspense fallback={<Skeleton variant="rectangular" height={64} />}>
      <FooterContent />
    </Suspense>
  )
}
function FooterContent() {
  const { t } = useTranslation('ui')
  const [changelogOpen, setChangelogOpen] = useState(false)
  return (
    <AppBar
      component="footer"
      position="static"
      sx={{ bgcolor: 'neutral800.main' }}
      elevation={0}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          columnGap: 2,
          rowGap: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
          <Trans t={t} i18nKey="ui:rightsDisclaimer">
            Stellar Optimizer is not affiliated with or endorsed by HoYoverse.
          </Trans>
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.5,
          }}
        >
          <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
            {/* plain links (not hash routes) to the static pages made for search engines */}
            <Link href="optimizers/" color="inherit" underline="hover">
              {t('characterOptimizers')}
            </Link>
            {' · '}
            <Link href="faq/" color="inherit" underline="hover">
              {t('faq')}
            </Link>
          </Typography>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            underline="none"
            variant="caption"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'neutral400.main',
              transition: 'color 120ms',
              '&:hover': { color: 'neutral300.main' },
            }}
          >
            <GitHubIcon sx={{ fontSize: 14 }} />
            {t('github', 'GitHub')}
          </Link>
          {/* this build's version: opens the changelog */}
          <Link
            component="button"
            type="button"
            onClick={() => setChangelogOpen(true)}
            underline="none"
            variant="caption"
            title={t('changelog.open', 'Changelog')}
            sx={{
              color: 'neutral400.main',
              fontVariantNumeric: 'tabular-nums',
              transition: 'color 120ms',
              '&:hover': { color: 'neutral300.main' },
            }}
          >
            v{currentRelease.version}
          </Link>
          <Link
            href={BUY_ME_A_COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            underline="none"
            variant="caption"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.25,
              borderRadius: 999,
              border: `1px solid ${COFFEE}47`,
              color: 'neutral300.main',
              lineHeight: 1.6,
              transition:
                'color 120ms, border-color 120ms, background-color 120ms',
              '&:hover': {
                color: COFFEE,
                borderColor: `${COFFEE}99`,
                bgcolor: `${COFFEE}14`,
              },
            }}
          >
            <LocalCafeOutlinedIcon sx={{ fontSize: 14, color: COFFEE }} />
            {t('buyMeACoffee', 'Buy me a coffee')}
          </Link>
        </Box>
      </Box>
      <ChangelogDialog
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />
    </AppBar>
  )
}
