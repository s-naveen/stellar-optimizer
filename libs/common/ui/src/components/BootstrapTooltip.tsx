import type { TooltipProps } from '@mui/material'
import { styled, Tooltip, tooltipClasses } from '@mui/material'

export const BootstrapTooltip = styled(
  ({ className, ...props }: TooltipProps) => (
    <Tooltip {...props} arrow classes={{ popper: className }} />
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
