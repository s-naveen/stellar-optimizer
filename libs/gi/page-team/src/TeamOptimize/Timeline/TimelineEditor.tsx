import { CardThemed } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamOptAttackTime,
} from '@genshin-optimizer/gi/db'
import { useDBGender } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type {
  Interval,
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  acceptedActivations,
  activationSource,
  arrangeTimeline,
  buffRefKey,
  buffSources,
  CharacterName,
  mergeIntervals,
  runsOn,
  timelineLength,
  timelineSegments,
  timelineWindows,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BoltIcon from '@mui/icons-material/Bolt'
import CloseIcon from '@mui/icons-material/Close'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import GroupsIcon from '@mui/icons-material/Groups'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import UndoIcon from '@mui/icons-material/Undo'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import type { Theme } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  darken,
  IconButton,
  keyframes,
  lighten,
  Tooltip,
  Typography,
} from '@mui/material'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AttackEditor } from '../AttackEditor'
import { AttackName } from '../AttackName'
import type { TeamBuff } from '../buffs'
import { buffsForAttacker } from '../buffs'
import { formatDamage } from '../format'
import { MemberAvatar } from '../MemberAvatar'
import type { TeamOptUpdate } from '../useTeamOpt'
import { BuffSettings } from './BuffSettings'
import { Loading } from './Loading'
import { TimedBuffsPanel, useTriggerNames } from './TimedBuffsPanel'

/** Width of the labels column (members, buffs) */
const GUTTER = 200
/** A card's height, the gap between stacked cards, and a track's padding (room for buff pips) */
const CARD_H = 34
const ROW_GAP = 10
const TRACK_PAD = 14
const LANE_H = 34
const MIN_ZOOM = 1
const MAX_ZOOM = 12
/** Times snap to a tenth of a second (Alt: free) */
const SNAP = 0.1
/** Ruler steps (seconds): the smallest that leaves room for its label */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120]
/** Springy easing: things overshoot a little, then settle */
const SPRING = 'cubic-bezier(.34,1.56,.64,1)'
const GUIDE_KEY = 'teamOptTimelineGuideSeen'

