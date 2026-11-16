import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allCharacterKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type {
  ParsedRotation,
  SimBuffOwner,
  SimHit,
  SimulationResult,
  TeamData,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  CharacterName,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TeamBuff } from './buffs'
import { describe } from './buffs'
import { formatDamage } from './format'
import { MemberAvatar } from './MemberAvatar'
import {
  actionName,
  flatActions,
  openerActions,
  seconds,
} from './RotationTiming'
import type { AuraKey, TimelineTrack } from './timelineModel'
import {
  auraLanes,
  aurasAt,
  damagingHits,
  onFieldAt,
  timelineTracks,
  trackValueAt,
} from './timelineModel'
import { focusSx, numSx, quickSx, tokens } from './ui'

const FPS = 60
/** Ruler steps, seconds: the first giving at most ten marks */
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60]
/** Pixels per second at the narrowest (the strip scrolls sideways beyond it) */
const MIN_PX_PER_SECOND = 22
/** The chart's measures: compact in the writer, roomy in the detailed window */
interface Sizes {
  lane: number
  track: number
  names: number
  /** A lane's name, and a row's label and value (px) */
  name: number
  label: number
}
const COMPACT: Sizes = {
  lane: 36,
  track: 20,
  names: 156,
  name: 13,
  label: 11.5,
}
const ROOMY: Sizes = {
  lane: 46,
  track: 26,
  names: 300,
  name: 14.5,
  label: 12.5,
}
/** The detailed window on a short screen (a phone in landscape): the chart over the room it has */
const SHORT: Sizes = {
  lane: 34,
  track: 18,
  names: 150,
  name: 12.5,
  label: 11,
}
/** A screen too short for the roomy measures (a phone in landscape) */
export const SHORT_SCREEN = '(max-height: 520px)'
const SizeContext = createContext<Sizes>(COMPACT)

type SimAction = SimulationResult['actions'][number]

/** A member's lane colour: its element's, from the theme */
export const laneColor = (theme: Theme, characterKey: CharacterKey) => {
  const ele = getCharEle(characterKey)
  const palette = (
    theme.palette as unknown as Record<string, { main: string }>
  )[ele]
  return palette?.main ?? theme.palette.primary.main
}

const AURA_ELEMENT: Record<AuraKey, string> = {
  pyro: 'pyro',
  hydro: 'hydro',
  electro: 'electro',
  cryo: 'cryo',
  dendro: 'dendro',
  quicken: 'dendro',
  frozen: 'cryo',
  burning: 'pyro',
}
const AURA_NAME: Record<AuraKey, string> = {
  pyro: 'Pyro',
  hydro: 'Hydro',
  electro: 'Electro',
  cryo: 'Cryo',
  dendro: 'Dendro',
  quicken: 'Quicken',
  frozen: 'Frozen',
  burning: 'Burning',
}
const auraColor = (theme: Theme, aura: AuraKey) => {
  const palette = theme.palette as unknown as Record<string, { main: string }>
  return (palette[aura] ?? palette[AURA_ELEMENT[aura]])?.main ?? '#999'
}

/* ---------- the moment under the pointer ---------- */

/** The moment pointed at: its frame, and the member whose lane the pointer is on */
interface Moment {
  frame: number
  lane?: CharacterKey
}
/** Holds the pointed moment outside React: only what shows it re-renders as the pointer moves */
function createMomentStore() {
  let moment: Moment | undefined
  const subscribers = new Set<() => void>()
  return {
    get: () => moment,
    set(next: Moment | undefined) {
      if (next?.frame === moment?.frame && next?.lane === moment?.lane) return
      moment = next
      for (const s of subscribers) s()
    },
    subscribe(callback: () => void) {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
      }
    },
  }
}
type MomentStore = ReturnType<typeof createMomentStore>
const useMoment = (store: MomentStore) =>
  useSyncExternalStore(store.subscribe, store.get)

/** A moment as the simulation has it: who is on the field, each timed buff's state or that it is off */
export interface TimelineMoment {
  frame: number
  onField: CharacterKey | undefined
  states: { owner: SimBuffOwner; path: string[]; value: string }[]
  excluded: { owner: SimBuffOwner; path: string[] }[]
}

/** What is pinned: a moment, and the hit picked there (if one is near) */
export interface TimelinePin {
  frame: number
  hit?: SimHit
}

/**
 * The rotation as it plays: one lane per member, each action a block as long as its frames (in the
 * member's element colour), each swap a neutral block on the incoming member's lane, every hit a
 * mark under it (as tall as its damage, when there are figures), on a seconds ruler. Pointing at
 * a moment reads it out (who is on the field, the enemy's auras, stacks, the hit there); a click
 * pins it. The detailed view adds the enemy's auras, every resource, stack and buff the
 * simulation follows, and the damage as it adds up. A block opens its step's timing.
 */
