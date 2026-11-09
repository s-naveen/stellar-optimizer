import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
  Box,
  CardContent,
  Divider,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../changelog'
import { RELEASES_URL, releases, releaseUrl } from '../../changelog'

/** "9 Nov 2026" in the reader's language (the date is a plain YYYY-MM-DD, no time zone shift) */
export function releaseDate(date: string, language?: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** One release: version, date and its notes, grouped (new, improved, fixed) */
export function ReleaseNotes({
  release,
  headingLevel = 'h3',
}: {
  release: Release
  headingLevel?: 'h2' | 'h3'
}) {
  const { t, i18n } = useTranslation('ui')
  const groups = [
    [t('changelog.new', 'New'), release.new],
    [t('changelog.improved', 'Improved'), release.improved],
    [t('changelog.fixed', 'Fixed'), release.fixed],
  ] as const
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          columnGap: 1,
        }}
      >
        <Typography variant="subtitle1" component={headingLevel}>
          <Link
            href={releaseUrl(release.version)}
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
            underline="hover"
            sx={{ fontWeight: 600 }}
          >
            v{release.version}
          </Link>
        </Typography>
        <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
          {releaseDate(release.date, i18n.language)}
        </Typography>
      </Box>
      {release.title && (
        <Typography variant="body2" sx={{ color: 'neutral300.main', mb: 1 }}>
          {release.title}
        </Typography>
      )}
      <Stack spacing={1}>
        {groups.map(
          ([label, items]) =>
            !!items?.length && (
              <Box key={label}>
                <Typography
                  variant="overline"
                  sx={{
                    color: 'neutral400.main',
                    lineHeight: 1.5,
                    letterSpacing: '0.08em',
                  }}
                >
                  {label}
                </Typography>
                <Box
                  component="ul"
                  sx={{
                    m: 0,
                    pl: 2.25,
                    '& li': { mb: 0.5 },
                    '& li::marker': { color: 'neutral400.main' },
                  }}
                >
                  {items.map((item) => (
                    <Typography component="li" variant="body2" key={item}>
                      {item}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )
        )}
      </Stack>
    </Box>
  )
}

/** Every release, newest first, with a link to the releases on GitHub */
export function ChangelogDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('ui')
  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{ maxWidth: 'sm' }}
      aria-labelledby="changelog-title"
    >
      <CardThemed>
        <CardContent
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pb: 1,
          }}
        >
          <Typography
            variant="h6"
            component="h2"
            id="changelog-title"
            sx={{ flexGrow: 1 }}
          >
            {t('changelog.title', 'Changelog')}
          </Typography>
          <IconButton
            onClick={onClose}
            size="small"
            aria-label={t('changelog.close', 'Close')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </CardContent>
        <Divider />
        <CardContent>
          <Stack spacing={2.5}>
            {releases.map((release, i) => (
              <Fragment key={release.version}>
                {i > 0 && <Divider />}
                <ReleaseNotes release={release} />
              </Fragment>
            ))}
          </Stack>
        </CardContent>
        <Divider />
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Link
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            underline="hover"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            {t('changelog.allReleases', 'All releases on GitHub')}
            <OpenInNewIcon sx={{ fontSize: 14 }} />
          </Link>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