const pop = keyframes`
  0% { transform: scale(1.07) rotate(-1.5deg); }
  45% { transform: scale(.94) rotate(.6deg); }
  75% { transform: scale(1.03) rotate(0); }
  100% { transform: scale(1) rotate(0); }
`
const floatUp = keyframes`
  0% { opacity: 0; transform: translate(-50%, 6px) scale(.6); }
  15% { opacity: 1; transform: translate(-50%, -6px) scale(1.12); }
  30% { transform: translate(-50%, -10px) scale(1); }
  80% { opacity: 1; transform: translate(-50%, -22px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -30px) scale(.95); }
`
const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`

type Ref = { member: CharacterKey; index: number }
/** The attack being dragged, where it is now (`done`: released, until saved) */
type Draft = Ref & { at: TeamOptAttackTime; done?: boolean }
type Drag = Ref & {
  mode: 'move' | 'start' | 'end'
  x0: number
  start0: number
  end0: number
  pxPerSec: number
  moved: boolean
}
type Windows = ReturnType<typeof timelineWindows>
/** A card's effect: bounce after a drop, then the damage it made (a share of the rotation's) */
type Fx = Ref & { id: number; delta?: number }
/** A buff's share of a card's hits it is up for */
type Pip = {
  key: string
  share: number
  icon: ReactNode
  owner: CharacterKey | 'team'
}

/** A tiny store outside React state: only what reads it re-renders when it changes */
function createStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
type Store<T> = ReturnType<typeof createStore<T>>
type Stores = {
  draft: Store<Draft | undefined>
  /** The buff whose ribbon is hovered: its hits light up */
  hover: Store<string | undefined>
  fx: Store<Fx | undefined>
}

const round2 = (x: number) => Math.round(x * 100) / 100
const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x))
const snapTo = (x: number, free: boolean) =>
  round2(free ? x : Math.round(x / SNAP) * SNAP)
const fmt = (x: number) => `${round2(x)}`
const pct = (x: number) =>
  `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`

/** When the last timed attack ends */
function lastEnd(attacks: TeamOpt['attacks']) {
  let end = 0
  for (const list of Object.values(attacks))
    for (const a of list ?? []) if (a.at) end = Math.max(end, a.at.end)
  return end
}

/** The attacks with the dragged one where it is now */
function withDraft(attacks: TeamOpt['attacks'], draft: Draft | undefined) {
  if (!draft) return attacks
  const list = [...(attacks[draft.member] ?? [])]
  if (list[draft.index])
    list[draft.index] = { ...list[draft.index], at: draft.at }
  return { ...attacks, [draft.member]: list }
}

/** Rows for a member's cards, so overlapping attacks are not hidden behind each other */
function packRows(attacks: readonly TeamOptAttack[], minSpan: number) {
  const rowOf: number[] = []
  const ends: number[] = []
  const order = attacks
    .map((attack, index) => ({ at: attack.at, index }))
    .filter((x): x is { at: TeamOptAttackTime; index: number } => !!x.at)
    .sort((a, b) => a.at.start - b.at.start || a.at.end - b.at.end)
  for (const { at, index } of order) {
    let row = ends.findIndex((end) => end <= at.start + 1e-6)
    if (row < 0) {
      row = ends.length
      ends.push(0)
    }
    ends[row] = Math.max(at.end, at.start + minSpan)
    rowOf[index] = row
  }
  return { rowOf, rows: Math.max(1, ends.length) }
}

/** A member's element colour (cards, ribbons); the team's: gold */
function ownerColor(theme: Theme, owner: CharacterKey | 'team') {
  if (owner === 'team') return theme.palette.primary.main
  const palette = theme.palette as unknown as Record<
    string,
    { main?: string } | undefined
  >
  return palette[getCharEle(owner)]?.main ?? theme.palette.primary.main
}

/** A buff as listed: where it comes from (a set, a weapon, a talent), then its condition */
function buffNames(buff: TeamBuff | undefined, path: readonly string[]) {
  if (!buff) return { title: path.join(' · '), condition: undefined }
  const condition = buff.label ?? buff.name
  return buff.title
    ? { title: buff.title, condition }
    : { title: condition, condition: undefined }
}

/** Whether a buff can reach a member's hits */
const reaches = (buff: TeamBuff | undefined, member: CharacterKey) =>
  !!buff &&
  (buff.ref.owner === member || buff.ref.owner === 'team' || buff.teamBuff)

/** The share of an attack's hits each timed buff (that reaches them) is up for */
function pipsOf(
  member: CharacterKey,
  attack: TeamOptAttack,
  windows: Windows,
  buffsByKey: ReadonlyMap<string, TeamBuff>
): Pip[] {
  const reaching = windows.filter(({ ref }) =>
    reaches(buffsByKey.get(buffRefKey(ref)), member)
  )
  if (!reaching.length || !attack.at) return []
  const segments = timelineSegments(attack, reaching)
  const total = segments.reduce((n, s) => n + s.hits, 0) || 1
  return reaching.map(({ ref }) => {
    const key = buffRefKey(ref)
    const off = segments
      .filter((s) => s.excluded.some((r) => buffRefKey(r) === key))
      .reduce((n, s) => n + s.hits, 0)
    return {
      key,
      share: round2(1 - off / total),
      icon: buffsByKey.get(key)?.icon,
      owner: ref.owner,
    }
  })
}

/** A number that eases to its new value (a counter that rolls, as scores do) */
function useRolling(value: number | undefined, ms = 650) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (value === undefined) return setShown(undefined)
    const start = from.current ?? value
    if (start === value) return setShown(value)
    const t0 = performance.now()
    let frame = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const eased = 1 - (1 - k) ** 3
      const v = start + (value - start) * eased
      from.current = v
      setShown(v)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, ms])
  return shown
}

/**
 * The rotation's timeline (Team Optimize's advanced mode). Each attack is a card placed when it
 * happens; ribbons show when each buff that runs out is up, and the pips on a card which of
 * those buffs its hits get. Drag cards to change when they happen: the damage follows.
 */
export function TimelineEditor({
  teamId,
  teamData,
  members,
  teamOpt,
  setTeamOpt,
  buffs,
  onField,
  mainStatAssumptionLevel,
  disabled,
  evaluation,
  alwaysUpTotal,
}: {
  teamId: string
  teamData: TeamData | undefined
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  buffs: TeamBuff[]
  onField: CharacterKey
  mainStatAssumptionLevel: number
  disabled?: boolean
  /** The rotation's damage now (with the timeline) */
  evaluation: TeamOptEvaluation | undefined
  /** The same rotation's damage with every buff up all the time */
  alwaysUpTotal: number | undefined
}) {
  const { t } = useTranslation('page_team')
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<Ref>()
  const [editing, setEditing] = useState<Ref>()
  const [showBuffs, setShowBuffs] = useState(false)
  const [guide, setGuide] = useState(() => !localStorage.getItem(GUIDE_KEY))
  /** Times before the last Arrange */
  const [undo, setUndo] =
    useState<Partial<Record<CharacterKey, (TeamOptAttackTime | undefined)[]>>>()
  const [laneWidth, setLaneWidth] = useState(0)
  const [stores] = useState<Stores>(() => ({
    draft: createStore<Draft | undefined>(undefined),
    hover: createStore<string | undefined>(undefined),
    fx: createStore<Fx | undefined>(undefined),
  }))
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const crossRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>()
  const lastDraft = useRef<Draft>()
  const frame = useRef(0)
  /** The drop waiting for the damage to update (its card shows the change) */
  const pendingDrop = useRef<Ref & { before: number; t: number }>()
  const anchor = useRef<{ frac: number; clientX: number }>()

  const order = useMemo(() => members.map((m) => m.characterKey), [members])
  const committedEnd = useMemo(
    () => lastEnd(teamOpt.attacks),
    [teamOpt.attacks]
  )
  // (as set, else the default: the timeline repeats at its end)
  const rotationEnd = timelineLength(teamOpt)
  const length = Math.max(rotationEnd, Math.ceil(committedEnd))
  const buffsByKey = useMemo(
    () => new Map(buffs.map((b) => [b.key, b])),
    [buffs]
  )
  const windows = useMemo(
    () =>
      timelineWindows({
        ...teamOpt,
        timeline: { buffs: [], ...teamOpt.timeline, on: true },
      }).filter(({ ref }) => buffsByKey.has(buffRefKey(ref))),
    [teamOpt, buffsByKey]
  )
  const evaluationRef = useRef(evaluation)
  evaluationRef.current = evaluation
  const getDamage = useCallback(
    (member: CharacterKey, index: number) =>
      evaluationRef.current?.attacks[member]?.[index],
    []
  )
  const hasAttacks = order.some((m) => (teamOpt.attacks[m] ?? []).length)
  const total = evaluation?.total

  // (read by the pointer handlers, which stay the same from render to render)
  const live = useRef({ attacks: teamOpt.attacks, length, disabled, total })
  live.current = { attacks: teamOpt.attacks, length, disabled, total }
  // a released drag is shown until it is saved
  useEffect(() => {
    if (stores.draft.get()?.done) stores.draft.set(undefined)
  }, [teamOpt.attacks, stores])
  // the damage after a drop: shown on the dropped card
  useEffect(() => {
    const drop = pendingDrop.current
    if (!drop || total === undefined) return
    if (performance.now() - drop.t > 6000) {
      pendingDrop.current = undefined
      return
    }
    if (total === drop.before) return
    pendingDrop.current = undefined
    stores.fx.set({
      member: drop.member,
      index: drop.index,
      id: performance.now(),
      delta: drop.before ? total / drop.before - 1 : 0,
    })
  }, [total, stores])

  const setTime = useCallback(
    (
      member: CharacterKey,
      index: number,
      at: TeamOptAttackTime | undefined
    ) => {
      setUndo(undefined)
      setTeamOpt((o) => {
        const list = o.attacks[member]
        if (!list?.[index]) return
        const { at: _, ...rest } = list[index]
        list[index] = at ? { ...rest, at } : rest
      })
    },
    [setTeamOpt]
  )

  // --- dragging a card: it follows the pointer (a frame at a time), saved once released
  const onBarDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, ref: Ref, mode: Drag['mode']) => {
      if (e.button !== 0) return
      e.stopPropagation()
      setSelected(ref)
      gridRef.current?.focus({ preventScroll: true })
      const { attacks, length, disabled } = live.current
      const at = attacks[ref.member]?.[ref.index]?.at
      const lane = laneRef.current
      if (disabled || !at || !lane) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = {
        ...ref,
        mode,
        x0: e.clientX,
        start0: at.start,
        end0: at.end,
        pxPerSec: lane.getBoundingClientRect().width / length,
        moved: false,
      }
    },
    []
  )
  const onBarMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return
      d.moved = true
      const { length } = live.current
      const dt = (e.clientX - d.x0) / d.pxPerSec
      const free = e.altKey
      let start = d.start0
      let end = d.end0
      if (d.mode === 'move') {
        const span = d.end0 - d.start0
        start = clamp(
          snapTo(d.start0 + dt, free),
          0,
          Math.max(0, length - span)
        )
        end = start + span
      } else if (d.mode === 'start')
        start = clamp(snapTo(d.start0 + dt, free), 0, d.end0)
      else end = clamp(snapTo(d.end0 + dt, free), d.start0, length)
      const next: Draft = {
        member: d.member,
        index: d.index,
        at: { start: round2(start), end: round2(end) },
      }
      lastDraft.current = next
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => stores.draft.set(next))
    },
    [stores]
  )
  const onBarUp = useCallback(() => {
    const d = drag.current
    drag.current = undefined
    cancelAnimationFrame(frame.current)
    const placed = lastDraft.current
    lastDraft.current = undefined
    if (!d?.moved || !placed) return stores.draft.set(undefined)
    const before = live.current.attacks[placed.member]?.[placed.index]?.at
    if (before?.start === placed.at.start && before.end === placed.at.end)
      return stores.draft.set(undefined)
    stores.draft.set({ ...placed, done: true })
    // the drop bounces now; its damage change shows once computed
    stores.fx.set({
      member: placed.member,
      index: placed.index,
      id: performance.now(),
    })
    if (live.current.total !== undefined)
      pendingDrop.current = {
        member: placed.member,
        index: placed.index,
        before: live.current.total,
        t: performance.now(),
      }
    setTime(placed.member, placed.index, placed.at)
  }, [stores, setTime])

  // --- the crosshair: follows the pointer without a render
  const onGridMove = (e: ReactPointerEvent) => {
    const lane = laneRef.current
    const cross = crossRef.current
    if (!lane || !cross) return
    const rect = lane.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < 0 || x > rect.width) {
      cross.style.opacity = '0'
      return
    }
    cross.style.opacity = '1'
    cross.style.transform = `translateX(${x}px)`
    const label = cross.firstElementChild as HTMLElement | null
    if (label) label.textContent = `${((x / rect.width) * length).toFixed(1)} s`
  }

  // --- keys: nudge the selected attack, change its end, open it
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!selected) return
    if (e.key === 'Escape') return setSelected(undefined)
    if (e.key === 'Enter') return setEditing(selected)
    const at = teamOpt.attacks[selected.member]?.[selected.index]?.at
    if (!at || disabled) return
    const step = SNAP * (e.shiftKey ? 10 : 1)
    const span = at.end - at.start
    const move = (dt: number) => {
      const start = clamp(at.start + dt, 0, Math.max(0, length - span))
      setTime(selected.member, selected.index, {
        start: round2(start),
        end: round2(start + span),
      })
    }
    const stretch = (dt: number) =>
      setTime(selected.member, selected.index, {
        start: at.start,
        end: round2(clamp(at.end + dt, at.start, length)),
      })
    const actions: Record<string, () => void> = {
      ArrowLeft: () => move(-step),
      ArrowRight: () => move(step),
      '[': () => stretch(-step),
      ']': () => stretch(step),
    }
    const action = actions[e.key]
    if (!action) return
    e.preventDefault()
    action()
  }

  // --- zoom: buttons, or Ctrl/⌘ + wheel (a pinch) at the pointer
  const zoomTo = useCallback(
    (next: (zoom: number) => number, clientX?: number) => {
      const scroller = scrollRef.current
      const lane = laneRef.current
      if (scroller && lane) {
        const rect = lane.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        const x = clientX ?? box.left + GUTTER + (box.width - GUTTER) / 2
        anchor.current = { frac: (x - rect.left) / rect.width, clientX: x }
      }
      setZoom((z) => clamp(next(z), MIN_ZOOM, MAX_ZOOM))
    },
    []
  )
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = undefined
    const scroller = scrollRef.current
    const lane = laneRef.current
    if (!a || !scroller || !lane) return
    const rect = lane.getBoundingClientRect()
    scroller.scrollLeft += rect.left + a.frac * rect.width - a.clientX
  }, [zoom])
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -60, 60)
      zoomTo((z) => z * Math.exp(-delta * 0.01), e.clientX)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [hasAttacks, zoomTo])
  useEffect(() => {
    const lane = laneRef.current
    if (!lane) return
    const observer = new ResizeObserver(([entry]) =>
      setLaneWidth(entry.contentRect.width)
    )
    observer.observe(lane)
    return () => observer.disconnect()
  }, [hasAttacks])
  const pxPerSec = (laneWidth || 800) / length
  const ticks = useMemo(() => {
    const step = TICK_STEPS.find((s) => s * pxPerSec >= 52) ?? 120
    const out: number[] = []
    for (let s = 0; s <= length + 1e-9; s += step) out.push(round2(s))
    return out
  }, [pxPerSec, length])
  /** Seconds of the smallest card, for stacking cards that would cover each other */
  const minSpan = round2(14 / pxPerSec)

  const arrange = (only?: 'untimed') => {
    if (!only)
      setUndo(
        Object.fromEntries(
          order.map((m) => [m, (teamOpt.attacks[m] ?? []).map((a) => a.at)])
        )
      )
    setTeamOpt((o) => {
      o.attacks = arrangeTimeline(order, o.attacks, {
        length: timelineLength(o),
        ...(only ? { only } : {}),
        ...(o.onField ? { carry: o.onField } : {}),
      })
    })
  }
  const restore = () => {
    const before = undo
    setUndo(undefined)
    if (!before) return
    setTeamOpt((o) => {
      for (const [member, times] of Object.entries(before)) {
        const list = o.attacks[member as CharacterKey]
        times?.forEach((at, i) => {
          const attack = list?.[i]
          if (!attack) return
          if (at) attack.at = at
          else delete attack.at
        })
      }
    })
  }
  const setWindows = useCallback(
    (key: string, intervals: Interval[]) =>
      setTeamOpt((o) => {
        const buff = o.timeline?.buffs.find((b) => buffRefKey(b) === key)
        if (!buff) return
        const windows = intervals.map(
          ([a, b]) => [round2(a), round2(b)] as [number, number]
        )
        if (windows.length) buff.windows = windows
        else delete buff.windows
      }),
    [setTeamOpt]
  )
  const openBuffs = useCallback(() => setShowBuffs(true), [])
  /** The buff whose settings are open (from its ribbon's name) */
  const [settings, setSettings] = useState<{
    key: string
    anchor: HTMLElement
  }>()
  const openSettings = useCallback(
    (key: string, anchor: HTMLElement) => setSettings({ key, anchor }),
    []
  )
  const settingsTiming =
    settings &&
    teamOpt.timeline?.buffs.find((b) => buffRefKey(b) === settings.key)
  /** Per card (`member:index`), the timed buffs it starts */
  const startsByCard = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const { buff, ref } of windows)
      for (const { member, index } of buffSources(buff, teamOpt.attacks)) {
        const id = `${member}:${index}`
        map.set(id, [...(map.get(id) ?? []), buffRefKey(ref)])
      }
    return map
  }, [windows, teamOpt.attacks])
  const closeGuide = () => {
    localStorage.setItem(GUIDE_KEY, '1')
    setGuide(false)
  }

  const unplacedOf = (member: CharacterKey) =>
    (teamOpt.attacks[member] ?? []).filter((a) => !a.at && a.hits > 0).length
  const unplaced = order.reduce((n, m) => n + unplacedOf(m), 0)
  const editingAttack =
    editing && teamOpt.attacks[editing.member]?.[editing.index]

  return (
    <CardThemed
      bgt="light"
      sx={{ display: 'flex', flexDirection: 'column', overflow: 'visible' }}
    >
      <Impact
        total={total}
        alwaysUp={alwaysUpTotal}
        timedCount={windows.length}
      />
      {guide && <Guide onClose={closeGuide} />}

      {/* toolbar: one main action, the rest quiet */}
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Tooltip
          title={t(
            'teamOpt.timeline.arrangeHint',
            'Lay out every attack again: the supports’ skills and bursts first, then the member on the field; fields and summons run on from their cast'
          )}
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoAwesomeIcon />}
              onClick={() => arrange()}
              disabled={disabled || !hasAttacks}
              sx={{ borderRadius: 999, fontWeight: 700 }}
            >
              {t('teamOpt.timeline.arrange', 'Auto-arrange')}
            </Button>
          </span>
        </Tooltip>
        {undo && (
          <Button
            size="small"
            color="inherit"
            startIcon={<UndoIcon />}
            onClick={restore}
            disabled={disabled}
            sx={{ color: 'text.secondary', borderRadius: 999 }}
          >
            {t('teamOpt.timeline.undo', 'Undo')}
          </Button>
        )}
        {!!unplaced && (
          <Button
            size="small"
            color="warning"
            variant="outlined"
            onClick={() => arrange('untimed')}
            disabled={disabled}
            sx={{ borderRadius: 999 }}
          >
            {t('teamOpt.timeline.placeRest', {
              defaultValue: 'Place {{count}} new attacks',
              count: unplaced,
            })}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          color={showBuffs ? 'primary' : 'inherit'}
          variant={showBuffs ? 'contained' : 'outlined'}
          startIcon={<TimerOutlinedIcon />}
          onClick={() => setShowBuffs((s) => !s)}
          aria-expanded={showBuffs}
          sx={{ borderRadius: 999, fontWeight: 700 }}
        >
          {t('teamOpt.timeline.timedBuffs', {
            defaultValue: 'Buffs that run out · {{count}}',
            count: windows.length,
          })}
        </Button>
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            borderRadius: 999,
            border: `1px solid ${alpha(theme.palette.text.primary, 0.14)}`,
          })}
        >
          <IconButton
            size="small"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomTo((z) => z / 1.5)}
            aria-label={t('teamOpt.timeline.zoomOut', 'Zoom out')}
          >
            <ZoomOutIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            disabled={zoom === 1}
            onClick={() => zoomTo(() => 1)}
            aria-label={t('teamOpt.timeline.fit', 'Fit the whole rotation')}
          >
            <FitScreenIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomTo((z) => z * 1.5)}
            aria-label={t('teamOpt.timeline.zoomIn', 'Zoom in')}
          >
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Box>
        {!guide && (
          <IconButton
            size="small"
            onClick={() => setGuide(true)}
            aria-label={t('teamOpt.timeline.helpLabel', 'How it works')}
          >
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {showBuffs && (
        <TimedBuffsPanel
          buffs={buffs}
          members={members}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          disabled={disabled}
        />
      )}

      {!hasAttacks ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {t(
            'teamOpt.timeline.empty',
            'Add the members’ attacks below: they show up here, to place in time.'
          )}
        </Typography>
      ) : (
        <Box
          ref={scrollRef}
          sx={{
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'relative',
            overscrollBehaviorX: 'contain',
          }}
        >
          <Box
            ref={gridRef}
            role="application"
            aria-label={t('teamOpt.timeline.label', 'Rotation timeline')}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerMove={onGridMove}
            onPointerLeave={() => {
              if (crossRef.current) crossRef.current.style.opacity = '0'
            }}
            sx={(theme) => ({
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `${GUTTER}px minmax(0, 1fr)`,
              width: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${zoom})`,
              minWidth: '100%',
              outline: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              backgroundImage: `linear-gradient(180deg, ${alpha(theme.palette.common.black, 0.18)}, transparent 240px)`,
            })}
          >
            {/* second marks across every row, and what is past the rotation's end */}
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${GUTTER}px`,
                right: 0,
                pointerEvents: 'none',
              }}
            >
              {ticks.map((s) =>
                s ? (
                  <Box
                    key={s}
                    sx={(theme) => ({
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${(s / length) * 100}%`,
                      width: '1px',
                      backgroundColor: alpha(theme.palette.text.primary, 0.05),
                    })}
                  />
                ) : null
              )}
              {!!rotationEnd && length > rotationEnd && (
                <Box
                  sx={(theme) => ({
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(rotationEnd / length) * 100}%`,
                    right: 0,
                    borderLeft: `1px dashed ${alpha(theme.palette.warning.main, 0.6)}`,
                    backgroundImage: `repeating-linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.05)} 0 6px, transparent 6px 12px)`,
                  })}
                />
              )}
            </Box>

            {/* ruler */}
            <Gutter>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
              >
                {t('teamOpt.timeline.length', {
                  defaultValue: '{{length}} s rotation',
                  length: rotationEnd,
                })}
              </Typography>
            </Gutter>
            <Box
              ref={laneRef}
              sx={(theme) => ({
                position: 'relative',
                height: 28,
                borderBottom: `1px solid ${theme.palette.divider}`,
              })}
            >
              {ticks.map((s) => (
                <Typography
                  key={s}
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    left: `${(s / length) * 100}%`,
                    bottom: 5,
                    pl: '4px',
                    color: 'text.secondary',
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s}s
                </Typography>
              ))}
            </Box>

            {/* a track per member */}
            {members.map((member) => (
              <MemberTrack
                key={member.characterKey}
                member={member}
                attacks={teamOpt.attacks[member.characterKey] ?? []}
                length={length}
                minSpan={minSpan}
                data={teamData?.[member.characterKey]?.target}
                selectedIndex={
                  selected?.member === member.characterKey
                    ? selected.index
                    : undefined
                }
                unplaced={unplacedOf(member.characterKey)}
                stores={stores}
                windows={windows}
                startsByCard={startsByCard}
                buffsByKey={buffsByKey}
                getDamage={getDamage}
                onBarDown={onBarDown}
                onBarMove={onBarMove}
                onBarUp={onBarUp}
                onOpen={setEditing}
                onSelect={setSelected}
              />
            ))}

            {/* a ribbon per buff that runs out, live while a card is dragged */}
            <BuffLanes
              stores={stores}
              teamOpt={teamOpt}
              buffsByKey={buffsByKey}
              length={length}
              disabled={disabled}
              onWindows={setWindows}
              onShowBuffs={openBuffs}
              onBarDown={onBarDown}
              onBarMove={onBarMove}
              onBarUp={onBarUp}
              onOpenSettings={openSettings}
            />

            {/* the crosshair, over everything */}
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${GUTTER}px`,
                right: 0,
                pointerEvents: 'none',
                overflow: 'hidden',
                zIndex: 3,
              }}
            >
              <Box
                ref={crossRef}
                sx={(theme) => ({
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: '1px',
                  backgroundColor: alpha(theme.palette.primary.main, 0.6),
                  opacity: 0,
                  transition: 'opacity 120ms',
                  willChange: 'transform',
                })}
              >
                <Box
                  component="span"
                  sx={(theme) => ({
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    px: 0.5,
                    borderRadius: 0.5,
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                    color: theme.palette.primary.contrastText,
                    backgroundColor: theme.palette.primary.main,
                    fontVariantNumeric: 'tabular-nums',
                  })}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {editing && editingAttack && (
        <AttackEditor
          open
          onClose={() => setEditing(undefined)}
          teamId={teamId}
          characterKey={editing.member}
          data={teamData?.[editing.member]?.target}
          attack={editingAttack}
          buffs={buffsForAttacker(buffs, editing.member)}
          mainStatAssumptionLevel={mainStatAssumptionLevel}
          members={members}
          onField={onField}
          onChange={(attack) =>
            setTeamOpt((o) => {
              const list = o.attacks[editing.member]
              if (list?.[editing.index]) list[editing.index] = attack
            })
          }
          onDuplicate={() =>
            setTeamOpt((o) => {
              const list = o.attacks[editing.member]
              const attack = list?.[editing.index]
              if (!list || !attack) return
              // the copy right after it in time
              const copy = structuredClone(attack)
              if (attack.at) {
                const span = attack.at.end - attack.at.start
                copy.at = {
                  start: attack.at.end,
                  end: round2(attack.at.end + span),
                }
              }
              list.splice(editing.index + 1, 0, copy)
            })
          }
          onRemove={() => {
            setTeamOpt((o) => {
              o.attacks[editing.member]?.splice(editing.index, 1)
            })
            setEditing(undefined)
            setSelected(undefined)
          }}
        />
      )}
      {settings && settingsTiming && (
        <BuffSettings
          anchor={settings.anchor}
          onClose={() => setSettings(undefined)}
          timing={settingsTiming}
          buff={buffsByKey.get(settings.key)}
          members={members}
          teamOpt={teamOpt}
          teamData={teamData}
          setTeamOpt={setTeamOpt}
          disabled={disabled}
        />
      )}
    </CardThemed>
  )
}