export function RotationTimeline({
  members,
  rotation,
  sim,
  edited,
  selected,
  onSelect,
  teamData,
  buffs,
  damage,
  renderHit,
  stats,
  onMoment,
  detail = false,
  onOpenDetail,
}: {
  /**
   * The detailed view (its own large window): the enemy's auras, every stack, resource and timed
   * buff, the damage as it adds up, and beside the chart every member at the moment shown
   */
  detail?: boolean
  /** Opens the detailed view (the simple one's button) */
  onOpenDetail?: () => void
  members: CharacterKey[]
  rotation: ParsedRotation
  sim: SimulationResult
  /** The steps with a timing edit (their action positions) */
  edited: ReadonlySet<number>
  selected?: number
  onSelect: (index: number) => void
  /** The team's data: the names of what the tracks follow */
  teamData?: TeamData
  /**
   * The team's buffs that are on (the members' own settings): the weapon and artifact set effects
   * among them that the simulation does not time are listed as on for the whole rotation
   */
  buffs?: TeamBuff[]
  /** A hit's damage (absent: no figures are shown) */
  damage?: (hit: SimHit) => number | undefined
  /** More about a pinned hit (its stats, its attack), under what is up at that moment */
  renderHit?: (hit: SimHit) => ReactNode
  /** The members' stats at the moment last given to `onMoment` (absent: none are shown) */
  stats?: Partial<Record<CharacterKey, MomentStat[]>>
  /** The moment the panel shows, with the buff states up and off then (undefined: none) */
  onMoment?: (moment: TimelineMoment | undefined) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const short = useMediaQuery(SHORT_SCREEN)
  const size = detail ? (short ? SHORT : ROOMY) : COMPACT
  const nameColumn = size.names
  const start = sim.start
  const length = Math.max(1, sim.frames)
  const flat = useMemo(() => flatActions(rotation), [rotation])
  const opener = useMemo(() => openerActions(rotation), [rotation])
  const totalSeconds = length / FPS
  const step =
    RULER_STEPS.find((s) => totalSeconds / s <= 10) ??
    RULER_STEPS[RULER_STEPS.length - 1]
  const marks = Array.from(
    { length: Math.floor(totalSeconds / step) + 1 },
    (_, i) => i * step
  )
  const pct = (frame: number) =>
    `${Math.min(100, Math.max(0, ((frame - start) / length) * 100))}%`
  const span = (from: number, to: number) =>
    `max(2px, ${((Math.min(to, start + length) - Math.max(from, start)) / length) * 100}%)`
  const blocks = useMemo(() => {
    const byMember = new Map<CharacterKey, (SimAction & { wait?: boolean })[]>()
    for (const a of sim.actions)
      byMember.set(a.characterKey, [...(byMember.get(a.characterKey) ?? []), a])
    for (const w of sim.waits ?? [])
      byMember.set(w.characterKey, [
        ...(byMember.get(w.characterKey) ?? []),
        { ...w, wait: true },
      ])
    return byMember
  }, [sim])
  const swaps = useMemo(() => {
    const byMember = new Map<
      CharacterKey,
      NonNullable<SimulationResult['swaps']>
    >()
    for (const w of sim.swaps ?? [])
      byMember.set(w.to, [...(byMember.get(w.to) ?? []), w])
    return byMember
  }, [sim])
  // the hits, with their damage: per member one mark a frame (its hits there added up)
  const hits = useMemo(() => damagingHits(sim), [sim])
  const { byMember, top, total, cumulative } = useMemo(() => {
    const byMember = new Map<CharacterKey, Map<number, number>>()
    let top = 0
    let total = 0
    const cumulative: { t: number; total: number }[] = []
    for (const h of hits) {
      const d = damage?.(h) ?? 0
      const frames = byMember.get(h.characterKey) ?? new Map<number, number>()
      const sum = (frames.get(h.t) ?? 0) + d
      frames.set(h.t, sum)
      byMember.set(h.characterKey, frames)
      top = Math.max(top, sum)
      total += d
      cumulative.push({ t: h.t, total })
    }
    return { byMember, top, total, cumulative }
  }, [hits, damage])
  const figures = !!damage && total > 0
  const tracks = useMemo(() => {
    const timed = timelineTracks(sim)
    const known = new Set(timed.map((x) => x.key))
    // weapon and set effects that are simply on (not timed by the simulation): the whole rotation
    const constant = (buffs ?? []).flatMap((b): TimelineTrack[] => {
      const key = `${b.ref.owner}|${b.ref.path.join('.')}`
      if (
        b.inactive ||
        !b.value ||
        b.ref.owner === 'team' ||
        known.has(key) ||
        (allCharacterKeys as readonly string[]).includes(b.ref.path[0])
      )
        return []
      return [
        {
          key,
          owner: b.ref.owner,
          path: [...b.ref.path],
          kind: 'ribbon',
          group: 'gear',
          constant: true,
          max: 1,
          segments: [
            { start: sim.start, end: sim.start + sim.frames, value: b.value },
          ],
        },
      ]
    })
    // (a buff that is up from the first frame to the last is on all rotation, like those)
    for (const track of timed) {
      const [only] = track.segments
      if (
        track.kind === 'ribbon' &&
        track.segments.length === 1 &&
        only.start <= sim.start + 2 &&
        only.end >= sim.start + sim.frames - 2
      )
        track.constant = true
    }
    // (what the sheets do not list is the simulation's own bookkeeping: not shown)
    return [...timed, ...constant].filter(
      (track) => !trackInfo(track, teamData).internal
    )
  }, [sim, buffs, teamData])
  const auras = useMemo(() => auraLanes(sim), [sim])
  const teamTracks = tracks.filter((x) => x.group === 'team')
  const memberTracks = (characterKey: CharacterKey) =>
    tracks
      .filter((x) => x.owner === characterKey)
      .sort((a, b) => Number(a.group === 'gear') - Number(b.group === 'gear'))

  // ---- the pointed and the pinned moment ----
  const store = useMemo(createMomentStore, [])
  const plotRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<TimelinePin>()
  // (another rotation: its moments are others)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the simulation changes
  useEffect(() => {
    setPin(undefined)
    store.set(undefined)
  }, [sim, store])
  /** The hit at a moment: the nearest within a few pixels, on the pointed member's lane first */
  const hitAt = useCallback(
    (moment: Moment) => {
      const width = plotRef.current?.getBoundingClientRect().width ?? 800
      const reach = Math.max(2, (5 / width) * length)
      let found: SimHit | undefined
      let best = Number.POSITIVE_INFINITY
      for (const h of hits) {
        const away = Math.abs(h.t - moment.frame)
        if (away > reach) continue
        // (another member's hit counts as further away than any on the lane)
        const score =
          away +
          (moment.lane && h.characterKey !== moment.lane ? reach : 0) -
          (damage?.(h) ?? 0) * 1e-12
        if (score < best) {
          best = score
          found = h
        }
      }
      return found
    },
    [hits, length, damage]
  )
  const momentOf = (e: { clientX: number; target: EventTarget }) => {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect?.width) return undefined
    const x = (e.clientX - rect.left) / rect.width
    if (x < 0 || x > 1) return undefined
    const lane = (e.target as HTMLElement).closest?.(
      '[data-lane]'
    ) as HTMLElement | null
    return {
      frame: Math.round(start + x * length),
      lane: (lane?.dataset['lane'] as CharacterKey | undefined) || undefined,
    }
  }
  const raf = useRef(0)
  const onPointerMove = (e: React.PointerEvent) => {
    const moment = momentOf(e)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      store.set(moment)
      const line = lineRef.current
      if (!line) return
      line.style.opacity = moment ? '1' : '0'
      if (moment) line.style.left = pct(moment.frame)
    })
  }
  const onPointerLeave = () => {
    cancelAnimationFrame(raf.current)
    store.set(undefined)
    if (lineRef.current) lineRef.current.style.opacity = '0'
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const pinAt = (moment: Moment | undefined) => {
    if (!moment) return
    const hit = hitAt(moment)
    setPin({ frame: hit?.t ?? moment.frame, hit })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && pin) return setPin(undefined)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = pin?.frame ?? start
    // (from hit to hit; with Shift, a tenth of a second)
    const next = e.shiftKey
      ? from + (e.key === 'ArrowRight' ? 6 : -6)
      : e.key === 'ArrowRight'
        ? (hits.find((h) => h.t > from)?.t ?? from)
        : ([...hits].reverse().find((h) => h.t < from)?.t ?? from)
    const frame = Math.min(start + length, Math.max(start, next))
    setPin({ frame, hit: hits.find((h) => h.t === frame) })
  }
  // The moment the panel shows: the pinned one; in the detailed view otherwise the one pointed
  // at, once the pointer rests (and it stays when the pointer leaves)
  const [rested, setRested] = useState<TimelinePin>()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = store.subscribe(() => {
      clearTimeout(timer)
      const moment = store.get()
      if (!moment) return
      timer = setTimeout(() => {
        const hit = hitAt(moment)
        setRested({ frame: hit?.t ?? moment.frame, hit })
      }, 90)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [store, hitAt])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the simulation changes
  useEffect(() => setRested(undefined), [sim])
  const shown = pin ?? (detail ? (rested ?? { frame: start }) : undefined)
  // what is up then, for whoever works out the members' stats at that moment
  const shownFrame = shown?.frame
  useEffect(() => {
    if (!onMoment) return
    if (shownFrame === undefined) return onMoment(undefined)
    const timed = tracks.filter((x) => !x.constant)
    onMoment({
      frame: shownFrame,
      onField: onFieldAt(sim, shownFrame),
      states: timed.flatMap((x) => {
        const value = trackValueAt(x, shownFrame)
        return value ? [{ owner: x.owner, path: x.path, value }] : []
      }),
      excluded: timed
        .filter((x) => !trackValueAt(x, shownFrame))
        .map((x) => ({ owner: x.owner, path: x.path })),
    })
  }, [onMoment, shownFrame, tracks, sim])

  return (
    <SizeContext.Provider value={size}>
      <Box
        sx={{
          display: 'grid',
          gap: detail ? 2 : 1,
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            gridColumn: '1 / -1',
          }}
        >
          {onOpenDetail && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.timeline.detailedTip',
                'The enemy’s auras, every stack, resource and buff over time, each member’s stats at any moment, and the damage as it adds up.'
              )}
            >
              <ButtonBase
                onClick={onOpenDetail}
                sx={{
                  gap: 0.625,
                  px: 1.25,
                  minHeight: 30,
                  flexShrink: 0,
                  borderRadius: tokens.radius.control,
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: `1px solid ${tokens.hairlineStrong}`,
                  ...quickSx,
                  ...focusSx,
                  '&:hover': { bgcolor: tokens.hover },
                }}
              >
                <OpenInFullIcon sx={{ fontSize: 14 }} />
                {t('teamOpt.timeline.openDetail', 'Detailed timeline')}
              </ButtonBase>
            </Tooltip>
          )}
          <Readout
            store={store}
            pin={pin}
            sim={sim}
            tracks={teamTracks}
            teamData={teamData}
            hitAt={hitAt}
            damage={figures ? damage : undefined}
            cumulative={cumulative}
            total={total}
            onUnpin={() => setPin(undefined)}
          />
        </Box>
        <Box
          sx={(theme) => ({
            borderRadius: detail ? 3 : 2,
            border: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.contentDark.main,
            overflowX: 'auto',
            overflowY: 'hidden',
          })}
        >
          <Box
            role="application"
            tabIndex={0}
            aria-label={t('teamOpt.timeline.label', 'Rotation timeline')}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onClick={(e) => {
              // (a block opens its step: not a pin)
              if ((e.target as HTMLElement).closest('button')) return
              pinAt(momentOf(e))
            }}
            onKeyDown={onKeyDown}
            sx={{
              '--timeline-names': `${nameColumn}px`,
              minWidth: nameColumn + totalSeconds * MIN_PX_PER_SECOND,
              position: 'relative',
              pb: 0.75,
              cursor: 'crosshair',
              outline: 'none',
              '&:focus-visible': {
                boxShadow: `inset 0 0 0 2px ${alpha(tokens.gold, 0.6)}`,
              },
            }}
          >
            {/* the ruler */}
            <Box sx={{ display: 'flex', height: 26, alignItems: 'flex-end' }}>
              <Box sx={laneLabelSx} />
              <Box
                sx={{ position: 'relative', flex: 1, height: '100%', mr: 1.5 }}
              >
                {marks.map((s) => (
                  <Typography
                    key={s}
                    component="span"
                    sx={{
                      position: 'absolute',
                      left: pct(start + s * FPS),
                      bottom: 4,
                      transform: s ? 'translateX(-50%)' : 'none',
                      fontSize: 11,
                      color: 'text.secondary',
                      whiteSpace: 'nowrap',
                      ...numSx,
                    }}
                  >
                    {s}s
                  </Typography>
                ))}
              </Box>
            </Box>
            {/* the enemy's auras, and the team's own stacks (the Polestar Field…) */}
            {detail && !!auras.length && (
              <Row
                label={t('teamOpt.timeline.enemy', 'Enemy aura')}
                height={auras.length * 7 + 10}
                value={<AuraValue store={store} pin={pin} sim={sim} />}
              >
                {auras.map(({ aura, segments }, i) =>
                  segments.map((seg) => (
                    <Box
                      key={`${aura}${seg.start}`}
                      sx={(theme) => ({
                        position: 'absolute',
                        top: 6 + i * 7,
                        height: 5,
                        left: pct(seg.start),
                        width: span(seg.start, seg.end),
                        borderRadius: 999,
                        bgcolor: alpha(auraColor(theme, aura), 0.85),
                      })}
                    />
                  ))
                )}
              </Row>
            )}
            {detail && (
              <TrackGroup
                tracks={teamTracks}
                color={tokens.gold}
                teamData={teamData}
                store={store}
                pin={pin}
                pct={pct}
                span={span}
              />
            )}
            {members.map((characterKey) => (
              <Box key={characterKey} data-lane={characterKey}>
                <Box
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'stretch',
                    height: size.lane,
                    borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.06)}`,
                  })}
                >
                  <Box sx={laneLabelSx}>
                    <MemberAvatar
                      characterKey={characterKey}
                      size={detail ? 28 : 22}
                    />
                    <Typography
                      noWrap
                      sx={{ fontSize: size.name, fontWeight: 600, minWidth: 0 }}
                    >
                      <CharacterName
                        characterKey={characterKey}
                        gender={gender}
                      />
                    </Typography>
                  </Box>
                  <Box sx={{ position: 'relative', flex: 1, mr: 1.5 }}>
                    {/* the second marks, faint */}
                    {marks.map((s) => (
                      <Box
                        key={s}
                        sx={(theme) => ({
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: pct(start + s * FPS),
                          width: '1px',
                          bgcolor: alpha(theme.palette.text.primary, 0.05),
                        })}
                      />
                    ))}
                    {(swaps.get(characterKey) ?? []).map((w) => (
                      <Tooltip
                        key={`swap-${w.start}`}
                        arrow
                        disableInteractive
                        title={
                          <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            <Box sx={{ fontWeight: 700 }}>
                              {t('teamOpt.timing.swap', 'Swap')}:{' '}
                              <CharacterName
                                characterKey={w.from}
                                gender={gender}
                              />{' '}
                              →{' '}
                              <CharacterName
                                characterKey={w.to}
                                gender={gender}
                              />
                            </Box>
                            {seconds(w.start - start)}–
                            {seconds(w.start - start + w.frames)} s · {w.frames}{' '}
                            {t('teamOpt.timing.framesShort', 'f')}
                            {w.cooldown > 0 && (
                              <Box sx={{ color: 'text.secondary' }}>
                                {t('teamOpt.timing.swapCooldown', {
                                  defaultValue:
                                    'Waited {{seconds}} s for the swap cooldown',
                                  seconds: seconds(w.cooldown),
                                })}
                              </Box>
                            )}
                          </Box>
                        }
                      >
                        <Box
                          aria-label={`${t('teamOpt.timing.swap', 'Swap')} ${seconds(w.start - start)} s`}
                          sx={(theme) => ({
                            position: 'absolute',
                            top: 6,
                            height: size.lane - 16,
                            // (the wait for the swap cooldown, hatched, then the swap itself)
                            left: pct(w.start - w.cooldown),
                            width: `max(4px, calc(${pct(start + w.cooldown + w.frames)} - 1px))`,
                            display: 'flex',
                            justifyContent: 'flex-end',
                            overflow: 'hidden',
                            borderRadius: 1,
                            color: 'text.secondary',
                            background: w.cooldown
                              ? `linear-gradient(90deg, transparent 0 ${(w.cooldown / (w.cooldown + w.frames)) * 100}%, ${alpha(theme.palette.text.primary, 0.14)} ${(w.cooldown / (w.cooldown + w.frames)) * 100}%), repeating-linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.12)} 0 4px, transparent 4px 8px)`
                              : alpha(theme.palette.text.primary, 0.14),
                            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.18)}`,
                            zIndex: 1,
                          })}
                        >
                          {/* the icon, centred on the swap itself (not its cooldown wait); hidden when it
                            would not fit */}
                          <Box
                            sx={{
                              width: `${(w.frames / (w.cooldown + w.frames)) * 100}%`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              containerType: 'inline-size',
                              '& svg': { fontSize: 10 },
                              '@container (max-width: 11px)': {
                                '& svg': { display: 'none' },
                              },
                            }}
                          >
                            <SwapHorizIcon />
                          </Box>
                        </Box>
                      </Tooltip>
                    ))}
                    {(blocks.get(characterKey) ?? []).map((a) => {
                      const index = a.index
                      // (the opener's own actions, counted from the start: named, not opened)
                      const action = a.wait
                        ? undefined
                        : index !== undefined
                          ? flat[index]?.action
                          : a.openerIndex !== undefined
                            ? opener[a.openerIndex]?.action
                            : undefined
                      const isSelected =
                        index !== undefined && index === selected
                      const isEdited = index !== undefined && edited.has(index)
                      const name = a.wait
                        ? t('teamOpt.timing.kind.wait', 'Wait')
                        : action
                          ? (a.variant?.label ?? actionName(t, action))
                          : t('teamOpt.timing.entry', 'Entry (automatic)')
                      return (
                        <Tooltip
                          key={`${a.start}-${a.index ?? (a.wait ? 'wait' : 'entry')}`}
                          arrow
                          disableInteractive
                          title={
                            <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              <Box sx={{ fontWeight: 700 }}>
                                {name}
                                {a.text && (
                                  <Box
                                    component="span"
                                    sx={{
                                      ml: 0.75,
                                      fontFamily: 'ui-monospace, monospace',
                                      opacity: 0.7,
                                    }}
                                  >
                                    {a.text}
                                  </Box>
                                )}
                              </Box>
                              {seconds(a.start - start)}–
                              {seconds(a.start - start + a.frames)} s ·{' '}
                              {a.frames} {t('teamOpt.timing.framesShort', 'f')}
                              {isEdited && (
                                <Box sx={{ color: 'primary.main' }}>
                                  {t('teamOpt.timing.edited', 'Edited')}
                                </Box>
                              )}
                            </Box>
                          }
                        >
                          <ButtonBase
                            // (an automatic entry has no step to open: shown, not pressed)
                            aria-disabled={index === undefined}
                            tabIndex={index === undefined ? -1 : 0}
                            disableRipple={index === undefined}
                            onClick={() =>
                              index !== undefined && onSelect(index)
                            }
                            aria-label={`${name} ${seconds(a.start - start)} s`}
                            aria-pressed={isSelected}
                            sx={(theme) => {
                              const color = laneColor(theme, characterKey)
                              return {
                                position: 'absolute',
                                top: 6,
                                height: size.lane - 16,
                                left: pct(a.start),
                                width: `max(4px, calc(${pct(start + a.frames)} - 1px))`,
                                px: 0.5,
                                justifyContent: 'flex-start',
                                overflow: 'hidden',
                                borderRadius: 1,
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: 'ui-monospace, monospace',
                                whiteSpace: 'nowrap',
                                color: a.wait
                                  ? 'text.secondary'
                                  : theme.palette.getContrastText(color),
                                bgcolor: a.wait
                                  ? 'transparent'
                                  : alpha(
                                      color,
                                      index !== undefined || action
                                        ? 0.82
                                        : 0.35
                                    ),
                                backgroundImage: a.wait
                                  ? `repeating-linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.12)} 0 4px, transparent 4px 8px)`
                                  : 'none',
                                boxShadow: isSelected
                                  ? `0 0 0 2px ${theme.palette.background.default}, 0 0 0 4px ${theme.palette.primary.main}`
                                  : isEdited
                                    ? `inset 0 0 0 2px ${theme.palette.primary.main}`
                                    : `inset 0 0 0 1px ${alpha(theme.palette.common.black, 0.25)}`,
                                zIndex: isSelected ? 2 : 1,
                                transition: 'filter .12s, box-shadow .12s',
                                cursor:
                                  index === undefined ? 'default' : 'pointer',
                                '&:hover': {
                                  filter:
                                    index === undefined
                                      ? 'none'
                                      : 'brightness(1.15)',
                                },
                              }
                            }}
                          >
                            {a.text}
                          </ButtonBase>
                        </Tooltip>
                      )
                    })}
                    {/* each hit, a mark under the lane: as tall as its damage */}
                    {[...(byMember.get(characterKey) ?? [])].map(
                      ([frame, d]) => (
                        <Box
                          key={frame}
                          sx={(theme) => ({
                            position: 'absolute',
                            bottom: 2,
                            left: pct(frame),
                            width: '2px',
                            height: figures ? 3 + 9 * Math.sqrt(d / top) : 5,
                            borderRadius: 1,
                            bgcolor: alpha(
                              laneColor(theme, characterKey),
                              pin?.hit?.t === frame &&
                                pin.hit.characterKey === characterKey
                                ? 1
                                : 0.9
                            ),
                            boxShadow:
                              pin?.hit?.t === frame &&
                              pin.hit.characterKey === characterKey
                                ? `0 0 0 2px ${tokens.gold}`
                                : 'none',
                          })}
                        />
                      )
                    )}
                  </Box>
                </Box>
                {detail && (
                  <TrackGroup
                    tracks={memberTracks(characterKey)}
                    characterKey={characterKey}
                    teamData={teamData}
                    store={store}
                    pin={pin}
                    pct={pct}
                    span={span}
                  />
                )}
              </Box>
            ))}
            {/* the damage as it lands (a bar a hit), and as it adds up (the line) */}
            {detail && figures && (
              <Row
                label={t('teamOpt.timeline.damage', 'Damage')}
                height={64}
                top
                value={
                  <DamageValue
                    store={store}
                    pin={pin}
                    cumulative={cumulative}
                    total={total}
                  />
                }
              >
                <Box
                  component="svg"
                  viewBox="0 0 1000 100"
                  preserveAspectRatio="none"
                  sx={{
                    position: 'absolute',
                    inset: '6px 0 4px 0',
                    width: '100%',
                    height: 'calc(100% - 10px)',
                    overflow: 'visible',
                  }}
                >
                  <polyline
                    fill="none"
                    stroke={alpha(tokens.gold, 0.7)}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    points={[
                      '0,100',
                      ...cumulative.flatMap((c, i) => {
                        const x = ((c.t - start) / length) * 1000
                        const before = cumulative[i - 1]?.total ?? 0
                        return [
                          `${x},${100 - (before / total) * 100}`,
                          `${x},${100 - (c.total / total) * 100}`,
                        ]
                      }),
                      '1000,0',
                    ].join(' ')}
                  />
                </Box>
                {members.map((characterKey) =>
                  [...(byMember.get(characterKey) ?? [])].map(([frame, d]) => (
                    <Box
                      key={`${characterKey}${frame}`}
                      sx={(theme) => ({
                        position: 'absolute',
                        bottom: 4,
                        left: pct(frame),
                        width: '3px',
                        ml: '-1px',
                        height: `max(2px, ${(d / top) * 70}%)`,
                        borderRadius: '2px 2px 0 0',
                        bgcolor: alpha(laneColor(theme, characterKey), 0.85),
                      })}
                    />
                  ))
                )}
              </Row>
            )}
            {/* the pinned moment, and the one pointed at */}
            <Box
              ref={plotRef}
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: nameColumn,
                right: 12,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              {pin && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 20,
                    bottom: 4,
                    left: pct(pin.frame),
                    width: '2px',
                    ml: '-1px',
                    borderRadius: 1,
                    bgcolor: tokens.gold,
                    boxShadow: `0 0 8px ${alpha(tokens.gold, 0.6)}`,
                    transition: `left .16s ${tokens.ease}`,
                    '@media (prefers-reduced-motion: reduce)': {
                      transition: 'none',
                    },
                  }}
                />
              )}
              <Box
                ref={lineRef}
                sx={(theme) => ({
                  position: 'absolute',
                  top: 20,
                  bottom: 4,
                  width: '1px',
                  opacity: 0,
                  bgcolor: alpha(theme.palette.text.primary, 0.55),
                  transition: 'opacity .12s',
                })}
              />
            </Box>
          </Box>
        </Box>
        {shown && (
          <MomentPanel
            frame={shown.frame}
            hit={shown.hit}
            pinned={!!pin}
            roomy={detail}
            members={members}
            sim={sim}
            tracks={tracks}
            teamData={teamData}
            stats={stats}
            damage={figures ? damage : undefined}
            onUnpin={() => setPin(undefined)}
          >
            {pin?.hit && renderHit?.(pin.hit)}
          </MomentPanel>
        )}
      </Box>
    </SizeContext.Provider>
  )
}

