import { useForceUpdate } from '@genshin-optimizer/common/react-util'
import { CardThemed } from '@genshin-optimizer/common/ui'
import {
  bulkCatTotal,
  clamp,
  filterFunction,
  notEmpty,
  objKeyMap,
  objPathValue,
  range,
} from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
  artSlotMainKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtSetExclusionKey,
  ICachedArtifact,
  OptConfig,
} from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useLoadoutArtifacts,
  useOptConfig,
  useTeammateArtifactIds,
} from '@genshin-optimizer/gi/db-ui'
import {
  type FilterOption,
  initialFilterOption,
} from '@genshin-optimizer/gi/schema'
import type { dataContextObj } from '@genshin-optimizer/gi/ui'
import {
  AddArtInfo,
  ArtifactEditor,
  DataContext,
  getTeamData,
  NoArtWarning,
  resolveInfo,
} from '@genshin-optimizer/gi/ui'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { artifactFilterConfigs } from '@genshin-optimizer/gi/util'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { dynamicData, mergeData, optimize } from '@genshin-optimizer/gi/wr'
import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Box,
  CardContent,
  Grid,
  Pagination,
  Skeleton,
  Typography,
} from '@mui/material'
import { Stack } from '@mui/system'
import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import ArtifactSetConfig from '../TabOptimize/Components/ArtifactSetConfig'
import BonusStatsCard from '../TabOptimize/Components/BonusStatsCard'
import MainStatSelectionCard from '../TabOptimize/Components/MainStatSelectionCard'
import { OptCharacterCard } from '../TabOptimize/Components/OptCharacterCard'
import { MultiTargetCard } from '../TabOptimize/Components/OptSettingsCards'
import {
  SettingsCard,
  SettingsCardButton,
} from '../TabOptimize/Components/SettingsCard'
import StatFilterCard from '../TabOptimize/Components/StatFilterCard'
import {
  CraftingCard,
  ImproveToolbar,
  NoUpgradesAlert,
  UpgradeSearchCard,
} from './ImproveSections'
import { SubstatValueCard } from './SubstatValueCard'
import UpgradeOptChartCard from './UpgradeOptChartCard'
import { canReshape, UpOptCalculatorV2 } from './upOpt'

const filterOptionReducer = (
  state: Partial<FilterOption>,
  action: Partial<FilterOption>
) => ({ ...state, ...action })
/**
 * Whether swapping an artifact into the build keeps it within the artifact set rules (the
 * set exclusions of the Artifact sets settings).
 */
function setRulesPredicate(
  equippedArts: Record<ArtifactSlotKey, ICachedArtifact | undefined>,
  artSetExclusion: OptConfig['artSetExclusion']
) {
  const curEquipSetKeys = objKeyMap(
    allArtifactSlotKeys,
    (slotKey) => equippedArts[slotKey]?.setKey
  )
  function respectSexExclusion({
    slotKey,
    setKey,
  }: {
    slotKey: ArtifactSlotKey
    setKey: ArtifactSetKey
  }) {
    const newSK = { ...curEquipSetKeys }
    newSK[slotKey] = setKey
    const skc: Partial<Record<ArtifactSetKey, number>> = {}
    allArtifactSlotKeys.forEach((slotKey) => {
      const setKey = newSK[slotKey]
      if (!setKey) return
      if (setKey.startsWith('Prayers')) return
      skc[setKey] = (skc[setKey] ?? 0) + 1
    })
    const pass = Object.entries(skc).every(([setKey, num]) => {
      const ex = artSetExclusion[setKey as ArtSetExclusionKey]
      if (!ex) return true
      switch (num) {
        case 0:
        case 1:
          return true
        case 2:
        case 3:
          return !ex.includes(2)
        case 4:
        case 5:
          return !ex.includes(4)
        default:
          throw Error('error in respectSetExclude: num > 5')
      }
    })
    if (!pass) return false

    if (!artSetExclusion['rainbow']) return true
    const nRainbow = Object.values(skc).reduce((a, b) => a + (b % 2), 0)
    switch (nRainbow) {
      case 0:
      case 1:
        return true
      case 2:
      case 3:
        return !artSetExclusion['rainbow'].includes(2)
      case 4:
      case 5:
        return !artSetExclusion['rainbow'].includes(4)
      default:
        throw Error('error in respectSex: nRainbow > 5')
    }
  }
  return respectSexExclusion
}