/**
 * What the timing costs: the rotation's damage with the buffs as timed, against the same
 * rotation with every buff always up (which is what List counts)
 */
function Impact({
  total,
  alwaysUp,
  timedCount,
}: {
  total: number | undefined
  alwaysUp: number | undefined
  timedCount: number
}) {
  const { t } = useTranslation('page_team')
  const kept =
    total !== undefined && alwaysUp ? Math.min(1, total / alwaysUp) : undefined
  const keptShown = useRolling(kept)
  const lost = kept !== undefined ? 1 - kept : undefined
  // (the rotation's damage and DPS are in the page's header)
  if (!timedCount || kept === undefined) return null
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 3,
        rowGap: 1,
        px: 2,
        py: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
        background: `radial-gradient(120% 140% at 0% 0%, ${alpha(theme.palette.primary.main, 0.16)}, transparent 60%)`,
      })}
    >
      {timedCount > 0 && kept !== undefined && keptShown !== undefined && (
        <Box sx={{ flex: '1 1 320px', minWidth: 0, maxWidth: 760 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 1,
              mb: 0.75,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {lost !== undefined && lost > 0.0005
                ? t('teamOpt.timeline.impact.lost', {
                    defaultValue: 'Buffs that run out cost you {{lost}}',
                    lost: pct(lost).replace('+', ''),
                  })
                : t(
                    'teamOpt.timeline.impact.full',
                    'Every buff is up on every hit'
                  )}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
            >
              {t('teamOpt.timeline.impact.vs', {
                defaultValue: '{{kept}} of the damage if always up',
                kept: `${Math.round(keptShown * 100)}%`,
              })}
            </Typography>
          </Box>
          {/* the meter: what the timing keeps, in gold; what it loses, dim */}
          <Box
            sx={(theme) => ({
              position: 'relative',
              height: 12,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: alpha(theme.palette.text.primary, 0.1),
              boxShadow: `inset 0 1px 2px ${alpha('#000', 0.5)}`,
            })}
          >
            <Box
              sx={(theme) => ({
                position: 'absolute',
                inset: 0,
                width: `${keptShown * 100}%`,
                borderRadius: 999,
                background: `linear-gradient(90deg, ${darken(theme.palette.primary.main, 0.15)}, ${lighten(theme.palette.primary.main, 0.2)}, ${darken(theme.palette.primary.main, 0.15)})`,
                backgroundSize: '200% 100%',
                animation: `${shimmer} 3.5s linear infinite`,
                boxShadow: `inset 0 2px 0 ${alpha('#fff', 0.35)}`,
              })}
            />
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ mt: 0.5 }}
          >
            {lost !== undefined && lost > 0.0005
              ? t(
                  'teamOpt.timeline.impact.hint',
                  'Move attacks into the buffs’ ribbons to win it back. List counts every buff as always up.'
                )
              : t(
                  'teamOpt.timeline.impact.hintFull',
                  'Your timing loses nothing: this is what List counts too.'
                )}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/** The first time: what the timeline is, in three steps */
function Guide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('page_team')
  const steps = [
    {
      n: 1,
      title: t('teamOpt.timeline.guide.cards', 'Cards are your attacks'),
      text: t(
        'teamOpt.timeline.guide.cardsText',
        'Each card sits when it happens in the rotation. Drag it to move it, pull its edges to stretch it.'
      ),
    },
    {
      n: 2,
      title: t(
        'teamOpt.timeline.guide.ribbons',
        'Ribbons are buffs that run out'
      ),
      text: t(
        'teamOpt.timeline.guide.ribbonsText',
        'Each ribbon starts with the attacks that trigger it (the ◆ marks). Click its name to choose them, or drag the ribbon to move them. Hover it: the hits it powers light up.'
      ),
    },
    {
      n: 3,
      title: t(
        'teamOpt.timeline.guide.score',
        'Only hits under a ribbon get it'
      ),
      text: t(
        'teamOpt.timeline.guide.scoreText',
        'The icons on a card show which buffs its hits get. Move cards under the ribbons: the damage above updates.'
      ),
    },
  ]
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
        backgroundColor: alpha(theme.palette.primary.main, 0.06),
      })}
    >
      {steps.map(({ n, title, text }) => (
        <Box
          key={n}
          sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}
        >
          <Box
            sx={(theme) => ({
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              color: theme.palette.primary.contrastText,
              background: `linear-gradient(180deg, ${lighten(theme.palette.primary.main, 0.25)}, ${darken(theme.palette.primary.main, 0.2)})`,
              boxShadow: `0 2px 0 ${darken(theme.palette.primary.main, 0.5)}, inset 0 1px 0 ${alpha('#fff', 0.4)}`,
            })}
          >
            {n}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {title}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
            >
              {text}
            </Typography>
          </Box>
        </Box>
      ))}
      <IconButton
        size="small"
        onClick={onClose}
        aria-label={t('teamOpt.timeline.guide.close', 'Got it')}
        sx={{ position: 'absolute', top: 6, right: 6 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

/** A cell of the labels column: stays in view when the timeline scrolls */
function Gutter({
  children,
  divider,
}: {
  children: ReactNode
  divider?: boolean
}) {
  return (
    <Box
      sx={(theme) => ({
        position: 'sticky',
        left: 0,
        zIndex: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        minWidth: 0,
        backgroundColor: theme.palette.contentLight.main,
        borderRight: `1px solid ${theme.palette.divider}`,
        ...(divider ? { borderTop: `1px solid ${theme.palette.divider}` } : {}),
      })}
    >
      {children}
    </Box>
  )
}

type BarHandlers = {
  onBarDown: (
    e: ReactPointerEvent<HTMLElement>,
    ref: Ref,
    mode: Drag['mode']
  ) => void
  onBarMove: (e: ReactPointerEvent) => void
  onBarUp: () => void
  onOpen: (ref: Ref) => void
}

const MemberTrack = memo(function MemberTrack({
  member,
  attacks,
  length,
  minSpan,
  data,
  selectedIndex,
  unplaced,
  stores,
  windows,
  startsByCard,
  buffsByKey,
  getDamage,
  onSelect,
  ...handlers
}: {
  member: TeamOptMember
  attacks: TeamOptAttack[]
  length: number
  minSpan: number
  data: UIData | undefined
  selectedIndex: number | undefined
  unplaced: number
  stores: Stores
  windows: Windows
  startsByCard: ReadonlyMap<string, string[]>
  buffsByKey: ReadonlyMap<string, TeamBuff>
  getDamage: (member: CharacterKey, index: number) => number | undefined
  onSelect: (ref: Ref | undefined) => void
} & BarHandlers) {
  const { t } = useTranslation('page_team')
  const gender = useDBGender()
  const { characterKey } = member
  const { rowOf, rows } = useMemo(
    () => packRows(attacks, minSpan),
    [attacks, minSpan]
  )
  const pips = useMemo(
    () => attacks.map((a) => pipsOf(characterKey, a, windows, buffsByKey)),
    [attacks, characterKey, windows, buffsByKey]
  )
  const placed = attacks.some((a) => a.at)
  return (
    <>
      <Gutter>
        <Box
          sx={(theme) => {
            const color = ownerColor(theme, characterKey)
            return {
              borderRadius: '50%',
              p: '2px',
              background: `linear-gradient(180deg, ${lighten(color, 0.3)}, ${darken(color, 0.3)})`,
              boxShadow: `0 0 10px ${alpha(color, 0.45)}`,
              lineHeight: 0,
            }
          }}
        >
          <MemberAvatar characterKey={characterKey} size={34} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
          {!!unplaced && (
            <Typography
              variant="caption"
              color="warning.main"
              noWrap
              component="div"
              sx={{ lineHeight: 1.2 }}
            >
              {t('teamOpt.timeline.unplaced', {
                defaultValue: '{{count}} not placed',
                count: unplaced,
              })}
            </Typography>
          )}
        </Box>
      </Gutter>
      <Box
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(undefined)
        }}
        sx={(theme) => ({
          position: 'relative',
          height: TRACK_PAD * 2 + rows * CARD_H + (rows - 1) * ROW_GAP,
          transition: `height 220ms ${SPRING}`,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
          backgroundImage: `linear-gradient(90deg, ${alpha(ownerColor(theme, characterKey), 0.07)}, transparent 40%)`,
        })}
      >
        {!placed && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              position: 'absolute',
              left: 8,
              top: 18,
              pointerEvents: 'none',
            }}
          >
            {t('teamOpt.timeline.noAttacks', 'No attacks placed')}
          </Typography>
        )}
        {attacks.map((attack, index) =>
          attack.at ? (
            <AttackCard
              // biome-ignore lint/suspicious/noArrayIndexKey: attacks are kept by position
              key={index}
              member={characterKey}
              index={index}
              attack={attack}
              row={rowOf[index] ?? 0}
              length={length}
              data={data}
              selected={selectedIndex === index}
              stores={stores}
              pips={pips[index] ?? []}
              starts={startsByCard.get(`${characterKey}:${index}`) ?? NONE}
              getDamage={getDamage}
              {...handlers}
            />
          ) : null
        )}
      </Box>
    </>
  )
})

