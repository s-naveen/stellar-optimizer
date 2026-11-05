import { useBoolState } from '@genshin-optimizer/common/react-util'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import CloseIcon from '@mui/icons-material/Close'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import {
  Button,
  CardContent,
  Divider,
  IconButton,
  Skeleton,
  Typography,
} from '@mui/material'
import { Suspense, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ArtifactInfoDisplay from './InfoDisplay'

// Same key the old info bar (InfoComponent) used, so people who have seen the guide still skip it.
const shownKey = 'infoShown_artifactPage'

/** Header button that opens the artifact guide; the guide opens by itself on the first visit. */
export function ArtifactGuideButton() {
  const { t } = useTranslation(['artifact', 'ui'])
  const [open, onOpen, onClose] = useBoolState(
    localStorage.getItem(shownKey) !== 'true'
  )
  const close = useCallback(() => {
    onClose()
    localStorage.setItem(shownKey, 'true')
  }, [onClose])

  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<HelpOutlineIcon />}
        onClick={onOpen}
      >
        {t('header.guide')}
      </Button>
      <ModalWrapper
        containerProps={{ maxWidth: 'xl' }}
        open={open}
        onClose={close}
      >
        <CardThemed>
          <CardContent sx={{ py: 1, display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6">{t('info.title')}</Typography>
            <IconButton
              onClick={close}
              sx={{ ml: 'auto' }}
              aria-label={t('ui:close')}
            >
              <CloseIcon />
            </IconButton>
          </CardContent>
          <Divider />
          <CardContent>
            <Suspense
              fallback={
                <Skeleton variant="rectangular" width="100%" height={500} />
              }
            >
              <ArtifactInfoDisplay />
            </Suspense>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}
