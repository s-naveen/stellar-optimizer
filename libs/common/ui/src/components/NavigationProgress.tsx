import { Box, keyframes } from '@mui/material'
import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  clearPendingNavigation,
  useNavigationPending,
} from '../hooks/useOptimisticValue'

const appear = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`
const slide = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
`

/** How long a navigation may take before the bar shows: quick switches never flash it. */
const DELAY_MS = 150
/**
 * A thin bar along the top of the window while a clicked navigation waits for its page to render
 * (see useOptimisticValue). Render it inside the router. Nothing animates during the delay, so the
 * page rendering meanwhile has the main thread to itself.
 */
export function NavigationProgress() {
  const { key } = useLocation()
  const pending = useNavigationPending()
  // the new location (every navigation has a new key) has rendered: the navigation is done
  useLayoutEffect(() => clearPendingNavigation(), [key])
  // never stuck, e.g. after a click whose navigation did not happen
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(clearPendingNavigation, 15000)
    return () => clearTimeout(timer)
  }, [pending])
  if (!pending) return null
  return (
    <Box
      aria-hidden
      className="nav-progress"
      sx={(theme) => ({
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: theme.zIndex.appBar + 1,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: 0,
        animation: `${appear} 200ms ease-out ${DELAY_MS}ms forwards`,
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: '40%',
          borderRadius: 2,
          bgcolor: 'primary.main',
          animation: `${slide} 1.1s ease-in-out ${DELAY_MS}ms infinite`,
        },
        '@media (prefers-reduced-motion: reduce)': {
          '&::after': { width: '100%', opacity: 0.5, animation: 'none' },
        },
      })}
    />
  )
}
