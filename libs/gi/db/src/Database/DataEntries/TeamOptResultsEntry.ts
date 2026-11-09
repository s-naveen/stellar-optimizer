import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'
import type { TeamOpt } from '../DataManagers/TeamOpt'
import { validateTeamOpt } from '../DataManagers/TeamOpt'

/**
 * A team's last Team Optimize result, kept across reloads. The result's shape belongs to the
 * optimizer (gi/ui `TeamOptResult`): it is only checked here to have builds and weapons, and the
 * optimizer drops it when its artifacts, weapons or members no longer match.
 */
export interface TeamOptSavedRun {
  /** When it was found (ms since 1970) */
  savedAt: number
  /** How long the run took (seconds) */
  seconds: number
  /** The settings it was found with: its rotation (the result's attack indices follow it) */
  teamOpt: TeamOpt
  result: {
    builds: Record<string, Record<string, string | undefined>>
    weapons: Record<string, string>
  } & Record<string, unknown>
}

/** Per team (id), its last result. (One field, replaced whole: `set` merges top-level keys.) */
export interface ITeamOptResultsEntry {
  runs: Record<string, TeamOptSavedRun>
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

export class TeamOptResultsEntry extends DataEntry<
  'teamOptResults',
  'teamOptResults',
  ITeamOptResultsEntry,
  ITeamOptResultsEntry
> {
  constructor(database: ArtCharDatabase) {
    super(database, 'teamOptResults', () => ({ runs: {} }), 'teamOptResults')
  }
  override validate(obj: unknown): ITeamOptResultsEntry | undefined {
    if (!isObject(obj)) return undefined
    const runs: ITeamOptResultsEntry['runs'] = {}
    for (const [teamId, run] of Object.entries(
      isObject(obj['runs']) ? obj['runs'] : {}
    )) {
      if (!isObject(run)) continue
      const { savedAt, seconds, teamOpt, result } = run
      const settings = validateTeamOpt(teamOpt)
      if (!settings || !isObject(result)) continue
      if (!isObject(result['builds']) || !isObject(result['weapons'])) continue
      runs[teamId] = {
        savedAt: typeof savedAt === 'number' ? savedAt : 0,
        seconds: typeof seconds === 'number' ? seconds : 0,
        teamOpt: settings,
        result: result as TeamOptSavedRun['result'],
      }
    }
    return { runs }
  }
  /** Saves (or with `undefined`, forgets) a team's last result */
  setRun(teamId: string, run: TeamOptSavedRun | undefined) {
    const runs = { ...this.get().runs }
    if (run) runs[teamId] = run
    else if (teamId in runs) delete runs[teamId]
    else return
    this.set({ runs })
  }
  // Results point at this database's own artifacts and weapons (ids that a GOOD import changes):
  // never part of a GOOD export or import
  override exportGOOD() {}
  override importGOOD() {}
}
