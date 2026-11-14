import type { GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import type { KqmResult, KqmStep } from '@genshin-optimizer/gi/ui'
import {
  optimizeTeamKqm,
  TeamOptCancelled,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { kqmRotationReplay } from './RotationWriter'

export type KqmRunState =
  | { type: 'idle' }
  | { type: 'running'; startTime: number }
  | {
      type: 'done'
      result: KqmResult
      seconds: number
      /** The settings it was run with, as set (what "changed since" compares with) */
      teamOpt: TeamOpt
      /**
       * The settings its damage is for: the written rotation as KQM played it for these builds
       * (`played`: at the KQM constellations, with their weapons and sets, the last 2 of 4
       * rotations), or the attacks entered, nothing being written (`entered`)
       */
      runTeamOpt: TeamOpt
      rotation: 'played' | 'entered'
      /** What each rotation waited for to be ready (seconds), when played as KQM plays it */
      stalls?: { label: string; seconds: number }[]
      /** When it was found: which saved run it is (`database.teamKqmResults`) */
      savedAt?: number
    }
  | { type: 'error'; message: string }

/**
 * The last KQM result per team, so that it is still there after visiting another page (one object
 * per result: views cache their work by it). Also saved in the database, for after a reload.
 */
const lastRuns: Record<string, KqmRunState> = {}
type KqmDone = Extract<KqmRunState, { type: 'done' }>

const memberKeys = (database: ArtCharDatabase, teamId: string) =>
  teamOptMembers(database, teamId).map((m) => m.characterKey as string)

/**
 * The team's last result: of this visit, else the saved one (`database.teamKqmResults`) while the
 * team has the same members. One that no longer fits is forgotten.
 */
function lastRun(database: ArtCharDatabase, teamId: string): KqmRunState {
  if (!lastRuns[teamId]) {
    const saved = database.teamKqmResults.getRun(teamId)
    if (saved) {
      const members = memberKeys(database, teamId)
      const run = saved.run as unknown as Partial<KqmDone>
      if (
        run.type === 'done' &&
        run.result &&
        run.teamOpt &&
        saved.members.length === members.length &&
        saved.members.every((key) => members.includes(key))
      )
        lastRuns[teamId] = {
          ...(run as KqmDone),
          runTeamOpt: run.runTeamOpt ?? run.teamOpt,
          rotation: run.rotation ?? 'entered',
          savedAt: saved.savedAt,
        }
      else database.teamKqmResults.setRun(teamId, undefined)
    }
  }
  return lastRuns[teamId] ?? { type: 'idle' }
}

/*
 * A run's progress, per team, outside React state: a run reports many times a second, and only
 * the progress line reads it (at most every `PROGRESS_MS`), not the whole page
 */
const PROGRESS_MS = 120
const progress = new Map<string, KqmStep | undefined>()
const listeners = new Map<string, Set<() => void>>()
const pending = new Set<string>()
function setProgress(teamId: string, step: KqmStep | undefined) {
  progress.set(teamId, step)
  if (pending.has(teamId)) return
  pending.add(teamId)
  setTimeout(() => {
    pending.delete(teamId)
    for (const l of listeners.get(teamId) ?? []) l()
  }, PROGRESS_MS)
}
/** The team's KQM run progress (updated a few times a second) */
export function useKqmProgress(teamId: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listeners.get(teamId) ?? new Set()
      listeners.set(teamId, set)
      set.add(onChange)
      return () => {
        set.delete(onChange)
      }
    },
    [teamId]
  )
  return useSyncExternalStore(subscribe, () => progress.get(teamId))
}

/*
 * Runs in progress, per team, outside the page: one goes on when its tab, the page or the window
 * is left (only Cancel stops it), and the page shows it again when it comes back
 */
interface KqmJob {
  state: Extract<KqmRunState, { type: 'running' }>
  cancelled: boolean
}
const jobs = new Map<string, KqmJob>()
const runListeners = new Map<string, Set<() => void>>()
function notifyRun(teamId: string) {
  for (const l of runListeners.get(teamId) ?? []) l()
}
function subscribeRun(teamId: string, onChange: () => void) {
  const set = runListeners.get(teamId) ?? new Set()
  runListeners.set(teamId, set)
  set.add(onChange)
  return () => {
    set.delete(onChange)
  }
}
/** The team's run in progress, else its last result */
const runState = (database: ArtCharDatabase, teamId: string): KqmRunState =>
  jobs.get(teamId)?.state ?? lastRun(database, teamId)

