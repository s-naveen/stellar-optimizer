import { BootstrapTooltip } from '@genshin-optimizer/common/ui'
import { artifactAsset } from '@genshin-optimizer/gi/assets'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { Translate } from '@genshin-optimizer/gi/i18n'
import { getArtSheet } from '@genshin-optimizer/gi/sheets'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import type { TooltipProps } from '@mui/material'
import { Box, Skeleton, Typography } from '@mui/material'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ArtifactSetName } from './ArtifactTrans'

/** Tooltips that open and close quickly (a short fade instead of MUI's slower grow) */
export const quickTooltipProps = {
  TransitionProps: { timeout: { enter: 140, exit: 90 } },
} as const

export function ArtifactSetTooltip({
  children,
  setKey,
  numInSet = 5,
  placement = 'top',
}: {
  children: JSX.Element
  setKey: ArtifactSetKey
  numInSet?: number
  placement?: TooltipProps['placement']
}) {
  return (
    <BootstrapTooltip
      placement={placement}
      title={<ArtifactSetTooltipContent setKey={setKey} numInSet={numInSet} />}
      disableInteractive
      {...quickTooltipProps}
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
/** The set's art and name, then its bonuses (those the pieces do not reach dimmed) */
function SetToolTipTitle({
  setKey,
  numInSet = 5,
}: {
  setKey: ArtifactSetKey
  numInSet?: number
}) {
  const { t } = useTranslation('sheet')
  const artifactSheet = getArtSheet(setKey)
  const rarity = Math.max(...getArtSetStat(setKey).rarities)
  return (
    <Box
      sx={{
        width: 320,
        maxWidth: '100%',
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          className={`grad-${rarity}star`}
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 1.5,
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={artifactAsset(setKey, 'flower')}
            alt=""
            sx={{ width: '100%', height: '100%', display: 'block' }}
          />
        </Box>
        <Typography
          sx={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3 }}
        >
          <ArtifactSetName setKey={setKey} />
        </Typography>
      </Box>
      {Object.keys(artifactSheet.setEffects).map((setNum) => (
        <Box
          key={setNum}
          sx={{
            pt: 1.25,
            borderTop: 1,
            borderColor: 'divider',
            opacity: Number.parseInt(setNum) <= numInSet ? 1 : 0.5,
          }}
        >
          <Typography
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'success.main',
            }}
          >
            {t(`${setNum}set`)}
          </Typography>
          <Typography
            component="div"
            sx={{
              mt: 0.375,
              fontSize: '0.8125rem',
              lineHeight: 1.55,
              // (the translated text's own Typography would reset it to the body size)
              '& .MuiTypography-root': {
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
            }}
          >
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
