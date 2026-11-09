import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'
import { initTeamOpt } from '../DataManagers/TeamOpt'
import type { TeamOptSavedRun } from './TeamOptResultsEntry'

const run = (): TeamOptSavedRun => ({
  savedAt: 1_700_000_000_000,
  seconds: 4.2,
  teamOpt: { ...initTeamOpt(), rotationTime: 21, topN: 3 },
  result: {
    builds: { Mitya: { flower: 'artifact_1', plume: undefined } },
    weapons: { Mitya: 'weapon_1' },
    before: { total: 1 },
    after: { total: 2 },
  },
})

describe('database.teamOptResults (last Team Optimize results)', () => {
  it('keeps a team’s result across a reload of the database', () => {
    const storage = new SandboxStorage()
    const first = new ArtCharDatabase(1, storage)
    first.teamOptResults.setRun('team_1', run())
    const second = new ArtCharDatabase(1, storage)
    expect(second.teamOptResults.get().runs['team_1']).toEqual(
      JSON.parse(JSON.stringify(run()))
    )
  })

  it('forgets a team’s result, and only that one', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamOptResults.setRun('team_1', run())
    database.teamOptResults.setRun('team_2', run())
    database.teamOptResults.setRun('team_1', undefined)
    expect(Object.keys(database.teamOptResults.get().runs)).toEqual(['team_2'])
  })

  it('is never part of a GOOD export or import', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamOptResults.setRun('team_1', run())
    const good = database.exportGOOD() as Record<string, unknown>
    expect(JSON.stringify(good)).not.toContain('teamOptResults')
    const other = new ArtCharDatabase(1, new SandboxStorage())
    other.importGOOD(
      { ...good, teamOptResults: { runs: { team_1: run() } } } as never,
      false,
      false,
      false
    )
    expect(other.teamOptResults.get().runs).toEqual({})
  })

  it('drops what is not a result, and clears with the database', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamOptResults.set({
      runs: {
        ok: run(),
        noResult: { ...run(), result: undefined },
        noBuilds: { ...run(), result: { weapons: {} } },
        notAnObject: 5,
      } as never,
    })
    expect(Object.keys(database.teamOptResults.get().runs)).toEqual(['ok'])
    database.clear()
    expect(database.teamOptResults.get().runs).toEqual({})
  })
})
