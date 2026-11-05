import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { dataContextObj, TeamData } from '@genshin-optimizer/gi/ui'
import {
  CharacterMultiSelectionModal,
  CharacterName,
  CharacterSingleSelectionModal,
  CharIconSide,
  EnemyExpandCard,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import Filter4Icon from '@mui/icons-material/Filter4'
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import type { ButtonProps } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense, useEffect, useId, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import BuildDropdown from '../BuildDropdown'
import { ellipsisSx, fieldButtonSx } from '../fieldButtonSx'
import { LoadoutDropdown } from '../LoadoutDropdown'
import { ResonanceDisplay } from './ResonanceDisplay'
import { TeammateDisplay } from './TeamComponents'

/**
 * Team Settings: on wide screens, the team-wide buffs (resonance, Moonsign, Hexerei, reactions) are
 * a narrow column on the left and the team itself (enemy, members) takes the rest; on small screens
 * the members come first and the buffs follow.
 */
export default function TeamSetting({
  teamId,
  teamData,
}: {
  teamId: string
  teamData?: TeamData
  buttonProps?: ButtonProps
}) {
  // export / duplicate / delete live next to the team name (TeamActions)
  return <TeamEditor teamId={teamId} teamData={teamData} />
}
function TeamEditor({
  teamId,
  teamData,
}: {
  teamId: string
  teamData?: TeamData
}) {
  const { t } = useTranslation('page_team')
  const { t: tk } = useTranslation('teams_gen')
  const database = useDatabase()
  const team = database.teams.get(teamId)!
  const { loadoutData } = team
  const buffsTitleId = useId()
  const membersTitleId = useId()

  const onSelect = (cKey: CharacterKey, selectedIndex: number) => {
    // Make sure character exists
    database.chars.getWithInitWeapon(cKey)

    const existingIndex = loadoutData.findIndex(
      (loadoutDatum) =>
        loadoutDatum &&
        database.teamChars.get(loadoutDatum.teamCharId)?.key === cKey
    )
    if (existingIndex < 0) {
      //find the first available teamchar
      let teamCharId = database.teamChars.keys.find(
        (k) => database.teamChars.get(k)!.key === cKey
      )
      // if there is no teamchar, create one.
      if (!teamCharId) teamCharId = database.teamChars.new(cKey)
      database.teams.set(teamId, (team) => {
        if (!teamCharId) return
        team.loadoutData[selectedIndex] = { teamCharId } as LoadoutDatum
      })
    } else {
      if (selectedIndex === existingIndex) return
      if (loadoutData[selectedIndex]) {
        // Already have a teamChar at destination, move to existingIndex
        const existingLoadoutDatum = loadoutData[existingIndex]
        const destinationLoadoutDatum = loadoutData[selectedIndex]
        database.teams.set(teamId, (team) => {
          team.loadoutData[selectedIndex] = existingLoadoutDatum
          // Technically only relevant during single selection so re-selecting a teammate in a different slot
          // simply flips the slots but does not interfere with multi-selection.
          if (
            team.loadoutData[existingIndex]?.teamCharId ===
            existingLoadoutDatum?.teamCharId
          ) {
            team.loadoutData[existingIndex] = destinationLoadoutDatum
          }
        })
      } else if (
        // Only relevant during multi-selection when the teamChar at loadoutData[existingIndex] is moved to
        // selectedIndex due to inserting a different teamChar at existingIndex, but loadoutData[selectedIndex]
        // is undefined. Comparison needs to be done against the team data currently in the database
        // to account for any changes made by selections that have already been processed. This condition should
        // never be true during single selection.
        database.teams.get(teamId)!.loadoutData[existingIndex]?.teamCharId !==
        loadoutData[existingIndex]!.teamCharId
      ) {
        database.teams.set(teamId, (team) => {
          team.loadoutData[selectedIndex] = loadoutData[existingIndex]
        })
      }
    }
  }

  const [charSelectIndex, setCharSelectIndex] = useState(
    undefined as number | undefined
  )
  const onSingleSelect = (cKey: CharacterKey) => {
    if (charSelectIndex === undefined) return
    onSelect(cKey, charSelectIndex)
  }

  // A team that was just created (Teams page) has no members yet: open the picker right away.
  const location = useLocation()
  const navigate = useNavigate()
  const [showMultiSelect, setShowMultiSelect] = useState(
    () =>
      !!location.state?.openQuickSetup &&
      team.loadoutData.every((loadoutDatum) => !loadoutDatum)
  )
  useEffect(() => {
    // consume the flag, so going back to this page later does not reopen the picker
    if (location.state?.openQuickSetup)
      navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])
  const onMultiSelect = (cKeys: (CharacterKey | '')[]) => {
    // Condense character key list so there are no empty team slots between characters
    const filteredKeys = cKeys.filter((key) => key !== '')
    for (let i = 0; i < filteredKeys.length; ++i) {
      const key = filteredKeys[i]
      onSelect(key, i)
    }

    const numSlotsEmpty = team.loadoutData.length - filteredKeys.length
    for (let j = 1; j <= numSlotsEmpty; ++j) {
      // If there are empty slots, clear them. Clear in reverse from the last team slot
      // to avoid potentially missing slots due to characters being automatically moved
      // to the first slot.
      database.teams.set(teamId, (team) => {
        team.loadoutData[team.loadoutData.length - j] = undefined
      })
    }
  }

  const firstTeamCharId = loadoutData[0]?.teamCharId
  const firstTeamCharKey =
    firstTeamCharId && database.teamChars.get(firstTeamCharId)?.key
  const charData = firstTeamCharKey && teamData?.[firstTeamCharKey]
  const charUIData = charData ? charData.target : undefined

  const dataContextValue: dataContextObj | undefined = useMemo(() => {
    if (!teamData || !charUIData) return undefined
    return {
      data: charUIData,
      teamData,
      compareData: undefined,
    }
  }, [charUIData, teamData])
  const hasMembers = loadoutData.some((loadoutDatum) => !!loadoutDatum)
  return (
    <>
      <Suspense fallback={false}>
        <CharacterSingleSelectionModal
          show={!showMultiSelect && charSelectIndex !== undefined}
          onHide={() => setCharSelectIndex(undefined)}
          onSelect={onSingleSelect}
          selectedIndex={charSelectIndex}
          loadoutData={loadoutData}
        />
      </Suspense>
      <Suspense fallback={false}>
        <CharacterMultiSelectionModal
          show={showMultiSelect}
          onHide={() => {
            setShowMultiSelect(false)
          }}
          onSelect={onMultiSelect}
          loadoutData={loadoutData}
        />
      </Suspense>
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, lg: 2.5 },
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: '360px minmax(0, 1fr)',
          },
          alignItems: 'start',
          p: { xs: 1, md: 1.5 },
        }}
      >
        {/* team-wide buffs: the left column on wide screens, after the members on small ones */}
        <Box
          component="aside"
          aria-labelledby={buffsTitleId}
          sx={{
            order: { xs: 1, lg: 0 },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <SectionTitle id={buffsTitleId}>
            {t('teamSettings.buffsTitle')}
          </SectionTitle>
          {dataContextValue ? (
            <ResonanceDisplay
              teamId={teamId}
              team={team}
              dataContextValue={dataContextValue}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('teamSettings.buffsEmpty')}
            </Typography>
          )}
        </Box>

        {/* the team: its enemy and members */}
        <Box
          component="section"
          aria-labelledby={membersTitleId}
          sx={{
            order: { xs: 0, lg: 1 },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <EnemyExpandCard teamId={teamId} />
          <SectionTitle
            id={membersTitleId}
            info={
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  p: 0.5,
                }}
              >
                <Typography variant="body2">
                  <Trans t={t} i18nKey={'teamSettings.alert.desc'}>
                    <strong>Teams</strong> are a container for 4 character
                    loadouts. It provides a way for characters to apply team
                    buffs, and configuration of enemy stats. Loadouts can be
                    shared between teams.
                  </Trans>
                </Typography>
                <Typography variant="body2">
                  <Trans t={t} i18nKey={'teamSettings.alert.first'}>
                    The first character in the team receives any "active
                    on-field character" buffs, and cannot be empty.
                  </Trans>
                </Typography>
              </Box>
            }
            action={
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<Filter4Icon />}
                onClick={() => setShowMultiSelect(true)}
                // the page's main action while the team is still empty
                sx={hasMembers ? undefined : giCtaSx}
              >
                {tk('quickSetup')}
              </Button>
            }
          >
            {t('teamSettings.title')}
          </SectionTitle>
          {/* members: 4 across when there is room, else 2, else 1 (by this column's width) */}
          <Box sx={{ containerType: 'inline-size' }}>
            <Box
              sx={{
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: 'minmax(0, 1fr)',
                '@container (min-width: 520px)': {
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                },
                '@container (min-width: 1040px)': {
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {loadoutData.map((loadoutDatum, ind) =>
                loadoutDatum ? (
                  <CharSelButton
                    index={ind}
                    key={loadoutDatum.teamCharId}
                    teamId={teamId}
                    loadoutDatum={loadoutDatum}
                    onClickChar={() => setCharSelectIndex(ind)}
                    teamData={teamData}
                  />
                ) : (
                  <AddMemberButton
                    // biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no id
                    key={ind}
                    onClick={() => setCharSelectIndex(ind)}
                    // the first slot must be filled before the others
                    disabled={!!ind && !hasMembers}
                  />
                )
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  )
}

/** A section heading in Team Settings, with an optional tip and an action on the right. */
function SectionTitle({
  id,
  info,
  action,
  children,
}: {
  id: string
  info?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36 }}>
      <Typography
        id={id}
        component="h2"
        sx={{ fontSize: '1rem', fontWeight: 600 }}
      >
        {children}
      </Typography>
      {info && <InfoTooltipInline title={info} />}
      <Box sx={{ flexGrow: 1 }} />
      {action}
    </Box>
  )
}

/** An empty member slot: a dashed tile, like the empty artifact slots. */
function AddMemberButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  const { t } = useTranslation('page_team')
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      sx={(theme) => ({
        minHeight: 148,
        borderRadius: 3,
        flexDirection: 'column',
        gap: 0.5,
        fontWeight: 600,
        color: 'text.secondary',
        border: `1px dashed ${alpha(theme.palette.text.primary, 0.22)}`,
        '& .MuiSvgIcon-root': { fontSize: 28 },
        '&:hover': {
          color: 'primary.light',
          borderColor: alpha(theme.palette.primary.main, 0.6),
          backgroundColor: alpha(theme.palette.primary.main, 0.06),
        },
        '&.Mui-disabled': { opacity: 0.45 },
      })}
    >
      <AddIcon />
      {t('teamSettings.addCharBtn')}
    </Button>
  )
}

