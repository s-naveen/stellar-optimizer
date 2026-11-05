import type { ButtonProps } from '@mui/material'
import { alpha, Button, styled } from '@mui/material'

// a label shaped like the buttons/inputs next to it: a neutral fill, so it does not read as clickable
const DisabledButton = styled(Button)(({ theme }) => ({
  '&.Mui-disabled': {
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
    color: theme.palette.text.secondary,
    boxShadow: 'none',
  },
}))

export function TextButton({ children, disabled, ...props }: ButtonProps) {
  return (
    <DisabledButton {...props} disabled>
      {children}
    </DisabledButton>
  )
}
