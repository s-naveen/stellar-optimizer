import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  ModalWrapper,
  TextFieldLazy,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { CharacterName, CharIconSide, TeamIcon } from '@genshin-optimizer/gi/ui'
import BorderColorIcon from '@mui/icons-material/BorderColor'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import PersonIcon from '@mui/icons-material/Person'
import type { Theme } from '@mui/material'
import {
  alpha,
  Box,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  Link,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { TeamActions } from './TeamActions'
export default function TeamCharacterSelector({
  teamId,
  characterKey,
  tab = '',
}: {
  teamId: string
  characterKey?: CharacterKey
  tab?: string
}) {
  const { t } = useTranslation(['page_team', 'ui'])
  const navigate = useNavigate()
  const database = useDatabase()

  const { gender } = useDBMeta()
  const team = useTeam(teamId)!
  const { loadoutData } = team
  const [showEditor, onShowEditor, onHideEditor] = useBoolState()

  return (
    // the page header of a team: the same type and spacing as PageHeader on the other pages
    <Box
      component="header"
      sx={{ px: 0.5, pt: { xs: 1.5, md: 3 }, pb: { xs: 1.5, md: 2 } }}
    >
      <TeamEditorModal
        teamId={teamId}
        show={showEditor}
        onClose={onHideEditor}
      />
      {/* back to the team list */}
      <Link
        component={RouterLink}
        to="/teams"
        underline="hover"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          mb: 0.5,
          color: 'text.secondary',
          fontSize: '0.8125rem',
          fontWeight: 600,
          '&:hover': { color: 'text.primary' },
        }}
      >
        <TeamIcon sx={{ fontSize: 16 }} />
        {t('ui:tabs.teams')}
      </Link>
      {/* title row: the team's name is the page title, renamed in place */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          mb: 2,
        }}
      >
        <Typography
          variant="h4"
          component="h1"
          noWrap
          sx={{
            fontSize: { xs: '1.5rem', md: '1.875rem' },
            lineHeight: 1.2,
            minWidth: 0,
          }}
        >
          {team.name}
        </Typography>
        <Tooltip title={t('team.editNameDesc')}>
          <IconButton
            size="small"
            onClick={onShowEditor}
            aria-label={t('team.editNameDesc')}
            sx={{ color: 'text.secondary' }}
          >
            <BorderColorIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {!!team.description && (
          <Typography
            color="text.secondary"
            noWrap
            sx={{ ml: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}
          >
            {team.description}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <TeamActions teamId={teamId} />
      </Box>
      {/* members: pills; the open one is gold, like the active nav item */}
      <Tabs
        value={characterKey ?? 'team'}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        TabIndicatorProps={{ sx: { display: 'none' } }}
        sx={{
          minHeight: 0,
          '& .MuiTabs-flexContainer': { gap: 1 },
        }}
      >
        <Tab
          icon={<GroupsIcon />}
          iconPosition="start"
          value={'team'}
          label={t('teamSettings.tab.team')}
          onClick={() => navigate(`/teams/${teamId}/`)}
          sx={memberTabSx}
        />
        {loadoutData.map((loadoutDatum, ind) => {
          const teamCharKey =
            loadoutDatum &&
            database.teamChars.get(loadoutDatum?.teamCharId)?.key
          return (
            <Tab
              icon={
                teamCharKey ? (
                  <CharIconSide characterKey={teamCharKey} sideMargin />
                ) : (
                  <PersonIcon />
                )
              }
              sx={memberTabSx}
              iconPosition="start"
              value={teamCharKey ?? ind}
              key={ind}
              disabled={!loadoutData[ind]}
              label={
                teamCharKey ? (
                  <CharacterName characterKey={teamCharKey} gender={gender} />
                ) : (
                  t('teamSettings.tab.char', { count: ind + 1 })
                )
              }
              onClick={() =>
                // conserve the current tab when switching to another character
                teamCharKey &&
                navigate(`/teams/${teamId}/${teamCharKey}/${tab}`)
              }
            />
          )
        })}
      </Tabs>
    </Box>
  )
}

/**
 * A member (or "Team settings") pill. The open one is gold with the same tint as the active nav
 * item; the others are quiet outlined pills (the avatar carries the character).
 */
function memberTabSx(theme: Theme) {
  const { primary, text, divider } = theme.palette
  return {
    minHeight: 40,
    py: 0.5,
    px: 1.75,
    borderRadius: 999,
    fontWeight: 600,
    color: text.secondary,
    backgroundColor: alpha(text.primary, 0.03),
    boxShadow: `inset 0 0 0 1px ${divider}`,
    transition:
      'background-color 150ms ease, box-shadow 150ms ease, color 150ms ease',
    '&:hover': {
      color: text.primary,
      backgroundColor: alpha(text.primary, 0.06),
    },
    '&.Mui-selected': {
      color: `${primary.light} !important`,
      backgroundColor: alpha(primary.main, 0.14),
      boxShadow: `inset 0 0 0 1px ${alpha(primary.main, 0.4)}`,
    },
    '&.Mui-selected:hover': { backgroundColor: alpha(primary.main, 0.2) },
    '&.Mui-disabled': { opacity: 0.45 },
  }
}
function TeamEditorModal({
  teamId,
  show,
  onClose,
}: {
  teamId: string
  show: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)!
  const handleName = (teamName: string): void => {
    database.teams.set(teamId, { name: teamName })
  }
  const handleDesc = (teamDesc: string): void => {
    database.teams.set(teamId, { description: teamDesc })
  }
  return (
    <ModalWrapper open={show} onClose={onClose}>
      <CardThemed>
        <CardHeader
          title={t('team.editNameDesc')}
          avatar={<TeamIcon />}
          titleTypographyProps={{ variant: 'h6' }}
          action={
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          }
        />
        <Divider />
        <CardContent>
          <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 2 }}>
            <TextFieldLazy
              label={t('team.name')}
              value={team.name}
              onChange={(teamName) => handleName(teamName)}
              autoFocus
            />
            <TextFieldLazy
              label={t('team.desc')}
              value={team.description}
              onChange={(teamDesc) => handleDesc(teamDesc)}
              multiline
              minRows={4}
            />
          </Box>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
