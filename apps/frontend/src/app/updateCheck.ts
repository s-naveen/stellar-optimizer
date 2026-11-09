/**
 * Keeps the site on its latest deploy. The build has an id (`__GO_BUILD_ID__`); the live site
 * says its own in version.json, which the service worker never caches. A page running an older
 * build (served from the offline cache while the network failed) reloads onto the new one: at
 * once when the app has just opened, otherwise it says so (`useUpdateAvailable`) and the user
 * reloads when it suits them, so a run in progress is not lost. One reload per build at most:
 * a network that keeps failing cannot make it loop.
 */
declare const __GO_BUILD_ID__: string

const RELOADED = 'go-reloaded-for'
let latest: string | undefined
const listeners = new Set<() => void>()

/** The build this page runs */
export const currentBuild =
  typeof __GO_BUILD_ID__ === 'string' ? __GO_BUILD_ID__ : 'dev'

/** The live site's build, if it is newer than this page's (known after a check) */
export function newerBuild(): string | undefined {
  return latest && latest !== currentBuild ? latest : undefined
}

/** Reloads the page once for `reason` (a build or the worker): never twice in a row for it */
export function reloadOnce(reason: string) {
  if (sessionStorage.getItem(RELOADED) === reason) return
  sessionStorage.setItem(RELOADED, reason)
  window.location.reload()
}

async function check(): Promise<void> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return
    const { build } = (await res.json()) as { build?: string }
    if (!build || build === latest) return
    latest = build
    for (const listener of listeners) listener()
  } catch {
    // offline: checked again when the network is back
  }
}

/** Starts checking: now, when the network comes back, and when the tab is shown again */
export function startUpdateCheck() {
  const opened = performance.now()
  // just opened on an old build: reload now (nothing to lose yet)
  check().then(() => {
    const newer = newerBuild()
    if (newer && performance.now() - opened < 15000) reloadOnce(newer)
  })
  window.addEventListener('online', () => void check())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  // and every 30 minutes, for a tab left open
  setInterval(() => void check(), 30 * 60 * 1000)
}

/** Subscribes to "a newer build is live" (for `useUpdateAvailable`) */
export function onNewerBuild(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