/* ---------- rows of the detailed view ---------- */

/** A row under the lanes: its label (and its value at the pointed moment), then its plot */
function Row({
  label,
  value,
  height: given,
  indent,
  top,
  children,
}: {
  label: ReactNode
  value?: ReactNode
  height?: number
  /** Under a member's lane: in line with its name */
  indent?: boolean
  /** A section of its own: a hairline above it */
  top?: boolean
  children: ReactNode
}) {
  const size = useContext(SizeContext)
  const height = given ?? size.track
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'stretch',
        height,
        borderTop: top
          ? `1px solid ${alpha(theme.palette.text.primary, 0.06)}`
          : undefined,
      })}
    >
      <Box
        sx={[
          laneLabelSx,
          {
            pl: indent ? (size === ROOMY ? 5.75 : 4.75) : 1.25,
            gap: 0.5,
            '& > span': { fontSize: size.label },
          },
        ]}
      >
        <Typography
          noWrap
          component="span"
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 11.5,
            color: 'text.secondary',
          }}
        >
          {label}
        </Typography>
        {value}
      </Box>
      <Box sx={{ position: 'relative', flex: 1, mr: 1.5 }}>{children}</Box>
    </Box>
  )
}

const valueSx = {
  flexShrink: 0,
  maxWidth: 96,
  fontSize: 11.5,
  fontWeight: 650,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  ...numSx,
} as const

