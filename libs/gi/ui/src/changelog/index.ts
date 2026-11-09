import changelog from './changelog.json'

/** One release: what it brought, in plain language (the GitHub release notes say the same) */
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

/** The release this build is */
export const currentRelease: Release = releases[0]

export const RELEASES_URL =
  'https://github.com/s-naveen/stellar-optimizer/releases'
export const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`
