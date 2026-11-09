import { useCallback, useState, useSyncExternalStore } from 'react'

/*
 * Navigation renders in a transition (the app's router sets `v7_startTransition`): the current page
 * stays on screen, and responsive, while the next one renders, which takes a few hundred ms on a
 * slower machine. A click still has to show at once (that paint is what Interaction to Next Paint
 * measures), so:
 * - a selection derived from the route (the open tab, the active nav item) uses `useOptimisticValue`
 *   and moves as soon as it is clicked;
 * - `NavigationProgress` shows a thin bar while a clicked navigation waits for its page.
 */

let pendingSince = 0
const listeners = new Set<() => void>()
function setPendingSince(since: number) {
  if (pendingSince === since) return
  pendingSince = since
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Call when a click starts a navigation. Cleared when the next location has rendered. */
export function notePendingNavigation() {
  setPendingSince(performance.now() || 1)
}
/** The new location has rendered (or never will): the navigation is no longer pending. */
export function clearPendingNavigation() {
  setPendingSince(0)
}
/** Whether a clicked navigation is still waiting for its page to render. */
export function useNavigationPending() {
  return useSyncExternalStore(
    subscribe,
    () => pendingSince !== 0,
    () => false
  )
}

/**
 * A plain left click: the one a router link turns into a navigation in this tab (a modified click
 * opens a new tab or window instead, so it must not move the selection).
 */
export function isPlainLeftClick(event: {
  button?: number
  metaKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  )
}

/**
 * A selection derived from the route that follows a click right away. Call `select` in the click
 * handler, before navigating: the clicked value is shown until the route changes, then the route's
 * value again.
 */
export function useOptimisticValue<T>(
  routeValue: T
): readonly [T, (value: T) => void] {
  const [clicked, setClicked] = useState<{ value: T; route: T }>()
  // the route has moved since the click (to the clicked value, or elsewhere): it wins again
  const stale = clicked !== undefined && !Object.is(clicked.route, routeValue)
  if (stale) setClicked(undefined)
  const select = useCallback(
    (value: T) => {
      setClicked({ value, route: routeValue })
      if (!Object.is(value, routeValue)) notePendingNavigation()
    },
    [routeValue]
  )
  return [clicked && !stale ? clicked.value : routeValue, select] as const
}
