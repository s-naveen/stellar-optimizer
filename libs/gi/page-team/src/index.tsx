import { CardThemed, useTitle } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { GeneratedBuild } from '@genshin-optimizer/gi/db'
import type { CharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import {
  CharacterContext,
  TeamCharacterContext,
  type TeamCharacterContextObj,
  useBuildTc,
  useCharacter,
  useDatabase,
  useDBMeta,
  useTeam,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import {
  type ChartData,
  DataContext,
  type dataContextObj,
  FormulaDataWrapper,
  GraphContext,
  type GraphContextObj,
  OptTargetWrapper,
  useTeamDataNoContext,
} from '@genshin-optimizer/gi/ui'
import { Box, Skeleton } from '@mui/material'
import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Navigate,
  Route,
  Routes,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router-dom'
import type { BuildTcContexObj, SetBuildTcAction } from './BuildTcContext'
import { BuildTcContext } from './BuildTcContext'
import Content from './CharacterDisplay/Content'
import { kqmTheorycraftingEnabled } from './featureFlags'
import { TeamBuildCardButton } from './TeamBuildCardButton'
import TeamCharacterSelector from './TeamCharacterSelector'
import TeamBuildWorkspace from './TeamOptimize'
import TeamSetting from './TeamSetting'

/** `/teams/:teamId/optimize`: Team Optimize (no character key is lowercase) */
const TEAM_OPT_PATH = 'optimize'
const KQM_PATH = 'kqm'

export default function PageTeam() {
  const database = useDatabase()
  const { teamId } = useParams<{ teamId?: string }>()
  const kqmRoute = useMatch({ path: '/teams/:teamId/kqm', end: false })
  const invalidKey = !teamId || !database.teams.keys.includes(teamId)

  // An edit is triggered whenever a team gets opened even if no edits are done
  useEffect(() => {
    if (invalidKey) return
    database.teams.set(teamId, { lastEdit: Date.now() })
  }, [teamId, database.teams, invalidKey])

  if (invalidKey) return <Navigate to="/teams" />
  if (kqmRoute && !kqmTheorycraftingEnabled)
    return <Navigate to={`/teams/${teamId}/optimize`} replace />

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <Suspense
        fallback={<Skeleton variant="rectangular" width="100%" height={1000} />}
      >
        {teamId && <Page teamId={teamId} />}
      </Suspense>
    </Box>
  )
}

const fallback = <Skeleton variant="rectangular" width="100%" height={1000} />
// Stored per teamCharId
const chartDataAll: Record<string, ChartData> = {}
const graphBuildAll: Record<string, GeneratedBuild[]> = {}

function Page({ teamId }: { teamId: string }) {
  const database = useDatabase()
  const navigate = useNavigate()
  const { gender } = useDBMeta()

  const team = useTeam(teamId)!
  const { loadoutData } = team
  // use the current URL as the "source of truth" for characterKey and tab.
  const {
    params: { characterKey: characterKeyRaw },
  } = useMatch({ path: '/teams/:teamId/:characterKey', end: false }) ?? {
    params: {},
  }
  const {
    params: { tab },
  } = useMatch({ path: '/teams/:teamId/:characterKey/:tab' }) ?? {
    params: {},
  }

  // validate characterKey
  const loadoutDatum = useMemo(() => {
    const loadoutDatum = loadoutData.find(
      (loadoutDatum) =>
        loadoutDatum?.teamCharId &&
        database.teamChars.get(loadoutDatum.teamCharId)?.key === characterKeyRaw
    )

    return loadoutDatum
  }, [loadoutData, database.teamChars, characterKeyRaw])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])
  const isTeamOpt = characterKeyRaw === TEAM_OPT_PATH
  const isKqm = kqmTheorycraftingEnabled && characterKeyRaw === KQM_PATH
  const isTeamBuild = isTeamOpt || isKqm
  useEffect(() => {
    if (!loadoutDatum && !isTeamBuild) navigate('', { replace: true })
  }, [loadoutDatum, navigate, isTeamBuild])

  const teamCharId = loadoutDatum?.teamCharId
  const characterKey = database.teamChars.get(teamCharId)?.key

  const teamChar = useTeamChar(teamCharId ?? '')

  // Request the namespaces of the page and of every team member (character, weapon, artifact
  // sets) at once. Otherwise they are fetched one network round trip at a time as the nested
  // sheets render (12 sequential rounds for a 4-character team).
  useMemo(() => {
    const namespaces = [
      'charNames_gen',
      'page_character',
      'page_team',
      'tooltips_gen',
      'sheet_gen',
      'sheet',
      'teams_gen',
      'elementalResonance_gen',
      'reaction_gen',
      'weaponNames_gen',
      'build',
      'loadout',
    ]
    for (const datum of loadoutData) {
      if (!datum) continue
      const charKey = database.teamChars.get(datum.teamCharId)?.key
      // Traveler namespaces are named per element/gender; let them load on demand.
      if (charKey && !charKey.startsWith('Traveler'))
        namespaces.push(`char_${charKey}_gen`)
      const weaponKey = database.teams.getLoadoutWeapon(datum)?.key
      if (weaponKey) namespaces.push(`weapon_${weaponKey}_gen`)
      for (const artId of Object.values(
        database.teams.getLoadoutArtifactIds(datum)
      )) {
        const setKey = artId && database.arts.get(artId)?.setKey
        if (setKey) namespaces.push(`artifact_${setKey}_gen`)
      }
    }
    preloadNamespaces(namespaces)
  }, [database, loadoutData])

  const { t } = useTranslation([
    'charNames_gen',
    'page_character',
    'page_team',
    'tooltips_gen',
    'sheet_gen',
  ])

  useTitle(
    useMemo(() => {
      if (isKqm) return `${team.name} - ${t('page_team:teamOpt.kqm.tab')}`
      if (isTeamOpt) return `${team.name} - ${t('page_team:teamOpt.title')}`
      const charName = characterKey
        ? t(
            `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
          )
        : t('page_team:teamSettings.tab.team')
      const tabName = tab
        ? t(`page_character:tabs.${tab}`)
        : characterKey
          ? t('page_character:tabs.overview')
          : tab
      return tabName
        ? `${team.name} - ${charName} - ${tabName}`
        : `${team.name} - ${charName}`
    }, [t, team.name, characterKey, gender, tab, isTeamOpt, isKqm])
  )

  const teamCharacterContextValue: TeamCharacterContextObj | undefined =
    useMemo(() => {
      if (!teamCharId || !teamChar || !loadoutDatum) return undefined
      return {
        teamId,
        team,
        teamCharId,
        teamChar,
        loadoutDatum,
      }
    }, [teamId, team, teamCharId, teamChar, loadoutDatum])

  const teamData = useTeamDataNoContext(teamId, teamCharId ?? '')
  const { target: charUIData } =
    (characterKey && teamData?.[characterKey]) ?? {}

  const dataContextValue: dataContextObj | undefined = useMemo(() => {
    if (!teamData || !charUIData) return undefined
    return {
      data: charUIData,
      teamData,
      compareData: undefined,
    }
  }, [charUIData, teamData])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {/* the team's name, actions and members sit on the page like every page header; the card
          below holds the open member's tabs and content */}
      <TeamCharacterSelector
        teamId={teamId}
        characterKey={characterKey}
        tab={tab}
        teamBuildMode={isKqm ? 'kqm' : isTeamOpt ? 'inventory' : undefined}
        actions={
          // a member's tab: its build card, among the header's actions
          !isTeamBuild &&
          teamCharacterContextValue &&
          dataContextValue && (
            <TeamCharacterContext.Provider value={teamCharacterContextValue}>
              <DataContext.Provider value={dataContextValue}>
                <TeamBuildCardButton />
              </DataContext.Provider>
            </TeamCharacterContext.Provider>
          )
        }
      />
      {/* `clip` still clips to the rounded corners but, unlike `hidden`, is not a scroll
          container, so sticky bars inside (the optimizer's generate bar) stick to the window */}
      {/* Team optimize and KQM: their sections are panels of their own, straight on the page */}
      {isTeamBuild ? (
        <TeamBuildWorkspace
          key={teamId}
          teamId={teamId}
          teamData={teamData}
          mode={isKqm ? 'kqm' : 'inventory'}
        />
      ) : (
        <CardThemed sx={{ '@supports (overflow: clip)': { overflow: 'clip' } }}>
          {teamCharacterContextValue ? (
            dataContextValue ? (
              <TeamCharacterContext.Provider value={teamCharacterContextValue}>
                <DataContext.Provider value={dataContextValue}>
                  <InnerContent tab={tab} />
                </DataContext.Provider>
              </TeamCharacterContext.Provider>
            ) : (
              fallback
            )
          ) : (
            <TeamSetting teamId={teamId} teamData={teamData} />
          )}
        </CardThemed>
      )}
    </Box>
  )
}
function InnerContent({ tab }: { tab?: string }) {
  const database = useDatabase()
  const {
    teamCharId,
    teamChar: { key: characterKey },
    loadoutDatum,
  } = useContext(TeamCharacterContext)
  const character = useCharacter(characterKey as CharacterKey)
  const CharacterContextValue: CharacterContextObj | undefined = useMemo(
    () =>
      character && {
        character,
      },
    [character]
  )

  const [chartData, setChartDataState] = useState<ChartData | undefined>(
    chartDataAll[teamCharId]
  )
  const [graphBuilds, setGraphBuildState] = useState<
    GeneratedBuild[] | undefined
  >(graphBuildAll[teamCharId])
  useEffect(() => {
    setChartDataState(chartDataAll[teamCharId])
    setGraphBuildState(graphBuildAll[teamCharId])
  }, [teamCharId, setChartDataState, setGraphBuildState])

  const graphContextValue: GraphContextObj | undefined = useMemo(() => {
    return {
      chartData,
      setChartData: (data) => {
        if (data) chartDataAll[teamCharId] = data
        setChartDataState(data)
      },
      graphBuilds,
      setGraphBuilds: (data) => {
        if (data) graphBuildAll[teamCharId] = data
        setGraphBuildState(data)
      },
    }
  }, [
    teamCharId,
    chartData,
    graphBuilds,
    setChartDataState,
    setGraphBuildState,
  ])
  const buildTc = useBuildTc(loadoutDatum.buildTcId)!
  const setBuildTc = useCallback(
    (data: SetBuildTcAction) => {
      database.buildTcs.set(loadoutDatum.buildTcId, data)
    },
    [loadoutDatum.buildTcId, database]
  )
  const buildTCContextObj = useMemo(
    () =>
      ({
        buildTc: loadoutDatum.buildType === 'tc' ? buildTc : undefined,
        setBuildTc,
      }) as BuildTcContexObj,
    [buildTc, loadoutDatum.buildType, setBuildTc]
  )
  if (!CharacterContextValue) return fallback
  return (
    <CharacterContext.Provider value={CharacterContextValue}>
      <BuildTcContext.Provider value={buildTCContextObj}>
        <GraphContext.Provider value={graphContextValue}>
          <FormulaDataWrapper>
            <OptTargetWrapper>
              <Routes>
                <Route path=":characterKey">
                  <Route
                    path="*"
                    index
                    element={
                      <Content
                        key={`${characterKey}${loadoutDatum.teamCharId}${loadoutDatum.buildType === 'tc' ? loadoutDatum.buildTcId : loadoutDatum.buildId}`}
                        tab={tab}
                      />
                    }
                  />
                </Route>
              </Routes>
            </OptTargetWrapper>
          </FormulaDataWrapper>
        </GraphContext.Provider>
      </BuildTcContext.Provider>
    </CharacterContext.Provider>
  )
}
