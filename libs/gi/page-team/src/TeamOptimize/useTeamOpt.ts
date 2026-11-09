import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import { useCallback, useMemo } from 'react'

/** A change to the team's Team Optimize settings: edit the draft in place, or return new ones */
export type TeamOptUpdate = (draft: TeamOpt) => TeamOpt | void

/**
 * The team's Team Optimize settings (the defaults until something is set: the team only stores
 * them once the user changes something) and their setter.
 */
export function useTeamOpt(teamId: string) {
  const database = useDatabase()
  const stored = useTeam(teamId)?.teamOpt
  const teamOpt = useMemo(
    () =>
      // ("Main stats at +20" is no longer offered: a team that had it on runs without it)
      stored?.assumeMaxMain
        ? { ...stored, assumeMaxMain: false }
        : (stored ?? initTeamOpt()),
    [stored]
  )
  const setTeamOpt = useCallback(
    (update: TeamOptUpdate) =>
      database.teams.set(teamId, (team) => {
        const draft = structuredClone(team.teamOpt ?? initTeamOpt())
        team.teamOpt = update(draft) ?? draft
      }),
    [database, teamId]
  )
  return [teamOpt, setTeamOpt] as const
}

/**
 * What a run's result depends on among the settings: all but how the result is shown (its
 * rotation time), as JSON with the keys sorted. A result found with another key is out of date.
 */
export function teamOptRunKey(teamOpt: TeamOpt): string {
  const { rotationTime: _shownOnly, ...rest } = teamOpt
  return JSON.stringify(rest, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : value
  )
}
