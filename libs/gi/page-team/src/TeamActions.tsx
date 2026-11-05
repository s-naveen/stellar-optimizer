import { useBoolState } from '@genshin-optimizer/common/react-util'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import { TeamDelModal } from '@genshin-optimizer/gi/ui'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import type { ButtonProps } from '@mui/material'
import { Box, Button, Tooltip, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import TeamExportModal from './TeamSetting/TeamExportModal'

/** Export / duplicate / delete, next to the team's name on every tab of the team page. */
export function TeamActions({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const navigate = useNavigate()
  const database = useDatabase()
  const team = useTeam(teamId)!
  const noChars = team.loadoutData.every((id) => !id)
  const [showExport, onShowExport, onHideExport] = useBoolState()
  const [showDel, onShowDel, onHideDel] = useBoolState()
  const theme = useTheme()
  const compact = !useMediaQuery(theme.breakpoints.up('sm'))

  const onDup = () => navigate(`/teams/${database.teams.duplicate(teamId)}`)
  const onDel = () => {
    // an empty team has nothing to lose: no confirmation needed
    if (!noChars) return onShowDel()
    database.teams.remove(teamId)
    navigate('/teams')
  }
  return (
    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
      <TeamExportModal
        show={showExport}
        teamId={teamId}
        onHide={onHideExport}
      />
      <TeamDelModal
        teamId={teamId}
        show={showDel}
        onHide={onHideDel}
        onDel={() => navigate('/teams')}
      />
      <ActionButton
        compact={compact}
        icon={<ContentPasteIcon />}
        label={t('teamSettings.exportBtn')}
        disabled={noChars}
        onClick={onShowExport}
      />
      <ActionButton
        compact={compact}
        icon={<ContentCopyIcon />}
        label={t('teamSettings.dupBtn')}
        disabled={noChars}
        onClick={onDup}
      />
      <ActionButton
        compact={compact}
        icon={<DeleteForeverIcon />}
        label={t('teamSettings.deleteBtn')}
        color="error"
        onClick={onDel}
      />
    </Box>
  )
}

/** The theme's tonal buttons: neutral for export/duplicate, red-tinted for delete. */
function ActionButton({
  compact,
  icon,
  label,
  color = 'secondary',
  ...props
}: {
  compact: boolean
  icon: ReactNode
  label: string
} & Pick<ButtonProps, 'disabled' | 'onClick' | 'color'>) {
  const button = (
    <Button
      size="small"
      variant="contained"
      color={color}
      startIcon={compact ? undefined : icon}
      aria-label={compact ? label : undefined}
      sx={compact ? { minWidth: 0, px: 1 } : undefined}
      {...props}
    >
      {compact ? icon : label}
    </Button>
  )
  // a disabled button gets no pointer events: wrap it so the tooltip still shows
  return compact ? (
    <Tooltip title={label}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  )
}
