import { CardThemed } from '@genshin-optimizer/common/ui'
import { isDev, objMap, toPercent } from '@genshin-optimizer/common/util'
import type { BuildTc } from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import type { TCWorkerResult } from '@genshin-optimizer/gi/solver-tc'
import {
  getMinSubAndOtherRolls,
  TCWorker,
} from '@genshin-optimizer/gi/solver-tc'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { dataContextObj } from '@genshin-optimizer/gi/ui'
import {
  DataContext,
  getBuildTcArtifactData,
  getBuildTcWeaponData,
  getTeamDataCalc,
  initialBuildStatus,
  optimizeNodesForScaling,
  StatDisplayComponent,
} from '@genshin-optimizer/gi/ui'
import { getSubstatValue } from '@genshin-optimizer/gi/util'
import { Box, Button, CardContent, Grid, Skeleton, Stack } from '@mui/material'
import { useCallback, useContext, useMemo, useRef, useState } from 'react'
import { BuildTcContext } from '../../../BuildTcContext'
import CharacterProfileCard from '../../../CharProfileCard'
import useCompareData from '../../../useCompareData'
import BonusStatsModal from '../../BonusStatsModal'
import { CustomMultiTargetModal } from '../../CustomMultiTarget/CustomMultiTargetModal'
import OptimizationTargetSelector from '../TabOptimize/Components/OptimizationTargetSelector'
import StatFilterCard from '../TabOptimize/Components/StatFilterCard'
import { SubstatValueCard } from '../TabUpgradeOpt/SubstatValueCard'
import { ArtifactMainStatAndSetEditor } from './ArtifactMainStatAndSetEditor'
import { ArtifactSubCard } from './ArtifactSubCard'
import { DistributeCard } from './DistributeCard'
import { TcHeader } from './TcHeader'
import { tcRollCapacity, tcRollsUsed } from './tcRolls'
import { WeaponEditorCard } from './WeaponEditorCard'
export default function TabTheorycraft() {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const {
    teamId,
    teamCharId,
    teamChar: { key: characterKey, optConfigId },
  } = useContext(TeamCharacterContext)
  const { buildTc, setBuildTc } = useContext(BuildTcContext)
  const optConfig = useOptConfig(optConfigId)!
  const { optimizationTarget, statFilters } = optConfig

  const weaponTypeKey = getCharStat(characterKey).weaponType

  const dataContextValue = useContext(DataContext)
  const compareData = useCompareData()
  const dataContextValueWithCompare: dataContextObj | undefined =
    useMemo(() => {
      if (!dataContextValue) return undefined
      return {
        ...dataContextValue,
        compareData,
      }
    }, [dataContextValue, compareData])

  const setOptimizationTarget = useCallback(
    (optimizationTarget: string[]) => {
      database.optConfigs.set(optConfigId, { optimizationTarget })
    },
    [database, optConfigId]
  )

  const distributedSubstats = buildTc.optimization.distributedSubstats
  const setDistributedSubstats = useCallback(
    (distributedSubstats: BuildTc['optimization']['distributedSubstats']) => {
      setBuildTc((data_) => {
        data_.optimization.distributedSubstats = distributedSubstats
      })
    },
    [setBuildTc]
  )
  const workerRef = useRef<Worker | null>(null)
  if (workerRef.current === null) workerRef.current = TCWorker()

  const [status, setStatus] = useState(initialBuildStatus())
  const solving = status.type === 'active'

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus(initialBuildStatus())
  }, [workerRef])

  const { minSubLines, minOtherRolls } = useMemo(
    () => getMinSubAndOtherRolls(buildTc),
    [buildTc]
  )
  const maxTotalRolls = useMemo(() => tcRollCapacity(buildTc), [buildTc])
  const usedRolls = useMemo(() => tcRollsUsed(buildTc), [buildTc])

  const optimizeSubstats = (apply: boolean) => {
    if (!workerRef.current) return
    /**
     * Recalculating teamdata and nodes because the ones in the UI are using deferred,
     * and can cause issue when people click buttons too fast or loiter in inputs
     */
    const tempTeamData = getTeamDataCalc(
      database,
      teamId,
      gender,
      teamCharId,
      0,
      getBuildTcArtifactData(buildTc),
      getBuildTcWeaponData(buildTc)
    )
    if (!tempTeamData) return
    const { nodes, valueFilter } = optimizeNodesForScaling(
      tempTeamData,
      characterKey,
      optimizationTarget,
      statFilters
    )
    if (!nodes || !valueFilter) return
    workerRef.current.postMessage({ buildTc, nodes, valueFilter })
    setStatus((s) => ({
      ...s,
      type: 'active',
      startTime: performance.now(),
      finishTime: undefined,
    }))

    workerRef.current.onmessage = ({ data }: MessageEvent<TCWorkerResult>) => {
      const { resultType } = data
      switch (resultType) {
        case 'total':
          setStatus((s) => ({ ...s, total: data.total }))
          break
        case 'count':
          setStatus((s) => ({
            ...s,
            tested: data.tested,
            failed: data.failed,
          }))
          break
        case 'finalize': {
          const { maxBuffer, distributed, tested, failed, skipped } = data
          setStatus((s) => ({
            ...s,
            type: 'inactive',
            tested,
            failed,
            skipped,
            finishTime: performance.now(),
          }))

          if (!apply) {
            console.log({
              maxBuffer,
              distributed,
              tested,
              failed,
              skipped,
            })
            break
          }

          setBuildTc((buildTc) => {
            buildTc.artifact.substats.stats = objMap(
              buildTc.artifact.substats.stats,
              (v, k) => v + toPercent(maxBuffer![k] ?? 0, k)
            )
            buildTc.optimization.distributedSubstats =
              distributedSubstats - distributed
            return buildTc
          })

          break
        }
      }
    }
  }

  const kqms = useCallback(() => {
    setBuildTc((buildTc) => {
      buildTc.artifact.substats.type = 'mid'

      const {
        artifact: {
          slots,
          substats: { stats, type, rarity },
        },
      } = buildTc
      buildTc.optimization.distributedSubstats =
        20 - (rarity === 5 ? 0 : rarity === 4 ? 10 : 15)
      buildTc.artifact.substats.stats = objMap(stats, (_val, statKey) => {
        const substatValue = getSubstatValue(statKey, rarity, type)
        return substatValue * 2
      })
      buildTc.optimization.maxSubstats = objMap(
        buildTc.optimization.maxSubstats,
        (_val, statKey) => {
          const rollsPerSlot = 2
          const diffSlot = 5
          const sameSlot = Object.entries(slots).filter(
            ([_slotKey, { statKey: mainStatKey }]) => mainStatKey === statKey
          ).length
          // +2 for the inital fixed rolls
          return 2 + (diffSlot - sameSlot) * rollsPerSlot
        }
      )
    })
  }, [setBuildTc])

  return (
    <Stack spacing={1}>
      <TcHeader kqms={kqms} solving={solving} />
      <Box>
        <Grid container spacing={1} sx={{ justifyContent: 'center' }}>
          <Grid item xs={8} sm={8} md={3} lg={2.3}>
            <CharacterProfileCard />
          </Grid>
          <Grid
            item
            xs={12}
            sm={12}
            md={9}
            lg={9.7}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <CardThemed bgt="light" sx={{ flexGrow: 1, p: 1 }}>
              {dataContextValueWithCompare ? (
                <DataContext.Provider value={dataContextValueWithCompare}>
                  <StatDisplayComponent
                    columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
                    BonusStatEditor={BonusStatsModal}
                    CustomMTargetEditor={CustomMultiTargetModal}
                  />
                </DataContext.Provider>
              ) : (
                <Skeleton variant="rectangular" width="100%" height={500} />
              )}
            </CardThemed>
          </Grid>
        </Grid>
      </Box>
      {dataContextValue ? (
        <DataContext.Provider value={dataContextValue}>
          <Box>
            <Grid container spacing={1} sx={{ justifyContent: 'center' }}>
              <Grid
                item
                xs={12}
                md={6}
                xl={3}
                sx={{ flexGrow: -1, maxWidth: '400px' }}
              >
                <WeaponEditorCard
                  weaponTypeKey={weaponTypeKey}
                  disabled={solving}
                />
                <StatFilterCard disabled={solving} />
              </Grid>
              <Grid item xs={12} md={6} xl={4} sx={{ flexGrow: -2 }}>
                <ArtifactMainStatAndSetEditor disabled={solving} />
              </Grid>
              <Grid item xs={12} xl={5} sx={{ flexGrow: 1 }}>
                <ArtifactSubCard
                  disabled={solving}
                  maxTotalRolls={maxTotalRolls}
                />
              </Grid>
            </Grid>
          </Box>
          {/* What the build is for, then what to change */}
          <CardThemed bgt="light">
            <CardContent
              sx={{ display: 'flex', py: 1, '&:last-child': { pb: 1 } }}
            >
              <OptimizationTargetSelector
                disabled={solving}
                optimizationTarget={optimizationTarget}
                setTarget={setOptimizationTarget}
                // the first step: the main action until a target is picked
                buttonProps={{
                  sx: { flexGrow: 1, ...(optimizationTarget ? {} : giCtaSx) },
                }}
                targetSelectorModalProps={{
                  excludeSections: ['character', 'bonusStats', 'teamBuff'],
                }}
              />
            </CardContent>
          </CardThemed>
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                lg: 'minmax(0, 1fr) minmax(0, 1fr)',
              },
              alignItems: 'start',
            }}
          >
            <SubstatValueCard
              rarity={buildTc.artifact.substats.rarity}
              rollSize={buildTc.artifact.substats.type}
              pieces={buildTc.artifact.slots}
            />
            <DistributeCard
              distributedSubstats={distributedSubstats}
              setDistributedSubstats={setDistributedSubstats}
              maxTotalRolls={maxTotalRolls}
              usedRolls={usedRolls}
              hasTarget={!!optimizationTarget}
              solving={solving}
              onDistribute={() => optimizeSubstats(true)}
              onCancel={terminateWorker}
              minSubLines={minSubLines}
              minOtherRolls={minOtherRolls}
              status={status}
              characterKey={characterKey}
              gender={gender}
            />
          </Box>
          {isDev && (
            <Button
              onClick={() => optimizeSubstats(false)}
              disabled={!optimizationTarget || solving}
            >
              Log Optimized Substats
            </Button>
          )}
        </DataContext.Provider>
      ) : (
        <Skeleton variant="rectangular" width="100%" height={500} />
      )}
    </Stack>
  )
}
