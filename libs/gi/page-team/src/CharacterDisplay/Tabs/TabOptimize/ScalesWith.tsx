import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import {
  ArtifactStatWithUnit,
  OptTargetContext,
} from '@genshin-optimizer/gi/ui'
import { alpha, Box, Typography } from '@mui/material'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'

/** The stats the optimization target and constraints depend on, as a quiet row of stat pills. */
export default function ScalesWith() {
  const { t } = useTranslation('page_character_optimize')
  const { scalesWith } = useContext(OptTargetContext)
  if (!scalesWith.size) return null
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.75,
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
        {t('settings.scalesWith')}
      </Typography>
      {[...scalesWith].map((statKey) => (
        <Box
          key={statKey}
          component="span"
          sx={(theme) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            height: 26,
            px: 1,
            borderRadius: 999,
            bgcolor: alpha(theme.palette.text.primary, 0.06),
            fontSize: '0.8125rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          })}
        >
          <StatIcon statKey={statKey} iconProps={iconInlineProps} />
          <ArtifactStatWithUnit statKey={statKey} />
        </Box>
      ))}
    </Box>
  )
}