/** Keeps a finished run's state: the last result (saved once the page shows it), or its error */
function keep(database: ArtCharDatabase, teamId: string, s: KqmRunState) {
  // (a new result: when it was found says which saved one it is)
  const next: KqmRunState =
    s.type === 'done' && s.savedAt === undefined
      ? { ...s, savedAt: Date.now() }
      : s
  lastRuns[teamId] = next
  // a new result replaces the saved one (an error keeps it), after the page shows it: saving
  // copies the whole result
  if (
    next.type === 'done' &&
    database.teamKqmResults.get().runs[teamId]?.savedAt !== next.savedAt
  )
    setTimeout(() => {
      // (discarded or replaced meanwhile: not saved)
      if (lastRuns[teamId] !== next) return
      const { savedAt, ...run } = next
      database.teamKqmResults.setRun(teamId, {
        savedAt: savedAt!,
        members: memberKeys(database, teamId),
        run: run as never,
      })
    }, 0)
}

/** Runs KQM theorycrafting for a team, in the background of whichever page is shown */
async function startKqmRun(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamId: string,
  teamOpt: TeamOpt
) {
  // (a run already going for the team is replaced)
  const previous = jobs.get(teamId)
  if (previous) previous.cancelled = true
  const job: KqmJob = {
    state: { type: 'running', startTime: performance.now() },
    cancelled: false,
  }
  jobs.set(teamId, job)
  setProgress(teamId, undefined)
  notifyRun(teamId)
  const end = (s?: KqmRunState) => {
    if (jobs.get(teamId) !== job) return
    if (s) keep(database, teamId, s)
    jobs.delete(teamId)
    notifyRun(teamId)
  }
  // (the running state paints before the first problem is built; a hidden page goes on at once)
  await nextPaint()
  try {
    // the written rotation, played by KQM theorycrafting itself (never with the members' own
    // constellations or gear): at the KQM constellations, with the builds' weapons and sets
    let replay: ReturnType<typeof kqmRotationReplay>
    try {
      const members = teamOptMembers(database, teamId)
      replay = kqmRotationReplay({
        database,
        teamId,
        members,
        gender,
        names: members.map(({ characterKey }) => ({
          characterKey,
          name: i18n.t(
            `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
          ),
        })),
        teamOpt,
      })
    } catch (e) {
      console.error(e)
    }
    const result = await optimizeTeamKqm({
      database,
      teamId,
      gender,
      teamOpt,
      replay,
      isCancelled: () => job.cancelled,
      onStep: (step) => setProgress(teamId, step),
    })
    if (job.cancelled) return end()
    if (!result)
      return end({
        type: 'error',
        message: 'Every member is kept: nothing to optimize.',
      })
    const { played } = result
    end({
      type: 'done',
      result,
      seconds: (performance.now() - job.state.startTime) / 1000,
      teamOpt,
      runTeamOpt: played
        ? {
            ...teamOpt,
            attacks: played.attacks,
            rotationTime: played.rotationTime ?? teamOpt.rotationTime,
          }
        : teamOpt,
      rotation: played ? 'played' : 'entered',
      stalls: played?.stalls,
    })
  } catch (e) {
    if (e instanceof TeamOptCancelled) return end()
    console.error(e)
    end({ type: 'error', message: String((e as Error)?.message ?? e) })
  }
}

/** Whether a KQM run of the team is in progress (also while another page is shown) */
export function useKqmRunning(teamId: string) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeRun(teamId, onChange),
    [teamId]
  )
  return useSyncExternalStore(subscribe, () => jobs.has(teamId))
}

/** A KQM mode run of the team (`optimizeTeamKqm`): its state, start, cancel and discard */
export function useKqmRun(teamId: string) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { i18n } = useTranslation('charNames_gen')
  const [state, setState] = useState<KqmRunState>(() =>
    runState(database, teamId)
  )
  useEffect(() => {
    setState(runState(database, teamId))
    return subscribeRun(teamId, () => {
      const next = runState(database, teamId)
      // (the results are a big render: interruptible, so the page does not freeze)
      if (next.type === 'done') startTransition(() => setState(next))
      else setState(next)
    })
  }, [database, teamId])

  const run = useCallback(
    (teamOpt: TeamOpt) => startKqmRun(database, gender, i18n, teamId, teamOpt),
    [database, gender, i18n, teamId]
  )
  const cancel = useCallback(() => {
    const job = jobs.get(teamId)
    if (job) job.cancelled = true
  }, [teamId])
  const clear = useCallback(() => {
    delete lastRuns[teamId]
    database.teamKqmResults.setRun(teamId, undefined)
    notifyRun(teamId)
  }, [database, teamId])
  const previous = lastRuns[teamId]
  const lastResult = previous?.type === 'done' ? previous : undefined
  return { state, run, cancel, clear, lastResult }
}