const NONE: string[] = []

type CardProps = {
  member: CharacterKey
  index: number
  attack: TeamOptAttack
  row: number
  length: number
  data: UIData | undefined
  selected: boolean
  stores: Stores
  pips: Pip[]
  /** The timed buffs this attack starts */
  starts: string[]
  getDamage: (member: CharacterKey, index: number) => number | undefined
} & BarHandlers

/**
 * An attack, as a card: chunky, in its member's element, lifted while dragged, bouncing when
 * dropped. The pips on its top edge are the timed buffs its hits get (full, part, none).
 */
const AttackCard = memo(
  function AttackCard({
    member,
    index,
    attack,
    row,
    length,
    data,
    selected,
    stores,
    pips,
    starts,
    getDamage,
    onBarDown,
    onBarMove,
    onBarUp,
    onOpen,
  }: CardProps) {
    const draft = useSyncExternalStore(stores.draft.subscribe, () => {
      const d = stores.draft.get()
      return d && d.member === member && d.index === index ? d : undefined
    })
    const fx = useSyncExternalStore(stores.fx.subscribe, () => {
      const f = stores.fx.get()
      return f && f.member === member && f.index === index ? f : undefined
    })
    // a hovered ribbon: does this card start it, do its hits get it?
    const lit = useSyncExternalStore(stores.hover.subscribe, () => {
      const key = stores.hover.get()
      if (!key) return 'none'
      if (starts.includes(key)) return 'source'
      const pip = pips.find((p) => p.key === key)
      return pip && pip.share > 0 ? 'on' : 'off'
    })
    const at = draft?.at ?? attack.at!
    const dragging = !!draft && !draft.done
    const span = at.end - at.start
    const instant = !(span > 0)
    const long = runsOn(attack)
    const ref = useMemo(() => ({ member, index }), [member, index])
    const delta = fx?.delta
    const time = instant
      ? `${fmt(at.start)} s`
      : `${fmt(at.start)}–${fmt(at.end)} s`
    return (
      <Tooltip
        disableInteractive
        enterDelay={500}
        enterNextDelay={250}
        placement="top-start"
        title={
          dragging ? (
            ''
          ) : (
            <CardDetails
              attack={attack}
              time={time}
              data={data}
              pips={pips}
              damage={getDamage(member, index)}
            />
          )
        }
      >
        <Box
          onPointerDown={(e) => onBarDown(e, ref, 'move')}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarUp}
          onDoubleClick={() => onOpen(ref)}
          sx={(theme) => {
            const color = ownerColor(theme, member)
            const edge = darken(color, 0.55)
            return {
              position: 'absolute',
              top: TRACK_PAD + row * (CARD_H + ROW_GAP),
              height: CARD_H,
              left: `${(at.start / length) * 100}%`,
              width: instant ? '14px' : `max(${(span / length) * 100}%, 14px)`,
              transform: instant ? 'translateX(-7px)' : undefined,
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
              zIndex: dragging ? 5 : selected ? 3 : 2,
              transition: dragging
                ? 'none'
                : `top 220ms ${SPRING}, left 160ms ${SPRING}, width 160ms ${SPRING}`,
              opacity: lit === 'off' ? 0.28 : 1,
              filter: lit === 'off' ? 'saturate(.3)' : undefined,
              '& .card-face': {
                position: 'absolute',
                inset: 0,
                containerType: 'inline-size',
                borderRadius: instant ? '50%' : '10px',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: instant ? 0 : 0.75,
                overflow: 'hidden',
                color: '#fff',
                textShadow: `0 1px 0 ${alpha('#000', 0.55)}`,
                // a glossy, chunky piece: lit top, darker bottom edge, a drop shadow
                background: long
                  ? `repeating-linear-gradient(135deg, ${alpha(color, 0.42)} 0 7px, ${alpha(color, 0.26)} 7px 14px)`
                  : `linear-gradient(180deg, ${lighten(color, 0.22)} 0%, ${color} 48%, ${darken(color, 0.22)} 100%)`,
                border: `2px solid ${edge}`,
                boxShadow: [
                  `inset 0 2px 0 ${alpha('#fff', long ? 0.15 : 0.38)}`,
                  `0 ${dragging ? 10 : 3}px 0 ${alpha(edge, dragging ? 0 : 0.9)}`,
                  `0 ${dragging ? 18 : 6}px ${dragging ? 26 : 12}px ${alpha('#000', dragging ? 0.55 : 0.35)}`,
                  selected ? `0 0 0 2px ${theme.palette.primary.main}` : '',
                  lit === 'on' ? `0 0 16px 3px ${alpha(color, 0.9)}` : '',
                  lit === 'source'
                    ? `0 0 0 3px ${theme.palette.primary.main}, 0 0 18px 4px ${alpha(theme.palette.primary.main, 0.8)}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(', '),
                transform: dragging
                  ? 'translateY(-4px) scale(1.07) rotate(-1.5deg)'
                  : undefined,
                transition: `transform 180ms ${SPRING}, box-shadow 180ms ease`,
                animation:
                  !dragging && fx ? `${pop} 420ms ${SPRING}` : undefined,
              },
              '& .pips': {
                opacity: selected || dragging ? 1 : 0,
                transform:
                  selected || dragging ? 'translateY(0)' : 'translateY(5px)',
                transition: `opacity 140ms, transform 200ms ${SPRING}`,
              },
              '&:hover .pips': { opacity: 1, transform: 'translateY(0)' },
              '&:hover .power': { opacity: 0 },
              '&:hover .card-face': dragging
                ? {}
                : {
                    transform: 'translateY(-2px)',
                  },
            }
          }}
        >
          <Box className="card-face" key={fx?.id}>
            {!instant && (
              <>
                <Box
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    '@container (max-width: 76px)': {
                      '& .MuiTypography-root': { display: 'none' },
                    },
                    '& .MuiTypography-root': {
                      fontSize: 12.5,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      color: '#fff !important',
                    },
                  }}
                >
                  <AttackName data={data} path={attack.path} oneLine />
                </Box>
                <Box
                  component="span"
                  sx={{
                    flexShrink: 0,
                    px: 0.75,
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    lineHeight: '18px',
                    backgroundColor: alpha('#000', 0.35),
                    pointerEvents: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    // (a narrow card shows its talent's icon rather than a cut count)
                    '@container (max-width: 64px)': { display: 'none' },
                  }}
                >
                  ×{fmt(attack.hits)}
                </Box>
              </>
            )}
          </Box>
          {/* the buffs its hits get: on its top edge */}
          {!instant && !!pips.length && (
            <>
              <PowerBadge pips={pips} />
              <Pips pips={pips} />
            </>
          )}
          {!instant && (
            <>
              <EdgeHandle
                side="start"
                onDown={(e) => onBarDown(e, ref, 'start')}
              />
              <EdgeHandle side="end" onDown={(e) => onBarDown(e, ref, 'end')} />
            </>
          )}
          {dragging && <Chip>{time}</Chip>}
          {lit === 'source' && <StartsMark />}
          {!dragging && delta !== undefined && Math.abs(delta) > 0.00005 && (
            <Box
              key={`toast-${fx?.id}`}
              sx={(theme) => ({
                position: 'absolute',
                left: '50%',
                bottom: '100%',
                px: 1,
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 900,
                lineHeight: '22px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 6,
                color: '#fff',
                textShadow: `0 1px 0 ${alpha('#000', 0.5)}`,
                backgroundColor:
                  delta > 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                boxShadow: `0 3px 0 ${darken(delta > 0 ? theme.palette.success.main : theme.palette.error.main, 0.45)}, 0 6px 14px ${alpha('#000', 0.4)}`,
                animation: `${floatUp} 1.8s ease-out forwards`,
              })}
            >
              {pct(delta)}
            </Box>
          )}
        </Box>
      </Tooltip>
    )
  },
  // (a save gives every attack a new object: a card re-renders only if its own changed)
  (a, b) => {
    for (const key of Object.keys(a) as (keyof CardProps)[])
      if (
        key !== 'attack' &&
        key !== 'pips' &&
        key !== 'starts' &&
        a[key] !== b[key]
      )
        return false
    if (a.starts.join() !== b.starts.join()) return false
    return (
      (a.attack === b.attack ||
        JSON.stringify(a.attack) === JSON.stringify(b.attack)) &&
      a.pips.length === b.pips.length &&
      a.pips.every(
        (p, i) => p.key === b.pips[i].key && p.share === b.pips[i].share
      )
    )
  }
)

/** On a card that starts the hovered ribbon's buff */
function StartsMark() {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={(theme) => ({
        position: 'absolute',
        left: '50%',
        bottom: '100%',
        transform: 'translateX(-50%)',
        mb: 0.75,
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        pl: 0.25,
        pr: 0.75,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 6,
        color: theme.palette.primary.contrastText,
        background: `linear-gradient(180deg, ${lighten(theme.palette.primary.main, 0.25)}, ${darken(theme.palette.primary.main, 0.15)})`,
        boxShadow: `0 2px 0 ${darken(theme.palette.primary.main, 0.5)}, 0 4px 10px ${alpha('#000', 0.45)}`,
        '& .MuiSvgIcon-root': { fontSize: 14 },
      })}
    >
      <BoltIcon />
      {t('teamOpt.timeline.startsIt', 'starts it')}
    </Box>
  )
}

/** A label floating over a card */
function Chip({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        position: 'absolute',
        left: 0,
        bottom: '100%',
        mb: 1.25,
        px: 0.75,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 6,
        fontVariantNumeric: 'tabular-nums',
        color: theme.palette.primary.contrastText,
        backgroundColor: theme.palette.primary.main,
        boxShadow: `0 4px 12px ${alpha('#000', 0.4)}`,
      })}
    >
      {children}
    </Box>
  )
}

/** The timed buffs a card's hits get: a coin per buff, full, part-filled or greyed out */
function Pips({ pips }: { pips: Pip[] }) {
  const shown = pips.slice(0, 6)
  return (
    <Box
      className="pips"
      sx={{
        position: 'absolute',
        top: -10,
        left: 8,
        display: 'flex',
        gap: '2px',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {shown.map(({ key, share, icon, owner }) => (
        <Box
          key={key}
          sx={(theme) => {
            const color = ownerColor(theme, owner)
            const deg = Math.round(share * 360)
            return {
              width: 18,
              height: 18,
              borderRadius: '50%',
              p: '2px',
              // the ring fills as much as the share of hits the buff is up for
              background:
                share >= 0.999
                  ? `linear-gradient(180deg, ${lighten(color, 0.35)}, ${darken(color, 0.2)})`
                  : `conic-gradient(${color} ${deg}deg, ${alpha('#000', 0.6)} ${deg}deg)`,
              boxShadow: `0 1px 3px ${alpha('#000', 0.6)}`,
              filter: share <= 0 ? 'grayscale(1) brightness(.6)' : undefined,
              '& > div': {
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                backgroundColor: theme.palette.contentDark.main,
                '& img': { width: '100%', height: '100%', objectFit: 'cover' },
                '& .MuiSvgIcon-root': { fontSize: 12 },
              },
            }
          }}
        >
          <Box>{icon ?? <TimerOutlinedIcon />}</Box>
        </Box>
      ))}
      {pips.length > shown.length && (
        <Box
          sx={(theme) => ({
            height: 18,
            px: 0.5,
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            lineHeight: '18px',
            color: theme.palette.text.secondary,
            backgroundColor: theme.palette.contentDark.main,
          })}
        >
          +{pips.length - shown.length}
        </Box>
      )}
    </Box>
  )
}

/** How many of the timed buffs that reach a card are up on all its hits: green if all are */
function PowerBadge({ pips }: { pips: Pip[] }) {
  const full = pips.filter((p) => p.share >= 0.999).length
  const all = full === pips.length
  const none = pips.every((p) => p.share <= 0)
  return (
    <Box
      className="power"
      sx={(theme) => {
        const color = all
          ? theme.palette.success.main
          : none
            ? theme.palette.error.main
            : theme.palette.warning.main
        return {
          position: 'absolute',
          top: -8,
          right: 6,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          px: 0.5,
          height: 16,
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 900,
          lineHeight: '16px',
          color: '#fff',
          pointerEvents: 'none',
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 1px 0 ${alpha('#000', 0.5)}`,
          background: `linear-gradient(180deg, ${lighten(color, 0.2)}, ${darken(color, 0.2)})`,
          boxShadow: `0 2px 0 ${darken(color, 0.5)}, 0 2px 6px ${alpha('#000', 0.5)}`,
          transition: 'opacity 120ms',
          '& .MuiSvgIcon-root': { fontSize: 11 },
        }
      }}
    >
      <TimerOutlinedIcon />
      {full}/{pips.length}
    </Box>
  )
}

/** A card's edge: drag it to change when the attack starts or ends */
function EdgeHandle({
  side,
  onDown,
}: {
  side: 'start' | 'end'
  onDown: (e: ReactPointerEvent<HTMLElement>) => void
}) {
  return (
    <Box
      onPointerDown={onDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 'start' ? 'left' : 'right']: -4,
        width: 10,
        cursor: 'ew-resize',
        zIndex: 2,
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 9,
          bottom: 9,
          left: 3,
          width: 4,
          borderRadius: 2,
          backgroundColor: alpha('#fff', 0.85),
          boxShadow: `0 0 0 1px ${alpha('#000', 0.4)}`,
          opacity: 0,
          transition: 'opacity 120ms',
        },
        '&:hover::after': { opacity: 1 },
      }}
    />
  )
}

