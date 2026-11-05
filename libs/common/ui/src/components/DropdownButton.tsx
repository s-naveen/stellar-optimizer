import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import type { ButtonProps } from '@mui/material'
import {
  Button,
  ClickAwayListener,
  Grow,
  MenuList,
  Paper,
  Popper,
  Skeleton,
} from '@mui/material'
import { Suspense, useCallback, useState } from 'react'

export type DropdownButtonProps = Omit<ButtonProps, 'title'> & {
  title: React.ReactNode
  id?: string
  children: React.ReactNode
}
export function DropdownButton({
  title,
  children,
  id = 'dropdownbtn',
  ...props
}: DropdownButtonProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) =>
      setAnchorEl(event.currentTarget),
    [setAnchorEl]
  )
  const handleClose = useCallback(() => setAnchorEl(null), [setAnchorEl])

  return (
    <Suspense
      fallback={
        <Button endIcon={<KeyboardArrowDownIcon />} {...props}>
          <Skeleton width={50} />
        </Button>
      }
    >
      <Button
        {...props}
        id={id}
        aria-controls="basic-menu"
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleClick}
        endIcon={<KeyboardArrowDownIcon />}
      >
        {title}
      </Button>
      <Popper
        id="basic-menu"
        anchorEl={anchorEl}
        open={open}
        placement="bottom-start"
        transition
        onClick={handleClose}
        sx={{ zIndex: 1500 }} // Appear above modals
        modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
      >
        {({ TransitionProps, placement }) => (
          <Grow
            {...TransitionProps}
            style={{
              transformOrigin:
                placement === 'bottom-start' ? 'left top' : 'left bottom',
            }}
          >
            {/* same surface as the theme's menus; at least as wide as its button */}
            <Paper
              sx={(theme) => ({
                minWidth: anchorEl?.offsetWidth,
                maxHeight: '50vh',
                overflow: 'auto',
                py: 0.5,
                borderRadius: 2.5,
                backgroundColor:
                  theme.palette.contentLight?.main ??
                  theme.palette.background.paper,
                backgroundImage: 'none',
                outline: `1px solid ${theme.palette.divider}`,
                outlineOffset: -1,
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              })}
            >
              <ClickAwayListener onClickAway={handleClose}>
                <div>
                  {' '}
                  {/* div needed for ClickAwayListener to function */}
                  {/* set Skeleton to be really high so the taller dropdowns can still be placed properly... */}
                  <Suspense fallback={<Skeleton width="100%" height="1000" />}>
                    <MenuList aria-labelledby={id}>{children}</MenuList>
                  </Suspense>
                </div>
              </ClickAwayListener>
            </Paper>
          </Grow>
        )}
      </Popper>
    </Suspense>
  )
}
