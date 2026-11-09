import { CardThemed } from '@genshin-optimizer/common/ui'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  CardContent,
  CircularProgress,
  LinearProgress,
  Typography,
} from '@mui/material'
import type { MutableRefObject, ReactNode } from 'react'
import { useEffect, useReducer, useSyncExternalStore } from 'react'
export type BuildStatus = {
  type: 'active' | 'inactive'
  tested: number // tested, including `failed`
  failed: number // tested but fail the filter criteria, e.g., not enough EM
  skipped: number
  total: number
  testedPerSecond: number // number of configs tested in the last second (none are skipped)
  skippedPerSecond: number // number of configs skipped in the last second (none are tested)
  startTime?: number
  finishTime?: number
}

/** Build status published outside of React state (see TabOptimize) */
export type BuildStatusStore = {
  get: () => BuildStatus
  set: (status: BuildStatus) => void
  subscribe: (listener: () => void) => () => void
}

// Fixed locale: the surrounding text is English, and locale-specific compact
// notations ("30.72Cr", "307.21m") read oddly next to it.
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 3,
})
const plain = new Intl.NumberFormat('en-US')
/** 2,896 / 47.7K / 331M / 5.98B */
function count(n: number): string {
  if (!Number.isFinite(n)) return '–'
  return n < 10_000 ? plain.format(Math.round(n)) : compact.format(n)
}
/** 820 ms / 7.8 s / 1 min 12 s */
function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

/**
 * Progress / result of the optimizer run. While a run is active it re-renders
 * itself (10x per second) from the live solver status; nothing else in the tab
 * re-renders for progress.
 */
export default function BuildAlert({
  store,
  live,
  characterName,
}: {
  store: BuildStatusStore
  /** Live progress of the running solver; polled while the status is active */
  live?: MutableRefObject<Omit<BuildStatus, 'type'> | undefined>
  characterName: ReactNode
}) {
  const status = useSyncExternalStore(store.subscribe, store.get)
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (status.type !== 'active' || !live) return
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [status.type, live])
  const {
    type,
    tested,
    failed,
    skipped,
    total,
    testedPerSecond,
    skippedPerSecond,
    startTime,
    finishTime,
  } =
    status.type === 'active' && live?.current
      ? { ...live.current, type: status.type }
      : status

  const active = type !== 'inactive'
  if (!active && !(tested + skipped)) return null

  const hasTotal = Number.isFinite(total) && total > 0
  const checked = tested + skipped
  const progress = hasTotal ? Math.min(100, (checked / total) * 100) : 0
  const elapsed = (finishTime ?? performance.now()) - (startTime ?? Number.NaN)
  const noBuild = !active && tested - failed <= 0

  let icon: ReactNode
  let title: ReactNode
  let summary: ReactNode = null
  let details: ReactNode
  let bar: ReactNode
  if (active) {
    const rate = testedPerSecond + skippedPerSecond
    icon = <CircularProgress size={18} thickness={5} color="primary" />
    // One title for the whole run (it is what gets announced); the summary
    // tells the setup phase apart
    title = <>Optimizing {characterName}…</>
    summary = hasTotal ? (
      <>
        {count(checked)} of {count(total)} · {Math.floor(progress)}%
      </>
    ) : (
      'Preparing…'
    )
    details = (
      <>
        {duration(elapsed)}
        {hasTotal && !!skipped && <> · {count(skipped)} skipped by pruning</>}
        {hasTotal && rate > 0 && <> · {count(rate)} combinations/s</>}
      </>
    )
    bar = (
      <LinearProgress
        variant={hasTotal ? 'determinate' : 'indeterminate'}
        value={progress}
        color="primary"
        aria-label="Optimization progress"
        sx={{ height: 4, borderRadius: 2 }}
      />
    )
  } else {
    // A rate over a sub-second run is noise rather than information
    const rate = elapsed >= 1000 ? (checked / elapsed) * 1000 : Number.NaN
    icon = noBuild ? (
      <WarningAmberRoundedIcon color="warning" fontSize="small" />
    ) : (
      <CheckCircleRoundedIcon color="success" fontSize="small" />
    )
    title = noBuild ? (
      <>No valid build found for {characterName}</>
    ) : (
      <>
        Checked {count(checked)} combinations for {characterName}
      </>
    )
    summary = duration(elapsed)
    details = noBuild ? (
      <>
        {count(checked)} combinations checked · none meet the artifact set and
        stat constraints, try loosening them
      </>
    ) : (
      <>
        {count(tested)} tested
        {!!skipped && <> · {count(skipped)} skipped by pruning</>}
        {Number.isFinite(rate) && <> · {count(rate)} combinations/s</>}
      </>
    )
    // Same height as the progress bar, so the page does not jump when a run ends
    bar = (
      <LinearProgress
        variant="determinate"
        value={100}
        color={noBuild ? 'warning' : 'success'}
        aria-hidden
        sx={{ height: 4, borderRadius: 2, opacity: 0.5 }}
      />
    )
  }

  return (
    <CardThemed bgt="light">
      <CardContent
        sx={{
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr) auto',
          alignItems: 'center',
          columnGap: 1.25,
          rowGap: 0.75,
          py: 1.25,
          '&:last-child': { pb: 1.25 },
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>{icon}</Box>
        {/* Only the title is announced; the ticking numbers would be noise */}
        <Typography role="status" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {summary}
        </Typography>
        <Box sx={{ gridColumn: '2 / -1' }}>{bar}</Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ gridColumn: '2 / -1', fontVariantNumeric: 'tabular-nums' }}
        >
          {details}
        </Typography>
      </CardContent>
    </CardThemed>
  )
}
