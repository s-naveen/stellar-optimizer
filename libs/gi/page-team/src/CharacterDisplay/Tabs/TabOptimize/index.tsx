import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import {
  useBoolState,
  useMediaQueryUp,
} from '@genshin-optimizer/common/react-util'
import {
  BootstrapTooltip,
  CardThemed,
  DropdownButton,
  ModalWrapper,
  useConstObj,
  usePrev,
} from '@genshin-optimizer/common/ui'
import {
  bulkCatTotal,
  notEmpty,
  objKeyMap,
  objPathValue,
  range,
} from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { GeneratedBuild, OptConfig } from '@genshin-optimizer/gi/db'
import { maxBuildsToShowList } from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useArtifacts,
  useDatabase,
  useDBMeta,
  useGeneratedBuildList,
  useOptConfig,
  useTeammateArtifactIds,
  useWeapon,
} from '@genshin-optimizer/gi/db-ui'
import type { OptProblemInput } from '@genshin-optimizer/gi/solver'
import {
  GOSolver,
  mergeBuilds,
  mergePlot,
  prewarmSolver,
} from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import {
  BuildDisplayItem,
  CharacterName,
  DataContext,
  GraphContext,
  getTeamData,
  NoArtWarning,
  resolveInfo,
  statFilterToNumNode,
  useGlobalError,
  useNumWorkers,
  useTeamData,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { dynamicData, mergeData, optimize } from '@genshin-optimizer/gi/wr'
import { Close, DeleteForever, Science, TrendingUp } from '@mui/icons-material'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import CloseIcon from '@mui/icons-material/Close'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import {
  Box,
  Button,
  ButtonGroup,
  CardContent,
  CardHeader,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material'
import type React from 'react'
import type { FormEventHandler, ReactNode } from 'react'
import {
  memo,
  Suspense,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import useCompareData from '../../../useCompareData'
import ArtifactSetConfig from './Components/ArtifactSetConfig'
import BonusStatsCard from './Components/BonusStatsCard'
import type { BuildStatus, BuildStatusStore } from './Components/BuildAlert'
import BuildAlert from './Components/BuildAlert'
import { BuildsHeader } from './Components/BuildsHeader'
import ChartCard from './Components/ChartCard'
import { OptCharacterCard } from './Components/OptCharacterCard'
import OptimizationTargetSelector from './Components/OptimizationTargetSelector'
import {
  ArtifactPoolCard,
  LevelFilterCard,
  MainStatCard,
  MultiTargetCard,
} from './Components/OptSettingsCards'
import StatFilterCard from './Components/StatFilterCard'
import UseEquipped from './Components/UseEquipped'

function initBuildStatus(): BuildStatus {
  return {
    type: 'inactive',
    tested: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    testedPerSecond: 0,
    skippedPerSecond: 0,
  }
}
/**
 * Resolves once the browser has had a chance to paint. Falls back to a timer, since
 * `requestAnimationFrame` does not fire in background tabs.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 50)
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(timer)
        resolve()
      }, 0)
    )
  })
}
/**
 * Build status, published outside of React state so that the Generate/Cancel
 * button and the progress alert update instantly without re-rendering the
 * whole tab (which is expensive: every build card recomputes its stats).
 */
function createBuildStatusStore(initial: BuildStatus): BuildStatusStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (status) => {
      current = status
      listeners.forEach((l) => l())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
const audio = new Audio('assets/notification.mp3')
export default function TabBuild() {
  const { t } = useTranslation('page_character_optimize')
  const {
    loadoutDatum,
    teamCharId,
    teamChar: { optConfigId, key: characterKey },
    teamId,
  } = useContext(TeamCharacterContext)
  const database = useDatabase()
  const { setChartData, graphBuilds, setGraphBuilds } = useContext(GraphContext)
  const { gender } = useDBMeta()

  const activeCharKey = database.teams.getActiveTeamChar(teamId)!.key

  const [notification, setnotification] = useState(false)
  const notificationRef = useRef(notification)
  notificationRef.current = notification

  /** Urgent status: drives the Generate/Cancel button and the progress alert */
  const [statusStore] = useState(() =>
    createBuildStatusStore(initBuildStatus())
  )
  /**
   * The same status as React state, always updated in a transition: it disables
   * the rest of the tab (settings, build list), which is expensive to re-render,
   * so that work never delays the button feedback.
   */
  const [buildStatus, setBuildStatus] = useState(() => initBuildStatus())
  const publishStatus = useCallback(
    (status: BuildStatus) => {
      statusStore.set(status)
      startTransition(() => setBuildStatus(status))
    },
    [statusStore]
  )
  /** Live progress of the running solver, polled by `BuildAlert` */
  const liveStatus = useRef<Omit<BuildStatus, 'type'>>()
  /** Id of the latest run; an older run must not touch the shared run state */
  const latestRun = useRef(0)
  const generatingBuilds = buildStatus.type !== 'inactive'
  // Load a solver worker while the user sets up the run, so that the first run starts at once
  useEffect(() => prewarmSolver(), [])

  const [maxWorkers, nativeThreads, setMaxWorkers] = useNumWorkers()

  // Clear state when changing characters
  if (usePrev(characterKey) !== characterKey) setBuildStatus(initBuildStatus())
  useEffect(
    () => statusStore.set(initBuildStatus()),
    [characterKey, statusStore]
  )

  const noArtifact = useMemo(() => !database.arts.values.length, [database])

  const buildSetting = useOptConfig(optConfigId)!
  const {
    plotBase,
    optimizationTarget: optimizationTargetDb,
    mainStatAssumptionLevel,
    allowPartial,
    maxBuildsToShow,
    levelLow,
    levelHigh,
    generatedBuildListId,
    useTeammateBuild,
  } = buildSetting
  const { builds: buildsDb, buildDate } = useGeneratedBuildList(
    generatedBuildListId ?? ''
  ) ?? { builds: [] as GeneratedBuild[] }

  const builds = useConstObj(buildsDb)
  const optimizationTarget = useConstObj(optimizationTargetDb)
  const { data } = useContext(DataContext)
  const compareData = useCompareData()
  const optimizationTargetNode =
    optimizationTarget && objPathValue(data?.getDisplay(), optimizationTarget)
  const isSM = ['xs', 'sm'].includes(useMediaQueryUp())
  const deferredBuildSetting = useDeferredValue(buildSetting)
  const teammateArtifactIds = useTeammateArtifactIds()
  const allArts = useDataManagerValues(database.arts)
  /**
   * Filter the artifacts down to the pool the optimizer is allowed to use for
   * the given opt config. The opt config is passed in as an argument (instead
   * of being read from `buildSetting`) so that callers can filter with the
   * latest settings, even while the rendered `filteredArts` is still deferred.
   */
  const getFilteredArts = useCallback(
    (optConfig: OptConfig) => {
      const {
        mainStatKeys,
        excludedLocations,
        artExclusion,
        levelLow,
        levelHigh,
        useExcludedArts,
        useTeammateBuild,
      } = optConfig

      return allArts.filter((art) => {
        if (!useExcludedArts && artExclusion.includes(art.id)) return false
        if (!useTeammateBuild && teammateArtifactIds.includes(art.id))
          return false
        if (art.level < levelLow) return false
        if (art.level > levelHigh) return false
        const mainStats = mainStatKeys[art.slotKey]
        if (mainStats?.length && !mainStats.includes(art.mainStatKey))
          return false

        const locKey = charKeyToLocCharKey(characterKey)

        if (
          art.location &&
          art.location !== locKey &&
          excludedLocations.includes(art.location)
        )
          return false

        return true
      })
    },
    [allArts, teammateArtifactIds, characterKey]
  )
  const filteredArts = useMemo(
    () => getFilteredArts(deferredBuildSetting),
    [getFilteredArts, deferredBuildSetting]
  )

  const filteredArtIdMap = useMemo(
    () =>
      objKeyMap(
        filteredArts.map(({ id }) => id),
        (_) => true
      ),
    [filteredArts]
  )
  const artEntries = useDataManagerEntries(database.arts)
  const { levelTotal, allowListTotal, excludedTotal, teammateBuildTotal } =
    useMemo(() => {
      const catKeys = {
        levelTotal: ['in'],
        allowListTotal: ['in'],
        excludedTotal: ['in'],
        teammateBuildTotal: ['in'],
      } as const
      return bulkCatTotal(catKeys, (ctMap) =>
        artEntries.forEach(([id, art]) => {
          const { level, location } = art
          const { levelLow, levelHigh, excludedLocations, artExclusion } =
            deferredBuildSetting
          if (level >= levelLow && level <= levelHigh) {
            ctMap['levelTotal']['in'].total++
            if (filteredArtIdMap[id]) ctMap['levelTotal']['in'].current++
          }
          const locKey = charKeyToLocCharKey(characterKey)
          if (
            location &&
            location !== locKey &&
            !excludedLocations.includes(location)
          ) {
            ctMap['allowListTotal']['in'].total++
            if (filteredArtIdMap[id]) ctMap['allowListTotal']['in'].current++
          }
          if (artExclusion.includes(id)) {
            ctMap['excludedTotal']['in'].total++
            if (filteredArtIdMap[id]) ctMap['excludedTotal']['in'].current++
          }
          if (teammateArtifactIds.includes(id)) {
            ctMap['teammateBuildTotal']['in'].total++
            if (filteredArtIdMap[id])
              ctMap['teammateBuildTotal']['in'].current++
          }
        })
      )
    }, [
      characterKey,
      artEntries,
      deferredBuildSetting,
      filteredArtIdMap,
      teammateArtifactIds,
    ])

  const tabFocused = useRef(true)
  useEffect(() => {
    const onFocus = () => (tabFocused.current = true)
    const onBlur = () => (tabFocused.current = false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [tabFocused])

  // Provides a function to cancel the work
  const cancelToken = useRef(() => {})
  const cancelBuilds = useCallback(() => cancelToken.current(), [])
  //terminate worker when component unmounts
  useEffect(() => () => cancelToken.current(), [])
  const throwGlobalError = useGlobalError()

  const generateBuilds = useCallback(async () => {
    const {
      artSetExclusion,
      plotBase,
      statFilters,
      optimizationTarget,
      mainStatAssumptionLevel,
      allowPartial,
      maxBuildsToShow,
    } = buildSetting
    if (!characterKey || !optimizationTarget) return
    if (notificationRef.current) Notification?.requestPermission()
    const runId = ++latestRun.current

    // Show the "generating" state right away and let the browser paint it before
    // doing any heavy work, so that the click feels instant. The progress itself
    // is read from `status` by `BuildAlert` (via `liveStatus`), without
    // re-rendering this whole tab.
    const status: Omit<BuildStatus, 'type'> = {
      tested: 0,
      failed: 0,
      skipped: 0,
      total: Number.NaN,
      testedPerSecond: 0,
      skippedPerSecond: 0,
      startTime: performance.now(),
    }
    liveStatus.current = status
    const cancellationError = new Error()
    let isCancelled = false
    const cancelled = new Promise<void>((r) => {
      cancelToken.current = () => {
        isCancelled = true
        r()
      }
    })
    publishStatus({ type: 'active', ...status })
    let started = false
    let finalStatus: BuildStatus | undefined
    try {
      await nextPaint()
      if (isCancelled) throw cancellationError

      // Filter with the latest settings rather than the deferred `filteredArts`,
      // so that a build started right after a settings change does not use an
      // outdated artifact pool. (#1120)
      const split = compactArtifacts(
        getFilteredArts(buildSetting),
        mainStatAssumptionLevel,
        allowPartial
      )

      const teamData = getTeamData(
        database,
        teamId,
        teamCharId,
        mainStatAssumptionLevel,
        []
      )
      if (!teamData) return
      const workerData = uiDataForTeam(
        teamData.teamData,
        gender,
        activeCharKey
      )[characterKey]?.target.data[0]
      if (!workerData) return
      Object.assign(workerData, mergeData([workerData, dynamicData])) // Mark art fields as dynamic
      const unoptimizedOptimizationTargetNode = objPathValue(
        workerData.display ?? {},
        optimizationTarget
      ) as NumNode | undefined
      if (!unoptimizedOptimizationTargetNode) return
      const targetNode = unoptimizedOptimizationTargetNode
      const valueFilter = statFilterToNumNode(workerData, statFilters)

      startTransition(() => setChartData(undefined))

      const unoptimizedNodes = [
        ...valueFilter.map((x) => x.value),
        unoptimizedOptimizationTargetNode,
      ]
      const minimum = [
        ...valueFilter.map((x) => x.minimum),
        Number.NEGATIVE_INFINITY,
      ]
      const plotBaseNumNode: NumNode =
        plotBase && objPathValue(workerData.display ?? {}, plotBase)
      if (plotBaseNumNode) {
        unoptimizedNodes.push(plotBaseNumNode)
        minimum.push(Number.NEGATIVE_INFINITY)
      }

      const nodes = optimize(
        unoptimizedNodes,
        workerData,
        ({ path: [p] }) => p !== 'dyn'
      )
      const plotBaseNode = plotBaseNumNode ? nodes.pop() : undefined
      const optimizationTargetNode = nodes.pop()!

      const problem: OptProblemInput = {
        arts: split,
        optimizationTarget: optimizationTargetNode,
        exclusion: artSetExclusion,
        constraints: nodes.map((value, i) => ({ value, min: minimum[i] })),

        topN: maxBuildsToShow,
        plotBase: plotBaseNode,
      }
      if (isCancelled) throw cancellationError
      started = true
      const solver = new GOSolver(problem, status, maxWorkers)
      cancelled.then(() => solver.cancel(cancellationError))

      const results = await solver.solve()
      solver.cancel() // Done using `solver`

      cancelToken.current = () => {}
      // Show "done" before committing the builds: re-rendering the build list
      // takes a moment, and the run is over as soon as the solver is.
      finalStatus = {
        type: 'inactive',
        ...status,
        finishTime: performance.now(),
      }
      publishStatus(finalStatus)
      await nextPaint()
      const weaponId = database.teams.getLoadoutWeapon(loadoutDatum).id
      if (plotBaseNumNode) {
        const plotData = mergePlot(results.map((x) => x.plotData!))
        const solverBuilds = Object.values(plotData)
        const targetNodeinfo = targetNode.info && resolveInfo(targetNode.info)
        const plotBaseNumNodeInfo =
          plotBaseNumNode.info && resolveInfo(plotBaseNumNode.info)
        if (targetNodeinfo?.unit === '%')
          solverBuilds.forEach(
            (dataEntry) =>
              dataEntry && (dataEntry.value = dataEntry.value * 100)
          )
        if (plotBaseNumNodeInfo?.unit === '%')
          solverBuilds.forEach(
            (dataEntry) =>
              dataEntry && (dataEntry.plot = (dataEntry.plot ?? 0) * 100)
          )
        const chartData = {
          valueNode: targetNode,
          plotNode: plotBaseNumNode,
          data: solverBuilds
            .filter(notEmpty)
            .map(({ value, plot, artifactIds }) => ({
              artifactIds: objKeyMap(allArtifactSlotKeys, (slotKey) =>
                artifactIds.find(
                  (aId) => database.arts.get(aId)?.slotKey === slotKey
                )
              ),
              weaponId,
              value,
              plot,
            })),
        }
        startTransition(() => setChartData(chartData))
      }
      const builds = mergeBuilds(
        results.map((x) => x.builds),
        maxBuildsToShow
      )
      if (process.env['NODE_ENV'] === 'development')
        console.log('Build Result', builds)

      database.optConfigs.newOrSetGeneratedBuildList(optConfigId, {
        builds: builds.map((build) => ({
          artifactIds: objKeyMap(allArtifactSlotKeys, (slotKey) =>
            build.artifactIds.find(
              (aId) => database.arts.get(aId)?.slotKey === slotKey
            )
          ),
          weaponId,
        })),
        buildDate: Date.now(),
      })

      setTimeout(async () => {
        // Using a ref because a user can cancel the notification while the build is going.
        if (results && notificationRef.current) {
          audio.play()
          if (!tabFocused.current)
            if (Notification?.permission === 'granted')
              new Notification('Stellar Optimizer', {
                body: t('buildCompleted'),
                icon: './favicon.ico',
              })
            else setTimeout(() => window.alert(t('buildCompleted')), 1)
        }
      }, 100)
    } catch (e) {
      // Worker error, cancelled, printer catches on fire, etc.
      if (e !== cancellationError) {
        console.log('Failed to load worker')
        console.log(e)
        if (e instanceof Error) throwGlobalError(e)
      }

      if (latestRun.current === runId) cancelToken.current()
      status.tested = 0
      status.failed = 0
      status.skipped = 0
      status.total = 0
      finalStatus = undefined
    } finally {
      // Once "done" is shown, a new run may start before this one has committed
      // its builds; that run owns the shared state from then on.
      if (latestRun.current === runId) {
        cancelToken.current = () => {}
        liveStatus.current = undefined
        // A run that never started (setup bailed out or was cancelled) leaves no alert behind
        if (!finalStatus)
          publishStatus(
            started
              ? { type: 'inactive', ...status, finishTime: performance.now() }
              : initBuildStatus()
          )
      }
    }
  }, [
    buildSetting,
    characterKey,
    getFilteredArts,
    database,
    teamId,
    teamCharId,
    gender,
    activeCharKey,
    setChartData,
    maxWorkers,
    loadoutDatum,
    optConfigId,
    publishStatus,
    t,
    throwGlobalError,
  ])

  const characterName = (
    <CharacterName characterKey={characterKey} gender={gender} />
  )

  const setPlotBase = useCallback(
    (plotBase: string[] | undefined) => {
      database.optConfigs.set(optConfigId, { plotBase })
      setChartData(undefined)
    },
    [database, optConfigId, setChartData]
  )

  const targetSelector = (
    <OptimizationTargetSelector
      optimizationTarget={optimizationTarget}
      setTarget={(target) =>
        database.optConfigs.set(optConfigId, { optimizationTarget: target })
      }
      disabled={!!generatingBuilds}
      // the first step of an optimization: the main action until a target is picked
      buttonProps={{
        sx: { flexGrow: 1, ...(optimizationTarget ? {} : giCtaSx) },
      }}
      targetSelectorModalProps={{
        excludeSections: ['character', 'bonusStats', 'teamBuff'],
      }}
    />
  )

  const getGraphBuildLabel = useCallback(
    (index: number) => (
      <Trans t={t} i18nKey="graphBuildLabel" count={index + 1}>
        Graph #{{ count: index + 1 }}
      </Trans>
    ),
    [t]
  )
  const getNormBuildLabel = useCallback((index: number) => `#${index + 1}`, [])

  const buildShowingCount =
    builds.length + (graphBuilds ? graphBuilds.length : 0)

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {noArtifact && <NoArtWarning />}
      {/* Build Generator Editor */}
      <Grid container spacing={1}>
        {/* 1*/}
        <Grid
          item
          xs={12}
          sm={6}
          lg={3}
          display="flex"
          flexDirection="column"
          gap={1}
        >
          <OptCharacterCard characterKey={characterKey} />
          <BonusStatsCard />
          <MultiTargetCard />
        </Grid>
        {/* 2 */}
        <Grid
          item
          xs={12}
          sm={6}
          lg={4}
          display="flex"
          flexDirection="column"
          gap={1}
        >
          {/* Level Filter */}
          <LevelFilterCard
            levelTotal={levelTotal['in']}
            levelLow={levelLow}
            levelHigh={levelHigh}
            disabled={generatingBuilds}
            optConfigId={optConfigId}
          />

          <MainStatCard
            disabled={generatingBuilds}
            filteredArtIdMap={filteredArtIdMap}
            mainStatAssumptionLevel={mainStatAssumptionLevel}
            optConfigId={optConfigId}
          />

          <ArtifactPoolCard
            disabled={generatingBuilds}
            excludedTotal={excludedTotal['in']}
            teammateBuildTotal={teammateBuildTotal['in']}
            useTeammateBuild={useTeammateBuild}
            allowPartial={allowPartial}
            optConfigId={optConfigId}
          />
        </Grid>

        {/* 3 */}
        <Grid
          item
          xs={12}
          sm={6}
          lg={5}
          display="flex"
          flexDirection="column"
          gap={1}
        >
          <ArtifactSetConfig disabled={generatingBuilds} />

          {/* use equipped */}
          <UseEquipped
            disabled={generatingBuilds}
            allowListTotal={allowListTotal['in']}
          />

          {/*Minimum Final Stat Filter */}
          <StatFilterCard disabled={generatingBuilds} />
        </Grid>
      </Grid>
      {/* Footer: sticks to the bottom of the screen while the filters above are being set, so
          choosing the target and generating never needs a scroll; settles in place above the
          results once they are scrolled into view. */}
      <Box
        sx={{
          position: 'sticky',
          bottom: 8,
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          borderRadius: 2,
          bgcolor: 'rgba(12, 16, 32, 0.96)',
          outline: '1px solid rgba(160, 180, 255, 0.14)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        {isSM && targetSelector}
        <ButtonGroup>
          {!isSM && targetSelector}
          <DropdownButton
            disabled={generatingBuilds || !characterKey || !optimizationTarget}
            title={
              <Trans t={t} i18nKey="build" count={maxBuildsToShow}>
                {{ count: maxBuildsToShow }} Builds
              </Trans>
            }
          >
            <MenuItem>
              <Typography variant="caption" color="info.main">
                {t('buildDropdownDesc')}
              </Typography>
            </MenuItem>
            <Divider />
            {maxBuildsToShowList.map((v) => (
              <MenuItem
                key={v}
                onClick={() =>
                  database.optConfigs.set(optConfigId, { maxBuildsToShow: v })
                }
              >
                <Trans t={t} i18nKey="build" count={v}>
                  {{ count: v }} Builds
                </Trans>
              </MenuItem>
            ))}
          </DropdownButton>
          <DropdownButton
            disabled={generatingBuilds || !characterKey || !optimizationTarget}
            sx={{ borderRadius: '4px 0px 0px 4px' }}
            title={
              <Trans t={t} i18nKey="thread" count={maxWorkers}>
                {{ count: maxWorkers }} Threads
              </Trans>
            }
          >
            <MenuItem>
              <Typography variant="caption" color="info.main">
                {t('threadDropdownDesc')}
              </Typography>
            </MenuItem>
            <Divider />
            {range(1, nativeThreads)
              .reverse()
              .map((v) => (
                <MenuItem key={v} onClick={() => setMaxWorkers(v)}>
                  <Trans t={t} i18nKey="thread" count={v}>
                    {{ count: v }} Threads
                  </Trans>
                </MenuItem>
              ))}
          </DropdownButton>
          <BootstrapTooltip placement="top" title={t('notifyTooltip')}>
            <Box>
              <Button
                sx={{ borderRadius: 0 }}
                color="warning"
                onClick={async () => {
                  await Notification?.requestPermission()
                  setnotification((n) => !n)
                }}
                disabled={!optimizationTarget}
              >
                {notification ? (
                  <NotificationsActiveIcon />
                ) : (
                  <NotificationsOffIcon />
                )}
              </Button>
            </Box>
          </BootstrapTooltip>
          <BootstrapTooltip
            placement="top"
            title={!optimizationTarget ? t('selectTargetFirst') : ''}
          >
            <span>
              <GenerateButton
                store={statusStore}
                disabled={
                  !characterKey ||
                  !optimizationTarget ||
                  !optimizationTargetNode
                }
                cta={!!optimizationTarget && !!optimizationTargetNode}
                onGenerate={generateBuilds}
                onCancel={cancelBuilds}
              />
            </span>
          </BootstrapTooltip>
        </ButtonGroup>
      </Box>
      {!!characterKey && (
        <BuildAlert
          {...{
            store: statusStore,
            live: liveStatus,
            characterName,
            maxBuildsToShow,
          }}
        />
      )}
      {optimizationTarget && (
        <Box>
          <ChartCard
            disabled={generatingBuilds || !optimizationTarget}
            plotBase={plotBase}
            setPlotBase={setPlotBase}
            showTooltip={!optimizationTarget}
          />
        </Box>
      )}
      {optimizationTarget && (
        <BuildsHeader
          count={buildShowingCount}
          buildDate={buildDate}
          canClear={!!builds.length}
          onClear={() => {
            setGraphBuilds(undefined)
            database.optConfigs.newOrSetGeneratedBuildList(optConfigId, {
              builds: [],
              buildDate: 0,
            })
          }}
        />
      )}

      {graphBuilds && (
        <BuildList
          builds={graphBuilds}
          compareData={compareData}
          disabled={!!generatingBuilds}
          getLabel={getGraphBuildLabel}
          setBuilds={setGraphBuilds}
          mainStatAssumptionLevel={mainStatAssumptionLevel}
        />
      )}
      <BuildList
        builds={builds}
        compareData={compareData}
        disabled={!!generatingBuilds}
        getLabel={getNormBuildLabel}
        mainStatAssumptionLevel={mainStatAssumptionLevel}
      />
    </Box>
  )
}

const BuildList = memo(function BuildList({
  builds,
  setBuilds,
  compareData,
  disabled,
  getLabel,
  mainStatAssumptionLevel,
}: {
  builds: GeneratedBuild[]
  setBuilds?: (builds: GeneratedBuild[] | undefined) => void
  compareData?: UIData
  disabled: boolean
  getLabel: (index: number) => ReactNode
  mainStatAssumptionLevel: number
}) {
  const deleteBuild = useCallback(
    (index: number) => {
      if (setBuilds) {
        const builds_ = [...builds]
        builds_.splice(index, 1)
        setBuilds(builds_)
      }
    },
    [builds, setBuilds]
  )
  // retrive this value because inner calcs depends on this
  const teamCharacterContextValue = useContext(TeamCharacterContext)
  const {
    teamChar: { key: characterKey },
  } = teamCharacterContextValue
  return (
    <Suspense
      fallback={<Skeleton variant="rectangular" width="100%" height={600} />}
    >
      {builds?.map((build, index) => (
        <Staggered
          key={index + Object.values(build.artifactIds).join()}
          order={index}
        >
          <DataContextWrapper
            characterKey={characterKey}
            build={build}
            compareData={compareData}
            mainStatAssumptionLevel={mainStatAssumptionLevel}
          >
            <BuildItemWrapper
              index={index}
              label={getLabel(index)}
              build={build}
              disabled={disabled}
              deleteBuild={setBuilds ? deleteBuild : undefined}
              mainStatAssumptionLevel={mainStatAssumptionLevel}
            />
          </DataContextWrapper>
        </Staggered>
      ))}
    </Suspense>
  )
})
/**
 * Mounts `children` lazily, with a same-sized placeholder meanwhile. Every build
 * card computes the full team stats for its build when it mounts, so a new result
 * list must not mount them all at once: the first card mounts right away, the
 * others once they come within ~2 cards of the viewport, at most one per frame.
 */
function Staggered({
  order,
  children,
}: {
  order: number
  children: ReactNode
}) {
  const [ready, setReady] = useState(order === 0)
  const [near, setNear] = useState(order === 0)
  const placeholder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (near) return
    const el = placeholder.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        observer.disconnect()
        setNear(true)
      },
      { rootMargin: '1200px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [near])
  useEffect(() => {
    if (ready || !near) return
    let frames = order
    let id = 0
    const step = () => {
      if (--frames <= 0) startTransition(() => setReady(true))
      else id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [ready, near, order])
  return ready ? (
    children
  ) : (
    <Skeleton
      ref={placeholder}
      variant="rectangular"
      width="100%"
      height={600}
    />
  )
}
/** The Generate/Cancel button, subscribed to the build status directly so that it flips instantly */
const GenerateButton = memo(function GenerateButton({
  store,
  disabled,
  cta,
  onGenerate,
  onCancel,
}: {
  store: BuildStatusStore
  disabled: boolean
  /** once there is a target, generating is the main action */
  cta: boolean
  onGenerate: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('page_character_optimize')
  const generating =
    useSyncExternalStore(store.subscribe, store.get).type !== 'inactive'
  return (
    <Button
      disabled={disabled}
      color={generating ? 'error' : 'success'}
      onClick={generating ? onCancel : onGenerate}
      startIcon={generating ? <Close /> : <TrendingUp />}
      sx={{
        borderRadius: '0px 8px 8px 0px',
        ...(!generating && cta && giCtaSx),
      }}
    >
      {generating
        ? t('generateButton.cancel')
        : t('generateButton.generateBuilds')}
    </Button>
  )
})
const BuildItemWrapper = memo(function BuildItemWrapper({
  index,
  label,
  build,
  disabled,
  deleteBuild,
  mainStatAssumptionLevel,
}: {
  index: number
  label: ReactNode
  build: GeneratedBuild
  disabled: boolean
  deleteBuild?: (index: number) => void
  mainStatAssumptionLevel: number
}) {
  const { t } = useTranslation('page_character_optimize')
  const extraButtonsLeft = useMemo(() => {
    return (
      <>
        <CopyTcButton build={build} />
        <CopyBuildButton build={build} />
        {deleteBuild && (
          <Button
            color="error"
            size="small"
            startIcon={<DeleteForever />}
            onClick={() => deleteBuild(index)}
          >
            {t('removeBuildButton')}
          </Button>
        )}
      </>
    )
  }, [build, deleteBuild, index, t])
  return (
    <BuildDisplayItem
      label={label}
      disabled={disabled}
      extraButtonsLeft={extraButtonsLeft}
      mainStatAssumptionLevel={mainStatAssumptionLevel}
    />
  )
})
function CopyTcButton({ build }: { build: GeneratedBuild }) {
  const { t } = useTranslation('build')
  const [name, setName] = useState('')
  const [showTcPrompt, onShowTcPrompt, OnHideTcPrompt] = useBoolState()

  const database = useDatabase()
  const {
    loadoutDatum,
    teamCharId,
    teamChar: { key: characterKey },
  } = useContext(TeamCharacterContext)

  const toTc = () => {
    const weapon = database.teams.getLoadoutWeapon(loadoutDatum)
    const buildTcId = database.buildTcs.newFromBuild(
      characterKey,
      weapon,
      Object.values(build.artifactIds).map((id) => database.arts.get(id)),
      teamCharId
    )
    if (buildTcId)
      database.buildTcs.set(buildTcId, {
        name,
      })

    setName('')
    OnHideTcPrompt()
  }
  return (
    <>
      <Button
        color="info"
        size="small"
        startIcon={<Science />}
        onClick={onShowTcPrompt}
      >
        {t('createBuildTc.button')}
      </Button>
      {/* TODO: Dialog Wanted to use a Dialog here, but was having some weird issues with closing out of it */}
      <ModalWrapper open={showTcPrompt} onClose={OnHideTcPrompt}>
        <CardThemed>
          <CardHeader
            title={t('createBuildTc.title')}
            action={
              <IconButton onClick={OnHideTcPrompt}>
                <CloseIcon />
              </IconButton>
            }
          />
          <Divider />
          <CardContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <Typography>{t('createBuildTc.desc')}</Typography>
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              margin="dense"
              label={t('createBuildTc.label')}
              fullWidth
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={OnHideTcPrompt}>
                {t('createBuildTc.cancel')}
              </Button>
              <Button color="success" disabled={!name} onClick={toTc}>
                {t('createBuildTc.create')}
              </Button>
            </Box>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}
function CopyBuildButton({
  build: { artifactIds, weaponId },
}: {
  build: GeneratedBuild
}) {
  const { t } = useTranslation('build')
  const [name, setName] = useState('')
  const [showPrompt, onShowPrompt, OnHidePrompt] = useBoolState()

  const database = useDatabase()
  const {
    teamCharId,
    teamChar: { key: characterKey },
  } = useContext(TeamCharacterContext)

  const toLoadout: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    database.builds.new({
      characterKey,
      name,
      artifactIds,
      weaponId,
      srcTeamCharId: teamCharId,
    })

    setName('')
    OnHidePrompt()
  }
  return (
    <>
      <Button
        color="info"
        size="small"
        startIcon={<CheckroomIcon />}
        onClick={onShowPrompt}
      >
        {t('createBuildReal.button')}
      </Button>
      {/* TODO: Dialog Wanted to use a Dialog here, but was having some weird issues with closing out of it */}
      <ModalWrapper
        open={showPrompt}
        onClose={OnHidePrompt}
        disableRestoreFocus
      >
        <CardThemed>
          <CardHeader
            title={t('createBuildReal.title')}
            action={
              <IconButton onClick={OnHidePrompt}>
                <CloseIcon />
              </IconButton>
            }
          />
          <Divider />
          <CardContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <Typography>{t('createBuildReal.desc')}</Typography>
            <form onSubmit={toLoadout}>
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                margin="dense"
                label={t('createBuildReal.label')}
                fullWidth
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={OnHidePrompt}>
                  {t('createBuildReal.cancel')}
                </Button>
                <Button type="submit" color="success" disabled={!name}>
                  {t('createBuildReal.create')}
                </Button>
              </Box>
            </form>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}

type Prop = {
  children: React.ReactNode
  characterKey: CharacterKey
  build: GeneratedBuild
  compareData?: UIData
  mainStatAssumptionLevel: number
}
const DataContextWrapper = memo(function DataContextWrapper({
  children,
  characterKey,
  build,
  compareData,
  mainStatAssumptionLevel,
}: Prop) {
  const { artifactIds, weaponId } = build

  const artifacts = useArtifacts(artifactIds)
  const buildsArts = useMemo(
    () => Object.values(artifacts).filter(notEmpty),
    [artifacts]
  )
  const buildWeapon = useWeapon(weaponId)
  const teamData = useTeamData(mainStatAssumptionLevel, buildsArts, buildWeapon)
  const providerValue = useMemo(() => {
    const tdc = teamData?.[characterKey]
    if (!tdc) return undefined
    return { data: tdc.target, teamData, compareData }
  }, [teamData, compareData, characterKey])
  if (!providerValue) return null
  return (
    <DataContext.Provider value={providerValue}>
      {children}
    </DataContext.Provider>
  )
})
