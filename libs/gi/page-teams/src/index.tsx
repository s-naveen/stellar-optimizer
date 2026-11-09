import {
  useDataEntryBase,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import {
  useBoolState,
  useMediaQueryUp,
} from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  EmptyState,
  ModalWrapper,
  notePendingNavigation,
  PageHeader,
  ShowingAndSortOptionSelect,
  useInfScroll,
  useTitle,
} from '@genshin-optimizer/common/ui'
import { filterFunction, sortFunction } from '@genshin-optimizer/common/util'
import type { TeamSortKey } from '@genshin-optimizer/gi/db'
import { teamSortKeys } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import { CharacterMultiAutocomplete, TeamCard } from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import GroupsIcon from '@mui/icons-material/Groups'
import UploadIcon from '@mui/icons-material/Upload'
import {
  Box,
  Button,
  CardContent,
  CardHeader,
  Divider,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material'
import type { ChangeEvent } from 'react'
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { teamFilterConfigs, teamSortConfigs, teamSortMap } from './TeamSort'

const numToShowMap = { xs: 6, sm: 12, md: 18, lg: 24, xl: 24 }

export default function PageTeams() {
  // The team cards also use 'statKey_gen'; fetch it together with the page's namespaces.
  preloadNamespaces(['statKey_gen'])
  const { t } = useTranslation([
    'page_team',
    'page_teams',
    // Always load these 2 so character names are loaded for searching/sorting
    'charNames_gen',
  ])
  const database = useDatabase()
  const navigate = useNavigate()
  const location = useLocation()

  // Account for the case of switching from a team -> teams page, since they have the same base /teams url
  useTitle()

  const onAdd = () => {
    const newid = database.teams.new()
    // the new team page opens its member picker straight away
    navigate(newid, { state: { openQuickSetup: true } })
  }
  const [showImport, onShowImport, onHideImport] = useBoolState()
  const [data, setData] = useState('')
  // Automatically open the import modal if the state indicates to do so
  useEffect(() => {
    if (location.state?.openImportModal) {
      setData(location.state?.teamData)
      onShowImport()
    }
  }, [location.state, onShowImport, setData])
  const importData = () => {
    try {
      const dataObj = JSON.parse(data)
      if (!database.teams.import(dataObj))
        window.alert(t('importForm.error.verifi'))
      onHideImport()
    } catch (e) {
      window.alert(`${t('importForm.error.import')}\n${e}`)

      return
    }
  }
  const displayTeam = useDataEntryBase(database.displayTeam)
  const { sortType, ascending, charKeys } = displayTeam

  const [searchTerm, setSearchTerm] = useState(displayTeam.searchTerm)
  const deferredSearchTerm = useDeferredValue(searchTerm)
  useEffect(() => {
    database.displayTeam.set({ searchTerm: deferredSearchTerm })
  }, [database, deferredSearchTerm])

  const teamsDirty = useDataManagerValues(database.teams)
  const totalTeamNum = teamsDirty.length
  const filteredTeamIds = useMemo(
    () =>
      teamsDirty &&
      database.teams.keys
        .filter(
          filterFunction(
            { charKeys, name: deferredSearchTerm },
            teamFilterConfigs(database)
          )
        )
        .sort((k1, k2) => {
          return sortFunction(
            teamSortMap[sortType],
            ascending,
            teamSortConfigs()
          )(database.teams.get(k1)!, database.teams.get(k2)!)
        }),
    [teamsDirty, database, charKeys, deferredSearchTerm, sortType, ascending]
  )
  const brPt = useMediaQueryUp()

  const { numShow, setTriggerElement } = useInfScroll(
    numToShowMap[brPt],
    filteredTeamIds.length
  )

  const TeamIdsToShow = useMemo(
    () => filteredTeamIds.slice(0, numShow),
    [filteredTeamIds, numShow]
  )

  const totalShowing =
    filteredTeamIds.length !== totalTeamNum
      ? `${filteredTeamIds.length}/${totalTeamNum}`
      : `${totalTeamNum}`

  const showingTextProps = {
    numShowing: TeamIdsToShow.length,
    total: totalShowing,
    t: t,
    namespace: 'page_teams',
  }

  const sortByButtonProps = {
    sortKeys: [...teamSortKeys],
    value: sortType,
    onChange: (sortType: TeamSortKey) => database.displayTeam.set({ sortType }),
    ascending: ascending,
    onChangeAsc: (ascending: boolean) =>
      database.displayTeam.set({ ascending }),
  }

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <PageHeader
        title={t('ui:tabs.teams')}
        count={totalTeamNum}
        actions={
          <>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<UploadIcon />}
              onClick={onShowImport}
            >
              {t('page_teams:header.import')}
            </Button>
            <Button sx={giCtaSx} startIcon={<AddIcon />} onClick={onAdd}>
              {t('page_teams:header.create')}
            </Button>
          </>
        }
      />
      <CardThemed>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* like the Characters page: the character filter grows (capped on wide pages), the
              name search keeps a fixed width on the right */}
          <Box display="flex" gap={1} alignItems="stretch">
            <CharacterMultiAutocomplete
              teamIds={filteredTeamIds}
              charKeys={charKeys}
              setCharKey={(charKeys) => database.displayTeam.set({ charKeys })}
              acProps={{ sx: { flexGrow: 1, maxWidth: { lg: 720 } } }}
            />
            <TextField
              autoFocus
              value={searchTerm}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setSearchTerm(e.target.value)
              }
              label={t('searchLabel.team')}
              // size="small"
              sx={{
                height: '100%',
                flexGrow: { xs: 1, md: 0 },
                width: { md: 320 },
                flexShrink: 0,
                ml: { md: 'auto' },
              }}
              InputProps={{
                sx: { height: '100%' },
              }}
            />
          </Box>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
          >
            <ShowingAndSortOptionSelect
              showingTextProps={showingTextProps}
              sortByButtonProps={sortByButtonProps}
            />
          </Box>
        </CardContent>
      </CardThemed>

      <ModalWrapper open={showImport} onClose={onHideImport}>
        <CardThemed>
          <CardHeader title={t('importForm.title')} />
          <Divider />
          <CardContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography>{t('importForm.desc')}</Typography>
            <TextField
              fullWidth
              label={t('importForm.label')}
              placeholder={t('importForm.placeholder')}
              value={data}
              onChange={(e) => setData(e.target.value)}
              multiline
              rows={4}
            />
            <Button
              startIcon={<UploadIcon />}
              disabled={!data}
              onClick={importData}
            >
              {t('importForm.importBtn')}
            </Button>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
      {totalTeamNum === 0 && (
        <EmptyState
          icon={<GroupsIcon />}
          title={t('page_teams:empty.title')}
          description={t('page_teams:empty.description')}
          actions={
            <>
              <Button onClick={onAdd} startIcon={<AddIcon />}>
                {t('page_teams:empty.create')}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={onShowImport}
                startIcon={<UploadIcon />}
              >
                {t('page_teams:empty.import')}
              </Button>
            </>
          }
        />
      )}
      <Suspense
        fallback={
          <Skeleton
            variant="rectangular"
            sx={{ width: '100%', height: '100%', minHeight: 5000 }}
          />
        }
      >
        {/* auto-fill: a wider page gets more cards per row, not wider cards */}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns:
              'repeat(auto-fill, minmax(min(360px, 100%), 1fr))',
          }}
        >
          {TeamIdsToShow.map((tid) => (
            <Box key={tid} sx={{ minWidth: 0 }}>
              <Suspense
                fallback={
                  <Skeleton variant="rectangular" width="100%" height={150} />
                }
              >
                <TeamCard
                  teamId={tid}
                  bgt="light"
                  onClick={(cid) => {
                    // the team page takes a moment to render: show the progress bar meanwhile
                    notePendingNavigation()
                    navigate(`${tid}${cid ? `/${cid}` : ''}`)
                  }}
                />
              </Suspense>
            </Box>
          ))}
        </Box>
      </Suspense>
      {filteredTeamIds.length !== TeamIdsToShow.length && (
        <Skeleton
          ref={(node) => {
            if (!node) return
            setTriggerElement(node)
          }}
          sx={{ borderRadius: 1 }}
          variant="rectangular"
          width="100%"
          height={100}
        />
      )}
    </Box>
  )
}
