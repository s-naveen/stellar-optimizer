import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { OptProblemInput } from '@genshin-optimizer/gi/solver'
import {
  GOSolver,
  mergeBuilds,
  nextPaint,
  prewarmSolver,
} from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import type {
  TeamOptResult,
  TeamOptSolver,
  TeamOptStep,
} from '@genshin-optimizer/gi/ui'
import {
  optimizeTeam,
  TeamOptCancelled,
  TeamOptSetRulesUnmet,
  teamOptMembers,
  useNumWorkers,
} from '@genshin-optimizer/gi/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

export type TeamOptRunState =
  | { type: 'idle' }
  | { type: 'running'; step?: TeamOptStep; startTime: number }
  | {
      type: 'done'
      result: TeamOptResult
      seconds: number
      /** The settings it was found with (the rotation its damage is for) */
      teamOpt: TeamOpt
    }
  | {
      type: 'error'
      message: string
      /** The members no team build keeps to the allowed sets of (the run gave no result) */
      setRulesUnmet?: CharacterKey[]
    }

/** The live counters of the solver of the current step */
export type TeamOptStatus = {
  /**
   * The step being run. Kept here, read by the progress line on its own timer, not in the run's
   * state: a state change per step re-rendered the whole page about 30 times a run.
   */
  step?: TeamOptStep
  tested: number
  failed: number
  skipped: number
  total: number
  testedPerSecond: number
  skippedPerSecond: number
}
const initStatus = (): TeamOptStatus => ({
  tested: 0,
  failed: 0,
  skipped: 0,
  total: Number.NaN,
  testedPerSecond: 0,
  skippedPerSecond: 0,
})

/**
 * The last result per team, so that it is still there after visiting another page (one object
 * per result: views cache their work by it). Also saved in the database, for after a reload.
 */
const lastRuns: Record<string, TeamOptRunState> = {}

/**
 * A team's saved last result (see `database.teamOptResults`), when it still fits the team: the
 * same members, and every artifact and weapon still there. One that no longer fits is forgotten.
 */
function savedRun(
  database: ArtCharDatabase,
  teamId: string
): TeamOptRunState | undefined {
  const saved = database.teamOptResults.get().runs[teamId]
  if (!saved) return undefined
  const { builds, weapons } = saved.result
  const members = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const keys = Object.keys(builds)
  const fits =
    keys.length === members.length &&
    keys.every((key) => members.includes(key as never)) &&
    Object.values(builds).every((build) =>
      Object.values(build).every((id) => !id || database.arts.get(id))
    ) &&
    Object.values(weapons).every((id) => !id || database.weapons.get(id))
  if (!fits) {
    database.teamOptResults.setRun(teamId, undefined)
    return undefined
  }
  // (the database keeps its copy frozen)
  const { result, seconds, teamOpt } = structuredClone(saved)
  return {
    type: 'done',
    result: result as unknown as TeamOptResult,
    seconds,
    teamOpt,
  }
}

/** The team's last result: of this visit, else the saved one */
function lastRun(database: ArtCharDatabase, teamId: string): TeamOptRunState {
  if (!lastRuns[teamId]) {
    const saved = savedRun(database, teamId)
    if (saved) lastRuns[teamId] = saved
  }
  return lastRuns[teamId] ?? { type: 'idle' }
}

