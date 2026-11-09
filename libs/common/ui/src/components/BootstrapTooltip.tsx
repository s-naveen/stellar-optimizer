import type { TooltipProps } from '@mui/material'
import { Skeleton, styled, Tooltip, tooltipClasses } from '@mui/material'
import { isValidElement, Suspense } from 'react'

export const BootstrapTooltip = styled(
  ({ className, title, ...props }: TooltipProps) => (
    <Tooltip
      {...props}
      // A title whose texts are still loading (a weapon's or an artifact set's, fetched on first
      // use) waits inside the popup. Suspending the page around it instead made the popup mount
      // again on every retry until React gave up ("Maximum update depth exceeded", #185): hovering
      // a newly chosen weapon on Team Optimize's result cards.
      title={
        isValidElement(title) ? (
          <Suspense fallback={<Skeleton variant="text" width={160} />}>
            {title}
          </Suspense>
        ) : (
          title
        )
      }
      arrow
      classes={{ popper: className }}
    />
  )
)(({ theme }) => {
  // A theme that styles its tooltips (GI: dark panel, hairline border, shadow) keeps that look;
  // the others (ZZZ, SR) keep the plain black one.
  const themed = !!theme.components?.MuiTooltip?.styleOverrides?.tooltip
  return {
    [`& .${tooltipClasses.arrow}`]: themed
      ? {}
      : { color: theme.palette.common.black },
    [`& .${tooltipClasses.tooltip}`]: {
      ...(themed ? {} : { backgroundColor: theme.palette.common.black }),
      maxWidth: 500,
    },
  }
})