/** A card's tooltip: the attack, its damage, and the share of its hits each timed buff is up for */
function CardDetails({
  attack,
  time,
  data,
  pips,
  damage,
}: {
  attack: TeamOptAttack
  time: string
  data: UIData | undefined
  pips: Pip[]
  damage: number | undefined
}) {
  const { t } = useTranslation('page_team')
  const sorted = [...pips].sort((a, b) => b.share - a.share)
  return (
    <Box sx={{ py: 0.25, minWidth: 220, maxWidth: 320 }}>
      <AttackName data={data} path={attack.path} oneLine />
      <Typography
        variant="caption"
        component="div"
        sx={{ opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}
      >
        {time} ·{' '}
        {t('teamOpt.timeline.hits', {
          defaultValue: '{{count}} hits',
          count: attack.hits,
        })}
        {damage !== undefined && ` · ${formatDamage(damage)}`}
      </Typography>
      {!!sorted.length && (
        <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
          <Typography
            variant="overline"
            sx={{ lineHeight: 1.4, opacity: 0.7, fontSize: 10 }}
          >
            {t('teamOpt.timeline.upFor', 'Buffs that run out, on its hits')}
          </Typography>
          {sorted.map(({ key, share }) => (
            <PipRow key={key} buffKey={key} share={share} />
          ))}
          <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.25 }}>
            {t('teamOpt.timeline.openHint', 'Double-click to open it')}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/** (names come from the ribbons' map, read where the tooltip shows) */
const BuffNameContext = { current: new Map<string, ReactNode>() }
function PipRow({ buffKey, share }: { buffKey: string; share: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 44px 36px',
        alignItems: 'center',
        gap: 0.75,
        fontSize: 12,
        opacity: share > 0 ? 1 : 0.6,
      }}
    >
      <Box
        component="span"
        sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <Loading>{BuffNameContext.current.get(buffKey) ?? buffKey}</Loading>
      </Box>
      <Box
        sx={(theme) => ({
          height: 4,
          borderRadius: 2,
          backgroundColor: alpha(theme.palette.text.primary, 0.15),
          overflow: 'hidden',
        })}
      >
        <Box
          sx={(theme) => ({
            height: '100%',
            width: `${share * 100}%`,
            backgroundColor:
              share > 0.999
                ? theme.palette.success.main
                : theme.palette.warning.main,
          })}
        />
      </Box>
      <Box
        component="span"
        sx={{
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {Math.round(share * 100)}%
      </Box>
    </Box>
  )
}

/** The buffs' ribbons: when each is up, live while a card is dragged */
const BuffLanes = memo(function BuffLanes({
  stores,
  teamOpt,
  buffsByKey,
  length,
  disabled,
  onWindows,
  onShowBuffs,
  onBarDown,
  onBarMove,
  onBarUp,
  onOpenSettings,
}: {
  stores: Stores
  teamOpt: TeamOpt
  buffsByKey: ReadonlyMap<string, TeamBuff>
  length: number
  disabled?: boolean
  onWindows: (key: string, intervals: Interval[]) => void
  onShowBuffs: () => void
  onOpenSettings: (key: string, anchor: HTMLElement) => void
} & Omit<BarHandlers, 'onOpen'>) {
  const { t } = useTranslation('page_team')
  const triggerNames = useTriggerNames()
  const draft = useSyncExternalStore(stores.draft.subscribe, stores.draft.get)
  const windows = useMemo(() => {
    const attacks = withDraft(teamOpt.attacks, draft)
    return timelineWindows({
      ...teamOpt,
      attacks,
      timeline: { buffs: [], ...teamOpt.timeline, on: true },
    })
      .filter(({ ref }) => buffsByKey.has(buffRefKey(ref)))
      .map((w) => ({
        ...w,
        // the attack that starts each window: dragging the ribbon moves it
        sources: w.intervals.map(([a]) => activationSource(w.buff, attacks, a)),
        // the moments it is started (or refreshed)
        sparks: acceptedActivations(w.buff, attacks, teamOpt.timeline?.casts),
      }))
  }, [teamOpt, draft, buffsByKey])
  // (the cards' tooltips name buffs by these)
  for (const { ref } of windows) {
    const key = buffRefKey(ref)
    BuffNameContext.current.set(
      key,
      buffNames(buffsByKey.get(key), ref.path).title
    )
  }
  return (
    <>
      <Gutter divider>
        <TimerOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography
          variant="overline"
          color="text.secondary"
          noWrap
          sx={{ lineHeight: 2.6, fontWeight: 700 }}
        >
          {t('teamOpt.timeline.buffsUp', 'Buffs that run out')}
        </Typography>
      </Gutter>
      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          alignItems: 'center',
          px: 1,
        })}
      >
        {!windows.length ? (
          <Button
            size="small"
            color="inherit"
            onClick={onShowBuffs}
            sx={{ color: 'text.secondary' }}
          >
            {t(
              'teamOpt.timeline.noTimed',
              'None yet: choose the buffs that run out'
            )}
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t(
              'teamOpt.timeline.ribbonHint',
              'Hover a ribbon: the hits it powers light up'
            )}
          </Typography>
        )}
      </Box>
      {windows.map(({ buff, ref, intervals, sources, sparks }) => {
        const key = buffRefKey(ref)
        const info = buffsByKey.get(key)
        const manual = buff.trigger === 'manual'
        const { title, condition } = buffNames(info, ref.path)
        return (
          <BuffLane
            key={key}
            buffKey={key}
            title={title}
            condition={condition}
            icon={info?.icon}
            owner={buff.owner}
            detail={
              manual
                ? t('teamOpt.timeline.drawn', 'drawn by hand')
                : buff.startedBy
                  ? [
                      `${fmt(buff.duration)} s`,
                      t('teamOpt.timeline.chosenStarts', {
                        defaultValue: '{{count}} chosen attacks',
                        count: buff.startedBy.length,
                      }),
                    ].join(' · ')
                  : [
                      `${fmt(buff.duration)} s`,
                      triggerNames[buff.trigger],
                      buff.cooldown
                        ? t('teamOpt.timeline.cd', {
                            defaultValue: 'CD {{cooldown}} s',
                            cooldown: fmt(buff.cooldown),
                          })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
            }
            intervals={intervals}
            length={length}
            editable={manual && !disabled}
            duration={buff.duration}
            hover={stores.hover}
            onWindows={onWindows}
            sources={sources}
            sparks={sparks}
            onOpenSettings={onOpenSettings}
            onSourceDown={onBarDown}
            onSourceMove={onBarMove}
            onSourceUp={onBarUp}
          />
        )
      })}
    </>
  )
})

