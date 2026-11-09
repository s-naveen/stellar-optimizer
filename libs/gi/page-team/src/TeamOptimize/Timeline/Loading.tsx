import { Skeleton } from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense } from 'react'

/**
 * A sheet text (a weapon's or set's name...) that may wait for its translations: only it shows a
 * placeholder meanwhile, not the whole page
 */
export function Loading({
  children,
  width = 72,
}: {
  children: ReactNode
  width?: number
}) {
  return (
    <Suspense
      fallback={
        <Skeleton
          variant="text"
          width={width}
          sx={{ display: 'inline-block', verticalAlign: 'middle' }}
        />
      }
    >
      {children}
    </Suspense>
  )
}
