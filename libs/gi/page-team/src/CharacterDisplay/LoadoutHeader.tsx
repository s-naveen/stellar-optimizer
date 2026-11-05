import { useBoolState } from '@genshin-optimizer/common/react-util'
import { BootstrapTooltip } from '@genshin-optimizer/common/ui'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import BorderColorIcon from '@mui/icons-material/BorderColor'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import PersonIcon from '@mui/icons-material/Person'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import type { Theme } from '@mui/material'
import { Box, Button, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { ellipsisSx, fieldButtonSx } from '../fieldButtonSx'
import { BuildsEditorModal } from './BuildsEditorModal'
import { LoadoutEditorModal } from './LoadoutEditorModal'

/**
 * The open member's loadout and build, as two quiet field-like choosers (the look of the select
 * fields on the Talents tab): the loadout opens its editor, the build opens the build list.
 */
export function LoadoutHeader() {
  const { teamChar, loadoutDatum } = useContext(TeamCharacterContext)
  const database = useDatabase()
  const { t } = useTranslation('page_team')
  const [showLoadout, onShowLoadout, onCloseLoadout] = useBoolState()
  const [showBuild, onShowBuild, onCloseBuild] = useBoolState()

  return (
    <Box sx={{ display: 'flex', gap: 1, minWidth: 0 }}>
      <BootstrapTooltip
        placement="top"
        title={
          <TooltipTitle
            title={t('loadout.edit')}
            description={teamChar.description}
          />
        }
      >
        <Button
          startIcon={<PersonIcon />}
          endIcon={<BorderColorIcon />}
          sx={chooserSx}
          onClick={onShowLoadout}
        >
          <Box component="span" sx={ellipsisSx}>
            {teamChar.name}
          </Box>
        </Button>
      </BootstrapTooltip>
      <LoadoutEditorModal open={showLoadout} onClose={onCloseLoadout} />
      <BootstrapTooltip
        placement="top"
        title={
          <TooltipTitle
            title={t('buildInfo.editorTitle')}
            description={teamChar.description}
          />
        }
      >
        <Button
          startIcon={<CheckroomIcon />}
          endIcon={<UnfoldMoreIcon />}
          sx={chooserSx}
          onClick={onShowBuild}
        >
          <Box component="span" sx={ellipsisSx}>
            {database.teams.getActiveBuildName(loadoutDatum)}
          </Box>
        </Button>
      </BootstrapTooltip>
      <BuildsEditorModal open={showBuild} onClose={onCloseBuild} />
    </Box>
  )
}

function TooltipTitle({
  title,
  description,
}: {
  title: ReactNode
  description?: string
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', color: 'primary.light', gap: 1 }}>
        <BorderColorIcon fontSize="small" />
        <Typography>
          <strong>{title}</strong>
        </Typography>
      </Box>
      {!!description && <Typography>{description}</Typography>}
    </Box>
  )
}

/** Side by side and sharing the row on small screens; natural width (capped) next to the tabs. */
function chooserSx(theme: Theme) {
  return {
    ...fieldButtonSx(theme),
    flex: { xs: '1 1 0', md: '0 1 auto' },
    maxWidth: { md: 320 },
  }
}