const sameIntervals = (a: readonly Interval[], b: readonly Interval[]) =>
  a.length === b.length &&
  a.every(([x, y], i) => x === b[i][0] && y === b[i][1])

type LaneOp = {
  mode: 'create' | 'move' | 'start' | 'end'
  /** The window moved or resized */
  i: number
  x0: number
  /** Time at the pointer when it went down */
  t0: number
  left: number
  pxPerSec: number
  base: Interval[]
  moved: boolean
  next?: Interval[]
}

type BuffLaneProps = {
  buffKey: string
  title: ReactNode
  condition: ReactNode
  icon: ReactNode
  owner: CharacterKey | 'team'
  detail: string
  intervals: readonly Interval[]
  length: number
  editable: boolean
  duration: number
  hover: Store<string | undefined>
  onWindows: (key: string, intervals: Interval[]) => void
  /** Per window, the attack that starts it */
  sources: (Ref | undefined)[]
  /** When it is started or refreshed */
  sparks: number[]
  onOpenSettings: (key: string, anchor: HTMLElement) => void
  onSourceDown: BarHandlers['onBarDown']
  onSourceMove: BarHandlers['onBarMove']
  onSourceUp: BarHandlers['onBarUp']
}

/**
 * When a buff is up, as a glowing ribbon. Hover it: the cards whose hits it powers light up.
 * Drawn by hand: click or drag on the lane to add a window, drag a window (or its edges) to
 * change it, double-click one to remove it.
 */
