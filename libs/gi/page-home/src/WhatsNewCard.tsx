import { CardThemed } from '@genshin-optimizer/common/ui'
import {
  ChangelogDialog,
  latestNotedRelease,
  notedReleases,
  ReleaseNotes,
  releaseUrl,
} from '@genshin-optimizer/gi/ui'
import { Box, Button, CardContent } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionTitle } from './InventoryCard'

/** The latest release's notes (of the ones users notice), and the whole changelog a click away */
export default function WhatsNewCard() {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)
  return (
    <Box component="section" aria-labelledby="whats-new-title">
      <SectionTitle id="whats-new-title">
        {t('changelog.whatsNew', 'What’s new')}
      </SectionTitle>
      <CardThemed>
        <CardContent>
          <ReleaseNotes release={latestNotedRelease} />
          {/* the earlier releases, once there are some; else this one on GitHub */}
          {notedReleases.length > 1 ? (
            <Button
              size="small"
              variant="outlined"
              color="neutral400"
              onClick={() => setOpen(true)}
              sx={{ mt: 2 }}
            >
              {t('changelog.allChanges', 'Full changelog')}
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              color="neutral400"
              href={releaseUrl(latestNotedRelease.version)}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 2 }}
            >
              {t('changelog.onGitHub', 'Release on GitHub')}
            </Button>
          )}
        </CardContent>
      </CardThemed>
      <ChangelogDialog open={open} onClose={() => setOpen(false)} />
    </Box>
  )
}