/** Runs Team Optimize for a team: one solver run per member and round (see `optimizeTeam`) */
export function useTeamOptRun(teamId: string) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [maxWorkers] = useNumWorkers()
  const [state, setStateRaw] = useState<TeamOptRunState>(() =>
    lastRun(database, teamId)
  )
  const setState = useCallback(
    (next: TeamOptRunState) => {
      // a run in progress is not worth keeping: leaving the page cancels it
      if (next.type !== 'running') lastRuns[teamId] = next
      // a new result replaces the saved one (an error keeps it)
      if (next.type === 'done')
        database.teamOptResults.setRun(teamId, {
          savedAt: Date.now(),
          seconds: next.seconds,
          teamOpt: next.teamOpt,
          result: structuredClone(next.result) as never,
        })
      setStateRaw(next)
    },
    [database, teamId]
  )
  useEffect(() => setStateRaw(lastRun(database, teamId)), [database, teamId])
  const status = useRef<TeamOptStatus>(initStatus())
  const cancelRef = useRef<() => void>(() => {})
  useEffect(() => () => cancelRef.current(), [])
  // load a solver worker while the user sets things up
  useEffect(() => prewarmSolver(), [])

  const run = useCallback(async () => {
    let cancelled = false
    let stopSolver: (() => void) | undefined
    cancelRef.current = () => {
      cancelled = true
      stopSolver?.()
    }
    const startTime = performance.now()
    let lastPaint = startTime
    status.current.step = undefined
    setState({ type: 'running', startTime })
    try {
      await nextPaint()
      const teamOpt = database.teams.get(teamId)?.teamOpt ?? initTeamOpt()
      const solve: TeamOptSolver = async ({
        arts,
        objective,
        constraints,
        exclusion,
        mainStatAssumptionLevel,
        topN = 1,
        onWork,
      }) => {
        const problem: OptProblemInput = {
          arts: compactArtifacts(arts, mainStatAssumptionLevel, false),
          optimizationTarget: objective,
          constraints,
          exclusion,
          topN,
        }
        Object.assign(status.current, initStatus())
        // (Team Optimize always uses the GPU when the browser can: each step has a build to beat, which
        // the GPU's sweep prunes with; the Optimize tab's GPU setting is for single searches)
        const solver = new GOSolver(problem, status.current, maxWorkers, {
          gpu: true,
        })
        stopSolver = () => solver.cancel(new TeamOptCancelled())
        const t0 = performance.now()
        try {
          const results = await solver.solve()
          onWork?.({
            tested: status.current.tested,
            total: Number.isFinite(status.current.total)
              ? status.current.total
              : 0,
          })
          const [best, ...next] = mergeBuilds(
            results.map((r) => r.builds),
            topN
          )
          if (process.env['NODE_ENV'] === 'development')
            console.log('[TeamOpt] solve', {
              arts: arts.length,
              total: status.current.total,
              tested: status.current.tested,
              skipped: status.current.skipped,
              ms: Math.round(performance.now() - t0),
              found: !!best,
            })
          return (
            best && {
              value: best.value,
              artifactIds: best.artifactIds,
              ...(next.length
                ? {
                    more: next.map(({ value, artifactIds }) => ({
                      value,
                      artifactIds,
                    })),
                  }
                : {}),
            }
          )
        } finally {
          stopSolver = undefined
          solver.cancel()
        }
      }
      const result = await optimizeTeam({
        database,
        teamId,
        gender,
        teamOpt,
        solve,
        builds: teamOpt.topN ?? 1,
        isCancelled: () => cancelled,
        onStep: async (step) => {
          status.current.step = step
          // let the page show the step, at most every 100 ms: a step the memo answers takes no
          // time, and a paint after each (up to 50 ms) added up to seconds per run
          if (performance.now() - lastPaint < 100) return
          await nextPaint()
          lastPaint = performance.now()
        },
      })
      if (cancelled) throw new TeamOptCancelled()
      setState(
        result
          ? {
              type: 'done',
              result,
              seconds: (performance.now() - startTime) / 1000,
              teamOpt,
            }
          : { type: 'error', message: 'The team could not be computed.' }
      )
    } catch (e) {
      if (cancelled || e instanceof TeamOptCancelled)
        setState(lastRun(database, teamId))
      else if (e instanceof TeamOptSetRulesUnmet)
        setState({
          type: 'error',
          message: e.message,
          setRulesUnmet: e.characterKeys,
        })
      else setState({ type: 'error', message: (e as Error)?.message ?? `${e}` })
    } finally {
      cancelRef.current = () => {}
    }
  }, [database, teamId, gender, maxWorkers, setState])

  const cancel = useCallback(() => cancelRef.current(), [])
  const clear = useCallback(() => {
    database.teamOptResults.setRun(teamId, undefined)
    setState({ type: 'idle' })
  }, [database, teamId, setState])
  return { state, status: status.current, run, cancel, clear }
}