/** What a track's name and states are, from its sheet */
/** What a track's name and states are, from its sheet (`internal`: its sheet does not show it) */
function trackInfo(track: TimelineTrack, teamData: TeamData | undefined) {
  const fallback = track.path[track.path.length - 1] as ReactNode
  if (!teamData) return { label: fallback, internal: false }
  const info = describe(
    { owner: track.owner, path: track.path },
    track.segments[0].value,
    teamData
  )
  // a weapon's or set's effect: named by the item (its condition in the tooltip), as the effect's
  // own name ("After hitting an opponent with a Skill") does not say whose it is
  const [sheetKey] = track.path
  const item =
    track.group !== 'gear' ? undefined : allArtifactSetKeys.includes(
        sheetKey as ArtifactSetKey
      ) ? (
      <ArtifactSetName setKey={sheetKey as ArtifactSetKey} />
    ) : allWeaponKeys.includes(sheetKey as WeaponKey) ? (
      <WeaponName weaponKey={sheetKey as WeaponKey} />
    ) : undefined
  // (a conditional the members' sheets do not list)
  const unlisted = info.name === track.path.join(' · ')
  return {
    label: item ?? info.label ?? info.name ?? fallback,
    title: item
      ? unlisted
        ? undefined
        : (info.label ?? info.name)
      : info.title,
    states: info.states,
    // (an unlisted conditional is the simulation's own bookkeeping, except a weapon's or set's
    // effect: a KQM build's item that the member's own build does not have, still shown)
    internal:
      unlisted && !(item && !track.path.some((part) => part.startsWith('_'))),
  }
}
type TrackInfo = ReturnType<typeof trackInfo>
function useTrackInfo(track: TimelineTrack, teamData: TeamData | undefined) {
  return useMemo(() => trackInfo(track, teamData), [track, teamData])
}
const stateName = (info: TrackInfo, value: string): ReactNode =>
  info.states?.find((s: { value: string }) => s.value === value)?.name ||
  (/^[a-z]/.test(value) ? value[0].toUpperCase() + value.slice(1) : value)

