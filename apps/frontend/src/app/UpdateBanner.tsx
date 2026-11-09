import { Alert, Button, Snackbar } from '@mui/material'
import { useEffect, useState } from 'react'
import { newerBuild, onNewerBuild } from './updateCheck'

/**
 * "A newer version is published": shown when the live site moved on while this page was open (or
 * opened from the offline cache). Reload when it suits you; nothing in progress is cut short.
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(newerBuild())
  useEffect(() => onNewerBuild(() => setNewer(newerBuild())), [])
  return (
    <Snackbar
      open={!!newer}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity="info"
        variant="filled"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        }
      >
        A newer version of Stellar Optimizer is published.
      </Alert>
    </Snackbar>
  )
}
