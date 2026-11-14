import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'
import { initTeamOpt } from '../DataManagers/TeamOpt'
import type { TeamKqmSavedRun } from './TeamKqmResultsEntry'
import { TEAM_KQM_RUNS_KEPT } from './TeamKqmResultsEntry'

const saved = (savedAt = 1_700_000_000_000): TeamKqmSavedRun => ({
  savedAt,
  members: ['Columbina', 'Sucrose', 'Ineffa', 'Flins'],
  run: {
    type: 'done',
    seconds: 41.2,
    teamOpt: { ...initTeamOpt(), rotationTime: 21 },
    rotation: 'played',
    result: {
      builds: { Flins: { weapon: { key: 'BloodsoakedRuins' } } },
      rankings: { Flins: { weapons: [], sets: [] } },
      after: { total: 2 },
    },
  },
})

describe('database.teamKqmResults (last KQM theorycrafting runs)', () => {
  it('keeps a team’s run across a reload of the database', () => {
    const storage = new SandboxStorage()
    new ArtCharDatabase(1, storage).teamKqmResults.setRun('team_1', saved())
    const run = new ArtCharDatabase(1, storage).teamKqmResults.getRun('team_1')
    expect(run).toEqual(JSON.parse(JSON.stringify(saved())))
    // a copy the page may change: the database keeps its own
    expect(Object.isFrozen(run?.run.result)).toBe(false)
  })

  it('forgets a team’s run, and only that one', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamKqmResults.setRun('team_1', saved())
    database.teamKqmResults.setRun('team_2', saved())
    database.teamKqmResults.setRun('team_1', undefined)
    expect(Object.keys(database.teamKqmResults.get().runs)).toEqual(['team_2'])
  })

  it('keeps only the most recent teams’ runs', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    for (let i = 1; i <= TEAM_KQM_RUNS_KEPT + 2; i++)
      database.teamKqmResults.setRun(`team_${i}`, saved(i))
    const kept = Object.keys(database.teamKqmResults.get().runs).sort()
    expect(kept).toHaveLength(TEAM_KQM_RUNS_KEPT)
    expect(kept).not.toContain('team_1')
    expect(kept).not.toContain('team_2')
    expect(kept).toContain(`team_${TEAM_KQM_RUNS_KEPT + 2}`)
  })

  it('makes room when the browser’s storage is full, and never throws', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved(1))
    database.teamKqmResults.setRun('team_2', saved(2))
    // a storage that only takes small values (as a full localStorage would)
    const set = storage.set.bind(storage)
    storage.set = (key: string, value: unknown) => {
      if (JSON.stringify(value).length > 1200)
        throw new DOMException('full', 'QuotaExceededError')
      set(key, value)
    }
    expect(() =>
      database.teamKqmResults.setRun('team_3', saved(3))
    ).not.toThrow()
    const runs = Object.keys(
      new ArtCharDatabase(1, storage).teamKqmResults.get().runs
    )
    expect(runs).toContain('team_3')
    expect(runs.length).toBeLessThan(3)
  })

  it('drops runs whose settings no longer validate', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved())
    const raw = storage.get('teamKqmResults') as {
      runs: Record<string, { run: Record<string, unknown> }>
    }
    raw.runs['team_1'].run['teamOpt'] = 'not settings'
    storage.set('teamKqmResults', raw)
    expect(new ArtCharDatabase(1, storage).teamKqmResults.get().runs).toEqual(
      {}
    )
  })

  it('is never part of a GOOD export or import', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamKqmResults.setRun('team_1', saved())
    const good = database.exportGOOD() as Record<string, unknown>
    expect(good['teamKqmResults']).toBeUndefined()
  })
})
