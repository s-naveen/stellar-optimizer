import type { ArtCharDatabase, LoadoutDatum } from '@genshin-optimizer/gi/db'

/** Remembers which build a member used before switching to a theorycraft build (not exported data) */
const storageKey = (teamCharId: string) => `go_tcFrom_${teamCharId}`

export function rememberBuildBeforeTc(
  teamCharId: string,
  buildType: LoadoutDatum['buildType']
) {
  if (buildType === 'tc') return
  try {
    localStorage.setItem(storageKey(teamCharId), buildType)
  } catch {
    // storage unavailable: "back" falls back to the loadout's real build or Equipped
  }
}

/** The build to go back to from a theorycraft build: the one it was made from, when known */
export function buildBeforeTc(
  database: ArtCharDatabase,
  teamCharId: string,
  loadoutDatum: LoadoutDatum
): Exclude<LoadoutDatum['buildType'], 'tc'> {
  const hasReal =
    !!loadoutDatum.buildId && !!database.builds.get(loadoutDatum.buildId)
  let stored: string | null = null
  try {
    stored = localStorage.getItem(storageKey(teamCharId))
  } catch {
    stored = null
  }
  if (stored === 'equipped') return 'equipped'
  if (stored === 'real' && hasReal) return 'real'
  return hasReal ? 'real' : 'equipped'
}
