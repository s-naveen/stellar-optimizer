import { BootstrapTooltip } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { Translate } from '@genshin-optimizer/gi/i18n'
import { getArtSheet } from '@genshin-optimizer/gi/sheets'
import { Box, Skeleton, Typography } from '@mui/material'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'

export function ArtifactSetTooltip({
  children,
  setKey,
  numInSet = 5,
}: {
  children: JSX.Element
  setKey: ArtifactSetKey
  numInSet?: number
}) {
  return (
    <BootstrapTooltip
      placement="top"
      title={<ArtifactSetTooltipContent setKey={setKey} numInSet={numInSet} />}
      disableInteractive
    >
      {children}
    </BootstrapTooltip>
  )
}
export function ArtifactSetTooltipContent({
  setKey,
  numInSet = 5,
}: {
  setKey: ArtifactSetKey
  numInSet?: number
}) {
  return (
    <Suspense
      fallback={<Skeleton variant="rectangular" width={100} height={100} />}
    >
      <SetToolTipTitle numInSet={numInSet} setKey={setKey} />
    </Suspense>
  )
}
function SetToolTipTitle({
  setKey,
  numInSet = 5,
}: {
  setKey: ArtifactSetKey
  numInSet?: number
}) {
  const { t } = useTranslation('sheet')
  const artifactSheet = getArtSheet(setKey)
  return (
    <Box
      sx={{
        maxWidth: 320,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {Object.keys(artifactSheet.setEffects).map((setNum) => (
        <Box
          key={setNum}
          // bonuses the current pieces do not reach are dimmed
          sx={{ opacity: Number.parseInt(setNum) <= numInSet ? 1 : 0.5 }}
        >
          <Typography
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'success.main',
            }}
          >
            {t(`${setNum}set`)}
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: '0.8125rem', lineHeight: 1.5 }}>
            <Translate
              ns={`artifact_${setKey}_gen`}
              key18={`setEffects.${setNum}`}
            />
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