function CharSelButton({
  index,
  teamId,
  loadoutDatum,
  teamData,
  onClickChar,
}: {
  index: number
  teamId: string
  loadoutDatum: LoadoutDatum
  teamData?: TeamData
  onClickChar: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { teamCharId } = loadoutDatum
  const { key: characterKey } = database.teamChars.get(teamCharId)!
  const { gender } = useDBMeta()
  const onChangeTeamCharId = (teamCharId: string) => {
    database.teams.set(teamId, (team) => {
      team.loadoutData[index] = { teamCharId } as LoadoutDatum
    })
  }
  const onActive = () => {
    // Swap the active with current loadout
    database.teams.set(teamId, (team) => {
      const oldActive = team.loadoutData[0]
      team.loadoutData[0] = loadoutDatum
      team.loadoutData[index] = oldActive
    })
  }

  const onDel = () =>
    database.teams.set(teamId, (team) => {
      team.loadoutData[index] = undefined
    })

  const charData = characterKey && teamData?.[characterKey]
  const charUIData = charData ? charData.target : undefined

  const dataContextValue: dataContextObj | undefined = useMemo(() => {
    if (!teamData || !charUIData) return undefined
    return {
      data: charUIData,
      teamData,
      compareData: undefined,
    }
  }, [charUIData, teamData])

  return (
    <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column', minWidth: 0 }}>
      {/* the member: change the character, or remove it from the team */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          onClick={onClickChar}
          startIcon={<CharIconSide characterKey={characterKey} />}
          endIcon={<SwapHorizIcon />}
          sx={(theme) => ({ ...fieldButtonSx(theme), flexGrow: 1 })}
        >
          <Box component="span" sx={ellipsisSx}>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Box>
        </Button>
        <Tooltip title={t('teamSettings.removeBtn')}>
          <IconButton
            onClick={onDel}
            aria-label={t('teamSettings.removeBtn')}
            sx={(theme) => ({
              borderRadius: 2,
              color: 'text.secondary',
              border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
              '&:hover': {
                color: 'error.main',
                borderColor: alpha(theme.palette.error.main, 0.5),
                backgroundColor: alpha(theme.palette.error.main, 0.08),
              },
            })}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <LoadoutDropdown
        teamCharId={teamCharId}
        onChangeTeamCharId={onChangeTeamCharId}
        dropdownBtnProps={{
          fullWidth: true,
          variant: 'text',
          sx: fieldButtonSx,
        }}
      />
      <BuildDropdown
        teamId={teamId}
        loadoutDatum={loadoutDatum}
        dropdownBtnProps={{
          fullWidth: true,
          variant: 'text',
          sx: fieldButtonSx,
        }}
      />
      {/* the first member is the on-field character; the others can take its place */}
      {index ? (
        <Button
          size="small"
          onClick={onActive}
          startIcon={<StarOutlineRoundedIcon />}
          sx={(theme) => ({
            minHeight: 32,
            borderRadius: 2,
            fontWeight: 600,
            color: 'text.secondary',
            '&:hover': {
              color: 'primary.light',
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
            },
          })}
        >
          {t('teamSettings.toFieldBtn')}
        </Button>
      ) : (
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            minHeight: 32,
            borderRadius: 2,
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'primary.light',
            backgroundColor: alpha(theme.palette.primary.main, 0.12),
            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`,
          })}
        >
          <StarRoundedIcon sx={{ fontSize: 18 }} />
          {t('teamSettings.onFieldBtn')}
        </Box>
      )}
      {dataContextValue && (
        <TeammateDisplay
          dataContextValue={dataContextValue}
          teamCharId={teamCharId}
          teamId={teamId}
        />
      )}
    </Box>
  )
}
