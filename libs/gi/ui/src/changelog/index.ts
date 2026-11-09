import changelog from './changelog.json'

/**
 * One release: what it brought users, in plain language (the GitHub release notes say the same).
 * A release with no notes changed nothing users notice (a maintenance deploy): it has a version
 * and a GitHub release, but the app's changelog leaves it out.
 */
export type Release = {
  version: string
  /** YYYY-MM-DD */
  date: string
  title?: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
}

/** Every release, newest first (tools/site/release.mjs adds one at each deploy) */
export const releases: readonly Release[] = changelog

/** The release this build is (the footer's version) */
export const currentRelease: Release = releases[0]

/** Whether `release` brought anything users notice */
export const hasNotes = (release: Release) =>
  !!(release.new?.length || release.improved?.length || release.fixed?.length)

/** The releases the changelog shows: the ones with notes, newest first */
export const notedReleases: readonly Release[] = releases.filter(hasNotes)

/** The newest release with notes ("What's new") */
export const latestNotedRelease: Release = notedReleases[0] ?? currentRelease

export const RELEASES_URL =
  'https://github.com/s-naveen/stellar-optimizer/releases'
export const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`