type TrackProps = {
  /** The member whose lane they are under (their colour) */
  characterKey?: CharacterKey
  color?: string
  teamData: TeamData | undefined
  store: MomentStore
  pin: TimelinePin | undefined
  pct: (frame: number) => string
  span: (from: number, to: number) => string
}

/**
 * What the simulation follows for a member (or the team): its stacks and resources, each a small
 * area chart, then its buffs in one slim band (a line each while it is up) that opens into a row
 * a buff
 */
function TrackGroup({
  tracks,
  ...props
}: TrackProps & { tracks: TimelineTrack[] }) {
  const { t } = useTranslation('page_team')
  const TRACK = useContext(SizeContext).track
  const steps = tracks.filter((x) => x.kind === 'steps')
  // (the ones that are simply on all rotation are in the moment's panel, not drawn; a weapon's or
  // set's effect is drawn all the same, as the gear it is on)
  const buffs = tracks.filter(
    (x) => x.kind === 'ribbon' && (!x.constant || x.group === 'gear')
  )
  if (!steps.length && !buffs.length) return null
  const { characterKey, color, pct, span, store, pin } = props
  const tint = (theme: Theme, track: TimelineTrack) =>
    track.group === 'gear'
      ? tokens.gold
      : (color ?? (characterKey ? laneColor(theme, characterKey) : tokens.gold))
  return (
    <Box sx={{ pb: 0.5 }}>
      {steps.map((track) => (
        <TrackRow key={track.key} track={track} {...props} />
      ))}
      {!!buffs.length && (
        <Row
          indent={!!characterKey}
          height={Math.max(TRACK, buffs.length * 5 + 9)}
          label={t('teamOpt.timeline.buffsRow', 'Buffs')}
          value={<BuffsUp tracks={buffs} store={store} pin={pin} />}
        >
          {buffs.map((track, i) =>
            track.segments.map((seg) => (
              <Box
                key={`${track.key}${seg.start}`}
                sx={(theme) => ({
                  position: 'absolute',
                  top: 5 + i * 5,
                  height: 3,
                  left: pct(seg.start),
                  width: span(seg.start, seg.end),
                  borderRadius: 999,
                  bgcolor: alpha(tint(theme, track), 0.7),
                })}
              />
            ))
          )}
        </Row>
      )}
    </Box>
  )
}

/** How many of a member's buffs are up at the pointed (else the pinned) moment */
function BuffsUp({
  tracks,
  store,
  pin,
}: {
  tracks: TimelineTrack[]
  store: MomentStore
  pin: TimelinePin | undefined
}) {
  const { t } = useTranslation('page_team')
  const frame = useMoment(store)?.frame ?? pin?.frame
  if (frame === undefined) return null
  const up = tracks.filter((x) => trackValueAt(x, frame)).length
  return (
    <Box
      component="span"
      sx={{ ...valueSx, color: up ? 'text.primary' : 'text.disabled' }}
    >
      {t('teamOpt.timeline.upOf', {
        defaultValue: '{{count}} of {{total}}',
        count: up,
        total: tracks.length,
      })}
    </Box>
  )
}