const BuffLane = memo(
  function BuffLane({
    buffKey,
    title,
    condition,
    icon,
    owner,
    detail,
    intervals,
    length,
    editable,
    duration,
    hover,
    onWindows,
    sources,
    sparks,
    onOpenSettings,
    onSourceDown,
    onSourceMove,
    onSourceUp,
  }: BuffLaneProps) {
    const { t } = useTranslation('page_team')
    const [draft, setDraft] = useState<Interval[]>()
    const lane = useRef<HTMLDivElement>(null)
    const op = useRef<LaneOp>()
    const frame = useRef(0)
    const shown = draft ?? intervals
    const hovered = useSyncExternalStore(
      hover.subscribe,
      () => hover.get() === buffKey
    )
    const enter = () => hover.set(buffKey)
    const leave = () => {
      if (hover.get() === buffKey) hover.set(undefined)
    }

    const timeAt = (clientX: number, o: Pick<LaneOp, 'left' | 'pxPerSec'>) =>
      (clientX - o.left) / o.pxPerSec
    const begin = (
      e: ReactPointerEvent<HTMLElement>,
      mode: LaneOp['mode'],
      i: number
    ) => {
      if (!editable || e.button !== 0 || !lane.current) return
      e.preventDefault()
      e.stopPropagation()
      const rect = lane.current.getBoundingClientRect()
      lane.current.setPointerCapture(e.pointerId)
      const geometry = { left: rect.left, pxPerSec: rect.width / length }
      op.current = {
        mode,
        i,
        x0: e.clientX,
        t0: clamp(snapTo(timeAt(e.clientX, geometry), e.altKey), 0, length),
        ...geometry,
        base: [...shown],
        moved: false,
      }
    }
    const move = (e: ReactPointerEvent) => {
      const o = op.current
      if (!o) return
      if (!o.moved && Math.abs(e.clientX - o.x0) < 3) return
      o.moved = true
      const free = e.altKey
      let next: Interval[]
      if (o.mode === 'create') {
        const t1 = clamp(snapTo(timeAt(e.clientX, o), free), 0, length)
        next = mergeIntervals([
          ...o.base,
          [Math.min(o.t0, t1), Math.max(o.t0, t1)],
        ])
      } else {
        const [a, b] = o.base[o.i]
        const dt = (e.clientX - o.x0) / o.pxPerSec
        let w: Interval
        if (o.mode === 'move') {
          const start = clamp(snapTo(a + dt, free), 0, length - (b - a))
          w = [start, start + (b - a)]
        } else if (o.mode === 'start')
          w = [clamp(snapTo(a + dt, free), 0, b), b]
        else w = [a, clamp(snapTo(b + dt, free), a, length)]
        next = mergeIntervals(o.base.map((x, j) => (j === o.i ? w : x)))
      }
      o.next = next
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => setDraft(next))
    }
    const end = () => {
      const o = op.current
      op.current = undefined
      cancelAnimationFrame(frame.current)
      if (!o) return
      let next = o.next
      // a click: a window of its usual length from there
      if (!o.moved && o.mode === 'create')
        next = mergeIntervals([
          ...o.base,
          [o.t0, Math.min(length, o.t0 + duration)],
        ])
      if (next && !sameIntervals(next, intervals)) onWindows(buffKey, next)
      setDraft(undefined)
    }
    const remove = (e: ReactMouseEvent) => {
      if (!editable || !lane.current) return
      const rect = lane.current.getBoundingClientRect()
      const time = timeAt(e.clientX, {
        left: rect.left,
        pxPerSec: rect.width / length,
      })
      const i = shown.findIndex(([a, b]) => time >= a && time <= b)
      if (i >= 0)
        onWindows(
          buffKey,
          shown.filter((_, j) => j !== i)
        )
    }

    return (
      <>
        <Gutter>
          <Box
            component="button"
            type="button"
            onPointerEnter={enter}
            onPointerLeave={leave}
            onClick={(e) => onOpenSettings(buffKey, e.currentTarget)}
            aria-label={t(
              'teamOpt.timeline.settingsLabel',
              'What starts it, how long it lasts'
            )}
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minWidth: 0,
              width: 'calc(100% + 8px)',
              m: 0,
              p: 0.5,
              mx: -0.5,
              border: 0,
              borderRadius: 1.5,
              background: 'none',
              color: 'inherit',
              font: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              '& .tune': { opacity: 0.35, transition: 'opacity 120ms' },
              '&:hover': {
                backgroundColor: alpha(theme.palette.text.primary, 0.06),
              },
              '&:hover .tune': { opacity: 1 },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
              },
            })}
          >
            <BuffIcon icon={icon} owner={owner} size={24} />
            <Tooltip
              placement="top-start"
              disableInteractive
              title={
                condition ? (
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>
                      <Loading>{title}</Loading>
                    </Box>
                    <Box>
                      <Loading width={160}>{condition}</Loading>
                    </Box>
                  </Box>
                ) : (
                  ''
                )
              }
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  noWrap
                  component="div"
                  sx={{ lineHeight: 1.25, fontWeight: 800 }}
                >
                  <Loading width={110}>{title}</Loading>
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  component="div"
                  sx={{ fontSize: 10.5, lineHeight: 1.2 }}
                >
                  {detail}
                </Typography>
              </Box>
            </Tooltip>
            <TuneIcon
              className="tune"
              sx={{ ml: 'auto', fontSize: 16, flexShrink: 0 }}
            />
          </Box>
        </Gutter>
        <Box
          ref={lane}
          onPointerDown={(e) => begin(e, 'create', -1)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onDoubleClick={remove}
          sx={(theme) => ({
            position: 'relative',
            height: LANE_H,
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
            cursor: editable ? 'crosshair' : 'default',
            touchAction: editable ? 'none' : undefined,
            backgroundColor: hovered
              ? alpha(ownerColor(theme, owner), 0.08)
              : undefined,
            transition: 'background-color 160ms',
          })}
        >
          {!shown.length && (
            // never up: it counts on no hit at all (unlike in List), say so
            <Typography
              variant="caption"
              color="warning.main"
              sx={{
                position: 'absolute',
                left: 8,
                top: 9,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {editable
                ? t(
                    'teamOpt.timeline.drawHint',
                    'Never up yet: click or drag here to add when it is up'
                  )
                : t(
                    'teamOpt.timeline.neverUp',
                    'Never up: nothing in the rotation starts it, so it counts on no hit'
                  )}
            </Typography>
          )}
          {sparks.map((time, i) => (
            <Box
              // biome-ignore lint/suspicious/noArrayIndexKey: in time order
              key={`s${i}`}
              aria-hidden
              sx={(theme) => ({
                position: 'absolute',
                top: 1,
                left: `${(time / length) * 100}%`,
                width: 7,
                height: 7,
                transform: 'translateX(-50%) rotate(45deg)',
                borderRadius: '1px',
                zIndex: 2,
                pointerEvents: 'none',
                backgroundColor: theme.palette.primary.main,
                boxShadow: `0 0 6px ${alpha(theme.palette.primary.main, 0.9)}`,
              })}
            />
          ))}
          {shown.map(([a, b], i) => (
            <Box
              // biome-ignore lint/suspicious/noArrayIndexKey: windows are kept in order
              key={i}
              onPointerDown={(e) => {
                const source = sources[i]
                // a ribbon that follows an attack: moving it moves that attack
                if (!editable && source) onSourceDown(e, source, 'move')
                else begin(e, 'move', i)
              }}
              onPointerMove={editable ? undefined : onSourceMove}
              onPointerUp={editable ? undefined : onSourceUp}
              onPointerCancel={editable ? undefined : onSourceUp}
              title={
                !editable && sources[i]
                  ? t(
                      'teamOpt.timeline.dragSource',
                      'Starts with an attack: drag the ribbon to move that attack'
                    )
                  : undefined
              }
              sx={(theme) => {
                const color = ownerColor(theme, owner)
                return {
                  position: 'absolute',
                  top: 6,
                  height: LANE_H - 12,
                  left: `${(a / length) * 100}%`,
                  width: `${((b - a) / length) * 100}%`,
                  borderRadius: 999,
                  background: `linear-gradient(180deg, ${alpha(lighten(color, 0.25), hovered ? 0.85 : 0.55)}, ${alpha(color, hovered ? 0.7 : 0.4)})`,
                  border: `1px solid ${alpha(color, 0.9)}`,
                  boxShadow: hovered
                    ? `0 0 14px 2px ${alpha(color, 0.75)}, inset 0 1px 0 ${alpha('#fff', 0.45)}`
                    : `inset 0 1px 0 ${alpha('#fff', 0.3)}`,
                  cursor: editable || sources[i] ? 'grab' : 'default',
                  touchAction: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pl: '3px',
                  overflow: 'hidden',
                  transition: `box-shadow 160ms, background 160ms, left 120ms ${SPRING}, width 120ms ${SPRING}`,
                }
              }}
            >
              <BuffIcon icon={icon} owner={owner} size={16} />
              <Typography
                component="span"
                sx={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  color: '#fff',
                  textShadow: `0 1px 0 ${alpha('#000', 0.5)}`,
                  pointerEvents: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmt(b - a)} s
              </Typography>
              {editable && (
                <>
                  <LaneEdge side="start" onDown={(e) => begin(e, 'start', i)} />
                  <LaneEdge side="end" onDown={(e) => begin(e, 'end', i)} />
                </>
              )}
            </Box>
          ))}
        </Box>
      </>
    )
  },
  (a, b) => {
    for (const key of Object.keys(a) as (keyof BuffLaneProps)[])
      if (
        key !== 'intervals' &&
        key !== 'sources' &&
        key !== 'sparks' &&
        a[key] !== b[key]
      )
        return false
    return (
      sameIntervals(a.intervals, b.intervals) &&
      a.sparks.join() === b.sparks.join() &&
      JSON.stringify(a.sources) === JSON.stringify(b.sources)
    )
  }
)

/** A buff's icon in a round frame (its set, weapon or talent; the team's: a group) */
function BuffIcon({
  icon,
  owner,
  size,
}: {
  icon: ReactNode
  owner: CharacterKey | 'team'
  size: number
}) {
  return (
    <Box
      sx={(theme) => ({
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        backgroundColor: theme.palette.contentDark.main,
        boxShadow: `0 0 0 1px ${alpha(ownerColor(theme, owner), 0.8)}`,
        '& img': { width: '100%', height: '100%', objectFit: 'cover' },
        '& .MuiSvgIcon-root': { fontSize: size * 0.7 },
      })}
    >
      {icon ?? (owner === 'team' ? <GroupsIcon /> : <TimerOutlinedIcon />)}
    </Box>
  )
}

function LaneEdge({
  side,
  onDown,
}: {
  side: 'start' | 'end'
  onDown: (e: ReactPointerEvent<HTMLElement>) => void
}) {
  return (
    <Box
      onPointerDown={onDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 'start' ? 'left' : 'right']: 0,
        width: 7,
        cursor: 'ew-resize',
      }}
    />
  )
}
