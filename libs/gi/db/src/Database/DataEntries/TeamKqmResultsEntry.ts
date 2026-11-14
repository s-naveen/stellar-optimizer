import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'
import { validateTeamOpt } from '../DataManagers/TeamOpt'

/**
 * A team's last KQM theorycrafting run, kept across reloads. The run's shape belongs to KQM mode
 * (its result, gi/ui `KqmResult`, and what it ran with): it is only checked here to have a result
 * with builds, and settings that are still valid.
 */
export interface TeamKqmSavedRun {
  /** When it was found (ms since 1970) */
  savedAt: number
  /** The team's members when it ran: it is only shown again for the same members */
  members: string[]
  /** KQM mode's finished run, as that page keeps it */
  run: {
    result: { builds: Record<string, unknown> } & Record<string, unknown>
  } & Record<string, unknown>
}

/** Per team (id), its last run. (One field, replaced whole: `set` merges top-level keys.) */
export interface ITeamKqmResultsEntry {
  runs: Record<string, TeamKqmSavedRun>
}

/**
 * Runs kept: the most recent ones. Each holds every member's rankings (~100 KB), and the browser's
 * storage for the whole database is ~5 MB.
 */
export const TEAM_KQM_RUNS_KEPT = 6

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

export class TeamKqmResultsEntry extends DataEntry<
  'teamKqmResults',
  'teamKqmResults',
  ITeamKqmResultsEntry,
  ITeamKqmResultsEntry
> {
  constructor(database: ArtCharDatabase) {
    super(database, 'teamKqmResults', () => ({ runs: {} }), 'teamKqmResults')
  }
  override validate(obj: unknown): ITeamKqmResultsEntry | undefined {
    if (!isObject(obj)) return undefined
    const runs: ITeamKqmResultsEntry['runs'] = {}
    for (const [teamId, saved] of Object.entries(
      isObject(obj['runs']) ? obj['runs'] : {}
    )) {
      if (!isObject(saved)) continue
      const { savedAt, members, run } = saved
      if (!isObject(run) || !isObject(run['result'])) continue
      if (!isObject(run['result']['builds'])) continue
      if (!Array.isArray(members) || members.some((m) => typeof m !== 'string'))
        continue
      // settings saved by an older version that no longer validate: the run is dropped
      const settings: Record<string, unknown> = {}
      let valid = true
      for (const key of ['teamOpt', 'runTeamOpt'] as const) {
        if (run[key] === undefined) continue
        const value = validateTeamOpt(run[key])
        if (value) settings[key] = value
        else valid = false
      }
      if (!valid) continue
      runs[teamId] = {
        savedAt: typeof savedAt === 'number' ? savedAt : 0,
        members: members as string[],
        run: { ...run, ...settings } as TeamKqmSavedRun['run'],
      }
    }
    return { runs }
  }
  /** A team's saved run (a copy: the database keeps its own frozen) */
  getRun(teamId: string): TeamKqmSavedRun | undefined {
    const saved = this.get().runs[teamId]
    return saved && structuredClone(saved)
  }
  /**
   * Saves (or with `undefined`, forgets) a team's last run. Only the most recent runs are kept;
   * when the browser's storage is full, older runs make room, else this one is not saved.
   */
  setRun(teamId: string, run: TeamKqmSavedRun | undefined): void {
    const others = Object.entries(this.get().runs)
      .filter(([id]) => id !== teamId)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    if (!run) {
      if (others.length < Object.keys(this.get().runs).length)
        this.write(Object.fromEntries(others))
      return
    }
    const own = structuredClone(run)
    let kept = others.slice(0, TEAM_KQM_RUNS_KEPT - 1)
    for (;;) {
      if (this.write({ ...Object.fromEntries(kept), [teamId]: own })) return
      if (!kept.length) break
      kept = kept.slice(0, -1)
    }
    this.write(Object.fromEntries(others.slice(0, TEAM_KQM_RUNS_KEPT)))
  }
  /** Writes the runs; false when the browser's storage is full */
  private write(runs: ITeamKqmResultsEntry['runs']) {
    try {
      this.set({ runs })
      return true
    } catch (e) {
      // (QuotaExceededError: the storage keeps what it had)
      if (e instanceof DOMException) return false
      throw e
    }
  }
  // Runs are this browser's work for its teams (team ids that a GOOD import changes): never part
  // of a GOOD export or import
  override exportGOOD() {}
  override importGOOD() {}
}