/**
 * A resource or stack count over the rotation (a soft area, as tall as its count), or a buff (a
 * slim line while it is up)
 */
function TrackRow({
  track,
  characterKey,
  color,
  teamData,
  store,
  pin,
  pct,
  span,
}: TrackProps & { track: TimelineTrack }) {
  const info = useTrackInfo(track, teamData)
  const TRACK = useContext(SizeContext).track
  const tint = (theme: Theme) =>
    track.group === 'gear'
      ? tokens.gold
      : (color ?? (characterKey ? laneColor(theme, characterKey) : tokens.gold))
  return (
    <Row
      indent={!!characterKey}
      height={track.kind === 'steps' ? TRACK + 4 : TRACK}
      label={
        <Tooltip
          arrow
          placement="top-start"
          enterDelay={500}
          title={
            <Suspense fallback="">
              {info.label}
              {info.title && <Box sx={{ opacity: 0.7 }}>{info.title}</Box>}
            </Suspense>
          }
        >
          <span>
            <Suspense fallback="…">{info.label}</Suspense>
          </span>
        </Tooltip>
      }
      value={<TrackValue track={track} info={info} store={store} pin={pin} />}
    >
      {track.segments.map((seg) =>
        track.kind === 'steps' ? (
          <Box
            key={seg.start}
            sx={(theme) => ({
              position: 'absolute',
              bottom: 2,
              left: pct(seg.start),
              width: span(seg.start, seg.end),
              height: 2 + (TRACK - 4) * (+seg.value / track.max),
              background: `linear-gradient(to top, ${alpha(tint(theme), 0.06)}, ${alpha(tint(theme), 0.32)})`,
              borderTop: `1.5px solid ${alpha(tint(theme), 0.95)}`,
              containerType: 'inline-size',
              overflow: 'hidden',
            })}
          >
            <Box
              component="span"
              sx={{
                position: 'absolute',
                top: 0,
                left: 3,
                fontSize: 9.5,
                fontWeight: 650,
                lineHeight: '11px',
                color: 'text.primary',
                opacity: 0.85,
                ...numSx,
                '@container (max-width: 15px)': { display: 'none' },
              }}
            >
              {+seg.value / track.max > 0.55 ? seg.value : ''}
            </Box>
          </Box>
        ) : (
          <Box
            key={seg.start}
            sx={(theme) => ({
              position: 'absolute',
              top: TRACK / 2 - 2,
              height: 4,
              left: pct(seg.start),
              width: span(seg.start, seg.end),
              borderRadius: 999,
              bgcolor: alpha(tint(theme), track.constant ? 0.3 : 0.75),
            })}
          />
        )
      )}
    </Row>
  )
}

/** A track's value at the pointed (else the pinned) moment */
function TrackValue({
  track,
  info,
  store,
  pin,
}: {
  track: TimelineTrack
  info: TrackInfo
  store: MomentStore
  pin: TimelinePin | undefined
}) {
  const { t } = useTranslation('page_team')
  const frame = useMoment(store)?.frame ?? pin?.frame
  if (frame === undefined) return null
  const value = trackValueAt(track, frame)
  return (
    <Box
      component="span"
      sx={{ ...valueSx, color: value ? 'text.primary' : 'text.disabled' }}
    >
      {!value ? (
        '–'
      ) : track.kind === 'steps' ? (
        value
      ) : value === 'on' ? (
        t('teamOpt.timeline.on', 'on')
      ) : (
        <Suspense fallback={value}>{stateName(info, value)}</Suspense>
      )}
    </Box>
  )
}

function AuraChips({ auras }: { auras: AuraKey[] }) {
  const { t } = useTranslation('page_team')
  return (
    <>
      {auras.map((aura) => (
        <Box
          key={aura}
          component="span"
          sx={(theme) => ({
            px: 0.75,
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 650,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            color: auraColor(theme, aura),
            bgcolor: alpha(auraColor(theme, aura), 0.14),
            boxShadow: `inset 0 0 0 1px ${alpha(auraColor(theme, aura), 0.4)}`,
          })}
        >
          {t(`teamOpt.timeline.aura.${aura}`, AURA_NAME[aura])}
        </Box>
      ))}
    </>
  )
}

function AuraValue({
  store,
  pin,
  sim,
}: {
  store: MomentStore
  pin: TimelinePin | undefined
  sim: SimulationResult
}) {
  const frame = useMoment(store)?.frame ?? pin?.frame
  if (frame === undefined) return null
  const auras = aurasAt(sim, frame)
  return (
    <Box component="span" sx={valueSx}>
      {auras.length ? (
        auras.map((aura, i) => (
          <Box
            key={aura}
            component="span"
            sx={(theme) => ({ color: auraColor(theme, aura) })}
          >
            {i ? ' ' : ''}
            {AURA_NAME[aura]}
          </Box>
        ))
      ) : (
        <Box component="span" sx={{ color: 'text.disabled' }}>
          –
        </Box>
      )}
    </Box>
  )
}

const damageUntil = (
  cumulative: { t: number; total: number }[],
  frame: number
) => {
  let sum = 0
  for (const c of cumulative) {
    if (c.t > frame) break
    sum = c.total
  }
  return sum
}

function DamageValue({
  store,
  pin,
  cumulative,
  total,
}: {
  store: MomentStore
  pin: TimelinePin | undefined
  cumulative: { t: number; total: number }[]
  total: number
}) {
  const frame = useMoment(store)?.frame ?? pin?.frame
  return (
    <Box component="span" sx={{ ...valueSx, color: 'text.primary' }}>
      {formatDamage(
        frame === undefined ? total : damageUntil(cumulative, frame)
      )}
    </Box>
  )
}

/* ---------- the moment's readout ---------- */

const readoutLabelSx = {
  fontSize: 11.5,
  color: 'text.secondary',
  whiteSpace: 'nowrap',
} as const

/**
 * The pointed (else the pinned) moment in one line: its time, who is on the field, the enemy's
 * auras, the team's stacks, the hit there and the damage up to it
 */
