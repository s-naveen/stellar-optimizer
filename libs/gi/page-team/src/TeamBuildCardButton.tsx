import { TeamCharacterContext } from '@genshin-optimizer/gi/db-ui'
import { BuildCardButton } from '@genshin-optimizer/gi/ui'
import { useMediaQuery, useTheme } from '@mui/material'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The open member's build card (the build its loadout uses, with the character's own stats),
 * among the team page's header actions and styled like them
 */
export function TeamBuildCardButton() {
  const { t } = useTranslation('ui')
  const theme = useTheme()
  // like the other header actions: icon only on small screens
  const compact = !useMediaQuery(theme.breakpoints.up('sm'))
  const { loadoutDatum } = useContext(TeamCharacterContext)
  return (
    <BuildCardButton
      size="small"
      variant="contained"
      color="secondary"
      compact={compact}
      disabledReason={
        loadoutDatum.buildType === 'tc'
          ? t(
              'buildCard.tcBuild',
              'A theorycraft build has no artifacts to show on a card'
            )
          : undefined
      }
    />
  )
}