export default function TabUpopt() {
  const { t } = useTranslation('page_character_optimize')

  const {
    teamId,
    teamCharId,
    teamChar: { optConfigId, key: characterKey },
    loadoutDatum,
  } = useContext(TeamCharacterContext)
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [filterOption, filterOptionDispatch] = useReducer(
    filterOptionReducer,
    initialFilterOption()
  )

  const [artifactIdToEdit, setArtifactIdToEdit] = useState<string | undefined>()

  const activeCharKey = database.teams.getActiveTeamChar(teamId)!.key

  const noArtifact = useMemo(() => !database.arts.values.length, [database])

  const optConfig = useOptConfig(optConfigId)!
  const {
    optimizationTarget,
    upOptLevelLow,
    upOptLevelHigh,
    upOptReshape,
    upOptReshapeRolls,
    upOptDefine,
    upOptDefineSubstats,
  } = optConfig
  // the team page's data (same team, member and no overrides): not worked out a second time
  const { teamData } = useContext(DataContext)
  const teammateArtifactIds = useTeammateArtifactIds()
  const { target: data } = teamData?.[characterKey as CharacterKey] ?? {}

  const [artsDirty, setArtsDirty] = useForceUpdate()
  /**
   * Only register new/removal for artifact, so that changes to artifact will not cause upopt recalc.
   * Artifact updates are captured in UpgradeOptChartCard.
   * This makes updating an calculated artifact will not update the calculator list.(and will not change place in the list)
   */
  useEffect(
    () =>
      database.arts.followAny(
        (_, reason) =>
          (reason === 'new' || reason === 'remove') && setArtsDirty()
      ),
    [setArtsDirty, database]
  )
  const filteredArts = useMemo(() => {
    const {
      mainStatKeys,
      excludedLocations,
      artExclusion,
      upOptLevelLow,
      upOptLevelHigh,
      upOptReshape,
      useExcludedArts,
      useTeammateBuild,
    } = optConfig
    const filterFunc = filterFunction(filterOption, artifactFilterConfigs())

    return (
      artsDirty &&
      database.arts.values
        .filter((art) => {
          const reshapeCandidate = upOptReshape && canReshape(art)
          if (!useTeammateBuild && teammateArtifactIds.includes(art.id))
            return false
          if (!useExcludedArts && artExclusion.includes(art.id)) return false
          const locKey = charKeyToLocCharKey(characterKey)
          if (
            art.location &&
            art.location !== locKey &&
            excludedLocations.includes(art.location)
          )
            return false
          if (!reshapeCandidate) {
            if (art.level < upOptLevelLow) return false
            if (art.level > upOptLevelHigh) return false
          }
          if (art.slotKey === 'flower' || art.slotKey === 'plume') return true

          const mainStats = mainStatKeys[art.slotKey]
          if (mainStats?.length && !mainStats.includes(art.mainStatKey))
            return false

          return true
        })
        .filter(filterFunc)
    )
  }, [
    optConfig,
    artsDirty,
    database,
    characterKey,
    filterOption,
    teammateArtifactIds,
  ])
  const filteredArtIdMap = useMemo(
    () =>
      objKeyMap(
        filteredArts.map(({ id }) => id),
        (_) => true
      ),
    [filteredArts]
  )
  const reshapeCandidateCount = useMemo(() => {
    void artsDirty
    return database.arts.values.filter(
      (art) =>
        canReshape(art) &&
        (art.slotKey === 'flower' ||
          art.slotKey === 'plume' ||
          !optConfig.mainStatKeys[art.slotKey]?.length ||
          optConfig.mainStatKeys[art.slotKey]?.includes(art.mainStatKey))
    ).length
  }, [artsDirty, database, optConfig.mainStatKeys])

  const { artSetKeys = [], slotKeys = [] } = filterOption

  const { levelTotal, setTotal, slotTotal } = useMemo(() => {
    const catKeys = {
      levelTotal: ['in'],
      setTotal: allArtifactSetKeys,
      slotTotal: allArtifactSlotKeys,
    } as const
    return bulkCatTotal(catKeys, (ctMap) =>
      database.arts.entries.forEach(([id, art]) => {
        const { level, setKey, slotKey } = art
        const { upOptLevelLow, upOptLevelHigh, upOptReshape } = optConfig
        const reshapeCandidate = upOptReshape && canReshape(art)
        if (
          reshapeCandidate ||
          (level >= upOptLevelLow && level <= upOptLevelHigh)
        ) {
          ctMap['levelTotal']['in'].total++
          if (filteredArtIdMap[id]) ctMap['levelTotal']['in'].current++
        }
        ctMap['setTotal'][setKey].total++
        ctMap['slotTotal'][slotKey].total++
        if (filteredArtIdMap[id]) {
          ctMap['setTotal'][setKey].current++
          ctMap['slotTotal'][slotKey].current++
        }
      })
    )
  }, [database, optConfig, filteredArtIdMap])

  const equippedArts = useLoadoutArtifacts(loadoutDatum)

  /** How many artifacts each of the upgrader's own filters keeps: says why a result is empty */
  const funnel = useMemo(() => {
    const { mainStatKeys, artSetExclusion } = optConfig
    const inRange = filteredArts
      .map((art) => database.arts.get(art.id))
      .filter(notEmpty)
    const fiveStar = inRange.filter((art) => art.rarity === 5)
    const setRules = fiveStar.filter(
      setRulesPredicate(equippedArts, artSetExclusion)
    )
    const mainStats = setRules.filter(
      (art) =>
        art.slotKey === 'flower' ||
        art.slotKey === 'plume' ||
        !mainStatKeys[art.slotKey]?.length ||
        mainStatKeys[art.slotKey]?.includes(art.mainStatKey)
    )
    return {
      inRange: inRange.length,
      fiveStar: fiveStar.length,
      setRules: setRules.length,
      mainStats: mainStats.length,
    }
  }, [optConfig, filteredArts, database, equippedArts])

  const upOptCalc = useMemo(() => {
    const {
      statFilters,
      optimizationTarget,
      mainStatKeys,
      upOptLevelLow,
      upOptLevelHigh,
      upOptReshape,
      upOptReshapeRolls,
      upOptDefine,
      upOptDefineSubstats,
      artSetExclusion,
    } = optConfig

    if (!optimizationTarget) return
    // FIXME: Use teamData here because teamData recalcs upon dependency update. Its kind of jank since there are some redundant calcs
    const teamDataLocal =
      teamData && getTeamData(database, teamId, teamCharId, 0, [])
    if (!teamDataLocal) return
    const workerData = uiDataForTeam(
      teamDataLocal.teamData,
      gender,
      activeCharKey
    )[characterKey]?.target.data[0]
    if (!workerData) return
    Object.assign(workerData, mergeData([workerData, dynamicData])) // Mark art fields as dynamic
    const optimizationTargetNode = objPathValue(
      workerData.display ?? {},
      optimizationTarget
    ) as NumNode | undefined
    if (!optimizationTargetNode) return

    const valueFilter: { value: NumNode; minimum: number }[] = Object.entries(
      statFilters
    ).flatMap(([pathStr, settings]) =>
      settings
        .filter((setting) => !setting.disabled)
        .map((setting) => {
          const filterNode: NumNode = objPathValue(
            workerData.display ?? {},
            JSON.parse(pathStr)
          )
          const infoResolved = filterNode?.info && resolveInfo(filterNode.info)
          const minimum =
            infoResolved?.unit === '%' ? setting.value / 100 : setting.value // TODO: Conversion
          return { value: filterNode, minimum }
        })
    )

    const respectSexExclusion = setRulesPredicate(equippedArts, artSetExclusion)
    const artifactsToConsider = filteredArts
      // retrieve the artifacts again, just incase there is an update that is not captured by UpgradeOptChartCard
      .map((art) => database.arts.get(art.id))
      .filter(notEmpty)
      .filter((art) => art.rarity === 5)
      .filter(respectSexExclusion)
      .filter(
        (art) =>
          art.slotKey === 'flower' ||
          art.slotKey === 'plume' ||
          !mainStatKeys[art.slotKey]?.length ||
          mainStatKeys[art.slotKey]?.includes(art.mainStatKey)
      )
      .filter(
        (art) =>
          (upOptReshape && canReshape(art)) ||
          (upOptLevelLow <= art.level && art.level <= upOptLevelHigh)
      )

    const defineConfig = {
      enabled: upOptDefine && upOptDefineSubstats.length >= 2,
      setSlotMainStatKeys: objKeyMap(allArtifactSlotKeys, (slotKey) => {
        const filterOptionSlotEnabled = filterOption.slotKeys?.length
          ? filterOption.slotKeys.includes(slotKey)
          : true
        if (!filterOptionSlotEnabled) return { setKeys: [], mainStats: [] }

        const mainStats =
          slotKey === 'flower' ||
          slotKey === 'plume' ||
          mainStatKeys[slotKey].length === 0
            ? artSlotMainKeys[slotKey]
            : mainStatKeys[slotKey]
        const filterOptionSetKeys = new Set(
          filterOption.artSetKeys?.length
            ? filterOption.artSetKeys
            : allArtifactSetKeys
        )
        const setKeys = allArtifactSetKeys
          .filter((setKey) => respectSexExclusion({ slotKey, setKey }))
          .filter((setKey) => filterOptionSetKeys.has(setKey))
        return {
          setKeys,
          mainStats,
        }
      }),
      substats: upOptDefineSubstats,
    }

    if (!artifactsToConsider.length && !defineConfig.enabled) return
    const nodes = optimize(
      [optimizationTargetNode, ...valueFilter.map((x) => x.value)],
      workerData,
      ({ path: [p] }) => p !== 'dyn'
    )

    const calc = new UpOptCalculatorV2(
      nodes,
      [Number.NEGATIVE_INFINITY, ...valueFilter.map((x) => x.minimum)],
      equippedArts,
      artifactsToConsider,
      { enabled: upOptReshape, minTotal: upOptReshapeRolls as 2 | 3 | 4 },
      defineConfig
    )
    // A build that misses a constraint can rarely be fixed by one upgrade: say which, rather
    // than "no results"
    calc.unmetConstraints = valueFilter.flatMap(({ value, minimum }, i) => {
      const current = calc.baseValues[i + 1]
      return current >= minimum ? [] : [{ info: value.info, minimum, current }]
    })
    calc.unfillableSlots = allArtifactSlotKeys.filter(
      (slotKey) =>
        !equippedArts[slotKey] &&
        !artifactsToConsider.some((art) => art.slotKey === slotKey)
    )
    return calc
    /**
     * WARNING:
     * Due to the violatile nature of the calculations above,
     * the dependency for this useMemo needs to be updated within the same render cycle as LoadoutDatum,
     * or crashes may occur when swapping charA upOpt -> charB upOpt
     */
  }, [
    optConfig,
    teamData,
    database,
    teamId,
    teamCharId,
    gender,
    activeCharKey,
    characterKey,
    filteredArts,
    filterOption,
    equippedArts,
  ])

  /**
   * Sets Define is actually generating candidates for, mapped to the slots they
   * apply to. Sets are dropped when excluded by set exclusion, or when they have
   * no effect on the optimization target. `arbitrary` marks the sets that were
   * only picked because no set mattered for their slot.
   */
  const { defineSets, defineFallbackSlots } = useMemo(() => {
    const setToSlots: Partial<Record<ArtifactSetKey, ArtifactSlotKey[]>> = {}
    allArtifactSlotKeys.forEach((slotKey) =>
      upOptCalc?.defineSetKeys[slotKey]?.forEach((setKey) => {
        const slots = setToSlots[setKey] ?? (setToSlots[setKey] = [])
        slots.push(slotKey)
      })
    )
    const defineFallbackSlots = upOptCalc?.defineFallbackSlots ?? []
    const arbitrarySets = new Set(
      defineFallbackSlots.flatMap(
        (slotKey) => upOptCalc?.defineSetKeys[slotKey] ?? []
      )
    )
    const defineSets = (
      Object.entries(setToSlots) as [ArtifactSetKey, ArtifactSlotKey[]][]
    )
      .sort(
        ([k1, slots1], [k2, slots2]) =>
          slots2.length - slots1.length || k1.localeCompare(k2)
      )
      .map(([setKey, slotKeys]) => ({
        setKey,
        slotKeys,
        arbitrary: arbitrarySets.has(setKey),
      }))
    return { defineSets, defineFallbackSlots }
  }, [upOptCalc])

  // Paging logic
  const [pageIdex, setpageIdex] = useState(0)

  useEffect(() => {
    // reset paging on new upOptCalc
    setpageIdex(0)
  }, [upOptCalc])

  const artifactsToDisplayPerPage = 5
  const { indexes, numPages, currentPageIndex, minObj0, maxObj0 } =
    useMemo(() => {
      if (!upOptCalc)
        return {
          indexes: [],
          numPages: 0,
          currentPageIndex: 0,
          minObj0: 0,
          maxObj0: 0,
        }

      const numPages = Math.ceil(
        upOptCalc.candidates.length / artifactsToDisplayPerPage
      )

      const currentPageIndex = clamp(pageIdex, 0, numPages - 1)
      const toShow = upOptCalc.candidates.slice(
        currentPageIndex * artifactsToDisplayPerPage,
        (currentPageIndex + 1) * artifactsToDisplayPerPage
      )
      const thr = upOptCalc.obj.threshold[0]

      return {
        indexes: range(
          currentPageIndex * artifactsToDisplayPerPage,
          Math.min(
            (currentPageIndex + 1) * artifactsToDisplayPerPage - 1,
            upOptCalc.candidates.length - 1
          )
        ),
        numPages,
        currentPageIndex,
        minObj0: toShow.reduce((a, b) => Math.min(b.result.lower, a), thr),
        maxObj0: toShow.reduce((a, b) => Math.max(b.result.upper, a), thr),
      }
    }, [pageIdex, upOptCalc])
  const setPage = useCallback(
    (_e: React.ChangeEvent<unknown>, value: number) => {
      if (!upOptCalc) return
      const end = value * artifactsToDisplayPerPage
      upOptCalc.calcSlowToIndex(end)
      setpageIdex(value - 1)
    },
    [upOptCalc]
  )

  const dataContext: dataContextObj | undefined = useMemo(() => {
    return data && teamData && { data, teamData }
  }, [data, teamData])

  const pagination = numPages > 1 && (
    <CardThemed bgt="light">
      <CardContent>
        <Grid container>
          <Grid item flexGrow={1}>
            <Pagination
              count={numPages}
              page={currentPageIndex + 1}
              onChange={setPage}
            />
          </Grid>
          <Grid item>
            <ShowingArt
              numShowing={indexes.length}
              total={upOptCalc?.candidates.length ?? 0}
            />
          </Grid>
        </Grid>
      </CardContent>
    </CardThemed>
  )

  const setTarget = useCallback(
    (optimizationTarget: string[]) =>
      database.optConfigs.set(optConfigId, { optimizationTarget }),
    [database, optConfigId]
  )
  const [moreOpen, setMoreOpen] = useState(false)
  /** Opens "More options" and brings the constraints into view */
  const showConstraints = useCallback(() => {
    setMoreOpen(true)
    // once the panel is rendered
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById('improve-constraints')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      )
    )
  }, [])
  /** How many of the options behind "More options" differ from their defaults */
  const moreCount = useMemo(() => {
    const { statFilters, mainStatKeys, artSetExclusion } = optConfig
    return [
      upOptReshape,
      upOptDefine,
      Object.values(statFilters).some((settings) =>
        settings.some((setting) => !setting.disabled)
      ),
      Object.values(mainStatKeys).some((keys) => keys.length > 0),
      Object.keys(artSetExclusion).length > 0,
    ].filter(Boolean).length
  }, [optConfig, upOptReshape, upOptDefine])

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {noArtifact && <NoArtWarning />}
      {dataContext && (
        <DataContext.Provider value={dataContext}>
          <Stack spacing={1}>
            {/* 1. What to improve */}
            <ImproveToolbar
              optimizationTarget={optimizationTarget}
              setTarget={setTarget}
            />
            {/* 2. Which substats help it most, and which artifacts to look at */}
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  lg: 'minmax(0, 5fr) minmax(0, 6fr)',
                },
                alignItems: 'start',
              }}
            >
              <SubstatValueCard />
              <UpgradeSearchCard
                levelTotal={levelTotal['in']}
                levelLow={upOptLevelLow}
                levelHigh={upOptLevelHigh}
                setLevel={(upOptLevelLow, upOptLevelHigh) =>
                  database.optConfigs.set(optConfigId, {
                    upOptLevelLow,
                    upOptLevelHigh,
                  })
                }
                slotKeys={slotKeys}
                slotTotal={slotTotal}
                setSlotKeys={(slotKeys) => filterOptionDispatch({ slotKeys })}
                artSetKeys={artSetKeys}
                setTotal={setTotal}
                setArtSetKeys={(artSetKeys) =>
                  filterOptionDispatch({ artSetKeys })
                }
                moreOpen={moreOpen}
                moreCount={moreCount}
                onToggleMore={() => setMoreOpen((open) => !open)}
                action={
                  <SettingsCardButton
                    startIcon={<AddIcon />}
                    onClick={() => setArtifactIdToEdit('new')}
                  >
                    {t('improve.addArtifact', 'Add')}
                  </SettingsCardButton>
                }
              />
            </Box>
            {/* Everything else, out of the way until asked for */}
            {moreOpen && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 0.5 }}
                >
                  {t(
                    'improve.sharedNote',
                    "These options are shared with the Optimize tab: changing them here changes them there too. Only the level range above is the Improve tab's own."
                  )}
                </Typography>
                <Box
                  sx={{
                    columns: { xs: 1, md: 2, xl: 3 },
                    columnGap: 1,
                    '& > *': { breakInside: 'avoid', mb: 1 },
                  }}
                >
                  <Box>
                    <SettingsCard title={t('settings.mainStats')}>
                      <MainStatSelectionCard
                        disabled={false}
                        filteredArtIdMap={filteredArtIdMap}
                      />
                    </SettingsCard>
                  </Box>
                  <Box>
                    <ArtifactSetConfig disabled={false} />
                  </Box>
                  <Box id="improve-constraints">
                    <StatFilterCard disabled={false} />
                  </Box>
                  <Box>
                    <CraftingCard
                      optConfigId={optConfigId}
                      upOptReshape={upOptReshape}
                      upOptReshapeRolls={upOptReshapeRolls}
                      reshapeCandidateCount={reshapeCandidateCount}
                      upOptDefine={upOptDefine}
                      upOptDefineSubstats={upOptDefineSubstats}
                      defineSets={defineSets}
                      defineFallbackSlots={defineFallbackSlots}
                    />
                  </Box>
                  <Box>
                    <OptCharacterCard characterKey={characterKey} />
                  </Box>
                  <Box>
                    <BonusStatsCard />
                  </Box>
                  <Box>
                    <MultiTargetCard />
                  </Box>
                </Box>
              </Box>
            )}
            {/* 3. The artifacts worth leveling */}
            {Object.values(equippedArts).some((a) => !a) && (
              <Alert severity="warning">
                <Trans t={t} i18nKey={'upOptEmptyBuild'}>
                  You're using a partially empty build. Since the Artifact
                  Upgrader only swaps artifacts individually, completing a set
                  is unlikely. It's recommended to begin with a base build,
                  preferably generated from the main Optimizer.
                </Trans>
              </Alert>
            )}
            {pagination}
            {noArtifact && <AddArtInfo />}
            <Suspense fallback={false}>
              <ArtifactEditor
                artifactIdToEdit={artifactIdToEdit}
                cancelEdit={() => setArtifactIdToEdit(undefined)}
                allowUpload
              />
            </Suspense>
            {!!optimizationTarget && !upOptCalc?.candidates.length && (
              <NoUpgradesAlert
                unmet={upOptCalc?.unmetConstraints ?? []}
                unfillable={upOptCalc?.unfillableSlots ?? []}
                funnel={funnel}
                onShowConstraints={showConstraints}
                onShowOptions={() => setMoreOpen(true)}
              />
            )}
            <Suspense
              fallback={
                <Skeleton
                  variant="rectangular"
                  sx={{ width: '100%', height: 600, minHeight: 5000 }}
                />
              }
            >
              {!!upOptCalc &&
                indexes.map(
                  (i) =>
                    upOptCalc.candidates[i] && (
                      <UpgradeOptChartCard
                        key={`${i}+${upOptCalc.candidates[i].id}`}
                        upOptCalc={upOptCalc}
                        ix={i}
                        setArtifactIdToEdit={setArtifactIdToEdit}
                        thresholds={upOptCalc.obj.threshold ?? []}
                        objMax={maxObj0}
                        objMin={minObj0}
                      />
                    )
                )}
            </Suspense>
            {pagination}
          </Stack>
        </DataContext.Provider>
      )}
    </Box>
  )
}

function ShowingArt({
  numShowing,
  total,
}: {
  numShowing: number
  total: number
}) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <Typography color="text.secondary">
      <Trans t={t} i18nKey="upOptShowingNum" count={numShowing} value={total}>
        Showing {{ count: numShowing }} out of {{ value: total }} Artifacts
      </Trans>
    </Typography>
  )
}