function Readout({
  store,
  pin,
  sim,
  tracks,
  teamData,
  hitAt,
  damage,
  cumulative,
  total,
  onUnpin,
}: {
  store: MomentStore
  pin: TimelinePin | undefined
  sim: SimulationResult
  /** The team's own stacks (the Polestar Field's…) */
  tracks: TimelineTrack[]
  teamData: TeamData | undefined
  hitAt: (moment: Moment) => SimHit | undefined
  damage?: (hit: SimHit) => number | undefined
  cumulative: { t: number; total: number }[]
  total: number
  onUnpin: () => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const pointed = useMoment(store)
  // (a touch screen has no pointer to hover with)
  const touch = useMediaQuery('(hover: none)')
  const moment = pointed ?? (pin ? { frame: pin.frame } : undefined)
  if (!moment)
    return (
      <Typography sx={{ ...readoutLabelSx, ml: 0.5 }}>
        {touch
          ? t('teamOpt.timeline.hintTouch', 'Tap a moment to pin it')
          : t('teamOpt.timeline.hint', 'Point at a moment · click to pin it')}
      </Typography>
    )
  const hit = pointed ? hitAt(pointed) : pin?.hit
  const frame = hit && pointed ? hit.t : moment.frame
  const onField = hit?.onField ?? onFieldAt(sim, frame)
  const auras = aurasAt(sim, frame)
  const d = hit && damage?.(hit)
  return (
    <Box
      aria-live="off"
      sx={{
        display: 'flex',
        alignItems: 'center',
        columnGap: 1.5,
        minWidth: 0,
        flex: 1,
        height: 28,
        overflow: 'hidden',
      }}
    >
      <Typography
        sx={{
          fontSize: 14,
          fontWeight: 650,
          minWidth: 58,
          whiteSpace: 'nowrap',
          color: pointed ? 'text.primary' : 'primary.main',
          ...numSx,
        }}
      >
        {seconds(frame - sim.start)} s
      </Typography>
      {onField && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
        >
          <MemberAvatar characterKey={onField} size={18} />
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
            <CharacterName characterKey={onField} gender={gender} />
          </Typography>
        </Box>
      )}
      {!!sim.auras && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box component="span" sx={readoutLabelSx}>
            {t('teamOpt.timeline.enemyShort', 'Enemy')}
          </Box>
          {auras.length ? (
            <AuraChips auras={auras} />
          ) : (
            <Box component="span" sx={{ ...readoutLabelSx, opacity: 0.6 }}>
              {t('teamOpt.timeline.noAura', 'no aura')}
            </Box>
          )}
        </Box>
      )}
      {tracks
        .filter((x) => x.kind === 'steps')
        .map((track) => (
          <ReadoutTrack
            key={track.key}
            track={track}
            teamData={teamData}
            frame={frame}
          />
        ))}
      {hit && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
        >
          <Box
            sx={(theme) => ({
              width: 8,
              height: 8,
              borderRadius: 999,
              flexShrink: 0,
              bgcolor: laneColor(theme, hit.characterKey),
            })}
          />
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {hit.label}
          </Typography>
          {d !== undefined && (
            <Typography sx={{ fontSize: 12.5, fontWeight: 650, ...numSx }}>
              {formatDamage(d, true)}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ flexGrow: 1 }} />
      {damage && total > 0 && (
        <Typography sx={{ ...readoutLabelSx, ...numSx }}>
          {t('teamOpt.timeline.soFar', {
            defaultValue: '{{damage}} so far · {{percent}}%',
            damage: formatDamage(damageUntil(cumulative, frame)),
            percent: Math.round((damageUntil(cumulative, frame) / total) * 100),
          })}
        </Typography>
      )}
      {pin && (
        <Tooltip title={t('teamOpt.timeline.unpin', 'Unpin')}>
          <IconButton
            size="small"
            onClick={onUnpin}
            aria-label={t('teamOpt.timeline.unpin', 'Unpin')}
            sx={{ p: 0.375, color: 'primary.main', ...focusSx }}
          >
            <PushPinOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

function ReadoutTrack({
  track,
  teamData,
  frame,
}: {
  track: TimelineTrack
  teamData: TeamData | undefined
  frame: number
}) {
  const info = useTrackInfo(track, teamData)
  const value = trackValueAt(track, frame)
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0 }}
    >
      <Typography noWrap component="span" sx={readoutLabelSx}>
        <Suspense fallback="…">{info.label}</Suspense>
      </Typography>
      <Box
        component="span"
        sx={{
          fontSize: 12.5,
          fontWeight: 650,
          color: value ? 'text.primary' : 'text.disabled',
          ...numSx,
        }}
      >
        {value || '–'}
      </Box>
    </Box>
  )
}

/* ---------- the moment's panel ---------- */

/** One stat of a member at a moment, as its panel lists it */
export interface MomentStat {
  key: string
  name: ReactNode
  value: string
  variant?: string
}

/**
 * Everything at one moment (the pinned one, else the one pointed at), a card a member: its stats
 * then, its stacks and resources as meters, the buffs up then (each with the time it has left)
 * and the ones that are on all rotation; above them the hit picked there, the enemy's auras and
 * the team's own stacks
 */
function MomentPanel({
  frame,
  hit,
  pinned,
  roomy,
  members,
  sim,
  tracks,
  teamData,
  stats,
  damage,
  onUnpin,
  children,
}: {
  /** In the detailed window: more room in each card */
  roomy?: boolean
  frame: number
  hit: SimHit | undefined
  pinned: boolean
  members: CharacterKey[]
  sim: SimulationResult
  tracks: TimelineTrack[]
  teamData: TeamData | undefined
  stats?: Partial<Record<CharacterKey, MomentStat[]>>
  damage?: (hit: SimHit) => number | undefined
  onUnpin: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const onField = hit?.onField ?? onFieldAt(sim, frame)
  const auras = aurasAt(sim, frame)
  const team = tracks.filter((x) => x.owner === 'team')
  const d = hit && damage?.(hit)
  return (
    <Box
      sx={(theme) => ({
        borderRadius: 2.5,
        border: `1px solid ${pinned ? alpha(tokens.gold, 0.35) : theme.palette.divider}`,
        bgcolor: tokens.inset,
        overflow: 'hidden',
        transition: 'border-color .16s',
      })}
    >
      {/* the moment: its time, the hit there, the enemy and the team's stacks */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.75,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${tokens.hairline}`,
        }}
      >
        <Typography
          sx={{
            fontSize: 18,
            fontWeight: 650,
            letterSpacing: '-0.01em',
            minWidth: 72,
            color: pinned ? 'primary.main' : 'text.primary',
            ...numSx,
          }}
        >
          {seconds(frame - sim.start)}
          <Box
            component="span"
            sx={{ fontSize: 12, fontWeight: 500, ml: 0.375 }}
          >
            s
          </Box>
        </Typography>
        {hit && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <MemberAvatar characterKey={hit.characterKey} size={22} />
            <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 650 }}>
              {hit.label}
            </Typography>
            {d !== undefined && (
              <Typography sx={{ fontSize: 13.5, fontWeight: 650, ...numSx }}>
                {formatDamage(d, true)}
              </Typography>
            )}
          </Box>
        )}
        {!!sim.auras && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={readoutLabelSx}>
              {t('teamOpt.timeline.enemyShort', 'Enemy')}
            </Box>
            {auras.length ? (
              <AuraChips auras={auras} />
            ) : (
              <Box component="span" sx={{ ...readoutLabelSx, opacity: 0.6 }}>
                {t('teamOpt.timeline.noAura', 'no aura')}
              </Box>
            )}
          </Box>
        )}
        {team
          .filter((x) => x.kind === 'steps')
          .map((track) => (
            <Meter
              key={track.key}
              track={track}
              frame={frame}
              teamData={teamData}
            />
          ))}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
          <BuffChips
            tracks={team.filter((x) => x.kind === 'ribbon')}
            frame={frame}
            teamData={teamData}
          />
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {pinned && (
          <Tooltip title={t('teamOpt.timeline.unpin', 'Unpin')}>
            <IconButton
              size="small"
              onClick={onUnpin}
              aria-label={t('teamOpt.timeline.unpin', 'Unpin')}
              sx={{ p: 0.5, ...quickSx, ...focusSx }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {/* a card a member */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
          },
        }}
      >
        {members.map((characterKey, i) => {
          const own = tracks.filter((x) => x.owner === characterKey)
          const memberStats = stats?.[characterKey]
          return (
            <Box
              key={characterKey}
              sx={{
                p: roomy ? 2 : 1.5,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: roomy ? 1.25 : 1,
                borderLeft: { lg: i ? `1px solid ${tokens.hairline}` : 'none' },
                borderTop: {
                  xs: i ? `1px solid ${tokens.hairline}` : 'none',
                  lg: 'none',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <MemberAvatar characterKey={characterKey} size={24} />
                <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 650 }}>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </Typography>
                {onField === characterKey && (
                  <Box
                    component="span"
                    sx={(theme) => ({
                      ml: 'auto',
                      flexShrink: 0,
                      px: 0.75,
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 650,
                      lineHeight: '18px',
                      color: laneColor(theme, characterKey),
                      bgcolor: alpha(laneColor(theme, characterKey), 0.14),
                    })}
                  >
                    {t('teamOpt.timeline.onField', 'On field')}
                  </Box>
                )}
              </Box>
              {memberStats && (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    columnGap: 1.5,
                    rowGap: 0.125,
                  }}
                >
                  {memberStats.map((stat) => (
                    <Box
                      key={stat.key}
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 0.75,
                        fontSize: 12,
                        lineHeight: '20px',
                        minWidth: 0,
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stat.name}
                      </Box>
                      <Box component="span" sx={{ fontWeight: 650, ...numSx }}>
                        {stat.value}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
              {own
                .filter((x) => x.kind === 'steps')
                .map((track) => (
                  <Meter
                    key={track.key}
                    track={track}
                    frame={frame}
                    teamData={teamData}
                    characterKey={characterKey}
                  />
                ))}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                <BuffChips
                  tracks={own.filter((x) => x.kind === 'ribbon')}
                  frame={frame}
                  teamData={teamData}
                />
              </Box>
            </Box>
          )
        })}
      </Box>
      {children && (
        <Box
          sx={{ p: roomy ? 2 : 1.5, borderTop: `1px solid ${tokens.hairline}` }}
        >
          {/* (a readable measure: its rows are a name and a number) */}
          <Box sx={{ maxWidth: 680 }}>{children}</Box>
        </Box>
      )}
    </Box>
  )
}

/** A stack count or resource at a moment: its name, its value, and a bar of how full it is */
function Meter({
  track,
  frame,
  teamData,
  characterKey,
}: {
  track: TimelineTrack
  frame: number
  teamData: TeamData | undefined
  characterKey?: CharacterKey
}) {
  const info = useTrackInfo(track, teamData)
  const value = +trackValueAt(track, frame) || 0
  return (
    <Tooltip
      arrow
      placement="top-start"
      enterDelay={500}
      title={<Suspense fallback="">{info.label}</Suspense>}
    >
      <Box
        sx={{
          minWidth: 120,
          maxWidth: 280,
          flex: characterKey ? undefined : '0 1 200px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 1,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          <Box
            component="span"
            sx={{
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Suspense fallback="…">{info.label}</Suspense>
          </Box>
          <Box component="span" sx={{ fontWeight: 650, ...numSx }}>
            {value}
            <Box
              component="span"
              sx={{ color: 'text.disabled', fontWeight: 500 }}
            >
              /{track.max}
            </Box>
          </Box>
        </Box>
        <Box
          sx={(theme) => ({
            height: 4,
            borderRadius: 999,
            bgcolor: alpha(theme.palette.text.primary, 0.08),
            overflow: 'hidden',
          })}
        >
          <Box
            sx={(theme) => ({
              height: '100%',
              width: `${(value / track.max) * 100}%`,
              borderRadius: 999,
              bgcolor: characterKey
                ? laneColor(theme, characterKey)
                : tokens.gold,
              transition: `width .18s ${tokens.ease}`,
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            })}
          />
        </Box>
      </Box>
    </Tooltip>
  )
}

/**
 * The buffs up at a moment as chips (the timed ones with the time they have left), then the ones
 * that are on all rotation folded into one chip that lists them
 */
function BuffChips({
  tracks,
  frame,
  teamData,
}: {
  tracks: TimelineTrack[]
  frame: number
  teamData: TeamData | undefined
}) {
  const { t } = useTranslation('page_team')
  const up = tracks.filter((x) => trackValueAt(x, frame))
  // (a weapon's or set's effect is named like a timed one even when it is on all rotation)
  const named = (x: TimelineTrack) => !x.constant || x.group === 'gear'
  const timed = up.filter(named)
  const always = up.filter((x) => !named(x))
  return (
    <>
      {timed.map((track) => (
        <BuffChip
          key={track.key}
          track={track}
          frame={frame}
          teamData={teamData}
        />
      ))}
      {!!always.length && (
        <Tooltip
          arrow
          title={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {always.map((track) => (
                <AlwaysLine key={track.key} track={track} teamData={teamData} />
              ))}
            </Box>
          }
        >
          <Box
            component="span"
            tabIndex={0}
            sx={[chipSx, { color: 'text.secondary', borderStyle: 'dashed' }]}
          >
            {t('teamOpt.timeline.alwaysOn', {
              defaultValue: 'Always on · {{count}}',
              count: always.length,
            })}
          </Box>
        </Tooltip>
      )}
    </>
  )
}

const chipSx = (theme: Theme) => ({
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 0.5,
  maxWidth: '100%',
  px: 0.875,
  borderRadius: 999,
  fontSize: 11.5,
  lineHeight: '20px',
  whiteSpace: 'nowrap' as const,
  border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
  bgcolor: alpha(theme.palette.text.primary, 0.04),
})

function AlwaysLine({
  track,
  teamData,
}: {
  track: TimelineTrack
  teamData: TeamData | undefined
}) {
  const info = useTrackInfo(track, teamData)
  const value = track.segments[0].value
  return (
    <Box component="span">
      <Suspense fallback="…">{info.label}</Suspense>
      {value !== 'on' && (
        <Box component="span" sx={{ opacity: 0.7 }}>
          {' · '}
          <Suspense fallback={value}>{stateName(info, value)}</Suspense>
        </Box>
      )}
    </Box>
  )
}

function BuffChip({
  track,
  frame,
  teamData,
}: {
  track: TimelineTrack
  frame: number
  teamData: TeamData | undefined
}) {
  const info = useTrackInfo(track, teamData)
  const seg = track.segments.find((x) => x.start <= frame && frame < x.end)
  if (!seg) return null
  return (
    <Tooltip
      arrow
      enterDelay={500}
      title={
        <Suspense fallback="">
          {info.label}
          {info.title && <Box sx={{ opacity: 0.7 }}>{info.title}</Box>}
        </Suspense>
      }
    >
      <Box
        component="span"
        sx={[
          chipSx,
          track.group === 'gear' && {
            borderColor: alpha(tokens.gold, 0.45),
          },
        ]}
      >
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}
        >
          <Suspense fallback="…">{info.label}</Suspense>
        </Box>
        {seg.value !== 'on' && (
          <Box component="span" sx={{ fontWeight: 650 }}>
            <Suspense fallback={seg.value}>
              {stateName(info, seg.value)}
            </Suspense>
          </Box>
        )}
        {!track.constant && (
          <Box component="span" sx={{ color: 'text.secondary', ...numSx }}>
            {seconds(seg.end - frame)}s
          </Box>
        )}
      </Box>
    </Tooltip>
  )
}

const laneLabelSx = (theme: Theme) => ({
  position: 'sticky' as const,
  left: 0,
  zIndex: 3,
  width: 'var(--timeline-names)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  pl: 1.25,
  pr: 1,
  bgcolor: theme.palette.contentDark.main,
})
