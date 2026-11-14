import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { ParsedRotation, SimulationResult } from '@genshin-optimizer/gi/ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { alpha, Box, ButtonBase, Tooltip, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { actionName, flatActions, seconds } from './RotationTiming'

const FPS = 60
/** Ruler steps, seconds: the first giving at most ten marks */
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60]
/** Pixels per second at the narrowest (the strip scrolls sideways beyond it) */
const MIN_PX_PER_SECOND = 22
const LANE = 36
const NAME_COLUMN = 132

type SimAction = SimulationResult['actions'][number]

/** A member's lane colour: its element's, from the theme */
export const laneColor = (theme: Theme, characterKey: CharacterKey) => {
  const ele = getCharEle(characterKey)
  const palette = (
    theme.palette as unknown as Record<string, { main: string }>
  )[ele]
  return palette?.main ?? theme.palette.primary.main
}

/**
 * The rotation as it plays: one lane per member, each action a block as long as its frames (in the
 * member's element colour), each swap a neutral block on the incoming member's lane (after any wait
 * for the swap cooldown), every hit a mark under it, on a seconds ruler. A block opens its step's
 * timing; the edited ones are outlined.
 */
export function RotationTimeline({
  members,
  rotation,
  sim,
  edited,
  selected,
  onSelect,
}: {
  members: CharacterKey[]
  rotation: ParsedRotation
  sim: SimulationResult
  /** The steps with a timing edit (their action positions) */
  edited: ReadonlySet<number>
  selected?: number
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const start = sim.start
  const length = Math.max(1, sim.frames)
  const flat = useMemo(() => flatActions(rotation), [rotation])
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
  const hits = useMemo(() => {
    const byMember = new Map<CharacterKey, number[]>()
    for (const h of sim.hits)
      if (!h.path[0]?.startsWith('_') && h.t >= start && h.t <= start + length)
        byMember.set(h.characterKey, [
          ...(byMember.get(h.characterKey) ?? []),
          h.t,
        ])
    return byMember
  }, [sim, start, length])

  return (
    <Box
      sx={(theme) => ({
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.contentDark.main,
        overflowX: 'auto',
        overflowY: 'hidden',
      })}
    >
      <Box
        sx={{
          minWidth: NAME_COLUMN + totalSeconds * MIN_PX_PER_SECOND,
          position: 'relative',
          pb: 0.75,
        }}
      >
        {/* the ruler */}
        <Box sx={{ display: 'flex', height: 26, alignItems: 'flex-end' }}>
          <Box sx={laneLabelSx} />
          <Box sx={{ position: 'relative', flex: 1, height: '100%', mr: 1.5 }}>
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
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {s}s
              </Typography>
            ))}
          </Box>
        </Box>
        {members.map((characterKey) => (
          <Box
            key={characterKey}
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'stretch',
              height: LANE,
              borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.06)}`,
            })}
          >
            <Box sx={laneLabelSx}>
              <MemberAvatar characterKey={characterKey} size={22} />
              <Typography
                noWrap
                sx={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}
              >
                <CharacterName characterKey={characterKey} gender={gender} />
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
                        <CharacterName characterKey={w.from} gender={gender} />{' '}
                        → <CharacterName characterKey={w.to} gender={gender} />
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
                      height: LANE - 16,
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
                const action =
                  index !== undefined && !a.wait
                    ? flat[index]?.action
                    : undefined
                const isSelected = index !== undefined && index === selected
                const isEdited = index !== undefined && edited.has(index)
                const name = a.wait
                  ? t('teamOpt.timing.kind.wait', 'Wait')
                  : action
                    ? actionName(t, action)
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
                        {seconds(a.start - start + a.frames)} s · {a.frames}{' '}
                        {t('teamOpt.timing.framesShort', 'f')}
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
                      onClick={() => index !== undefined && onSelect(index)}
                      aria-label={`${name} ${seconds(a.start - start)} s`}
                      aria-pressed={isSelected}
                      sx={(theme) => {
                        const color = laneColor(theme, characterKey)
                        return {
                          position: 'absolute',
                          top: 6,
                          height: LANE - 16,
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
                            : alpha(color, index === undefined ? 0.35 : 0.82),
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
                          cursor: index === undefined ? 'default' : 'pointer',
                          '&:hover': {
                            filter:
                              index === undefined ? 'none' : 'brightness(1.15)',
                          },
                        }
                      }}
                    >
                      {a.text}
                    </ButtonBase>
                  </Tooltip>
                )
              })}
              {/* each hit, a mark under the lane */}
              {[...new Set(hits.get(characterKey) ?? [])].map((frame) => (
                <Box
                  key={frame}
                  sx={(theme) => ({
                    position: 'absolute',
                    bottom: 3,
                    left: pct(frame),
                    width: '2px',
                    height: 5,
                    borderRadius: 1,
                    bgcolor: alpha(laneColor(theme, characterKey), 0.9),
                  })}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const laneLabelSx = (theme: Theme) => ({
  position: 'sticky' as const,
  left: 0,
  zIndex: 3,
  width: NAME_COLUMN,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  pl: 1.25,
  pr: 1,
  bgcolor: theme.palette.contentDark.main,
})
