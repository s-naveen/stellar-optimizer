import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  ParsedRotation,
  RotationAction,
  SimulationResult,
} from '@genshin-optimizer/gi/ui'
import { actionFrameKey, CharacterName } from '@genshin-optimizer/gi/ui'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'

const FPS = 60

/** A frame edit, kept only while the action at that position is still the same one */
export interface TimingEdit {
  characterKey: CharacterKey
  text: string
  frames: number
}
export interface RotationTimingSettings {
  /** By the action's position in the written rotation */
  edits: Record<number, TimingEdit>
  /** Frames from pressing swap to the next member acting (undefined: the default 12) */
  swapFrames?: number
}
export const DEFAULT_SWAP_FRAMES = 12

/** The written actions in order (the simulator's action positions) */
export function flatActions(rotation: ParsedRotation) {
  return rotation.steps.flatMap((step) =>
    step.actions.map((action) => ({
      characterKey: step.characterKey,
      action,
    }))
  )
}

/** The edits that still match the written rotation, as the simulator's overrides */
export function frameOverrides(
  rotation: ParsedRotation,
  edits: Record<number, TimingEdit>
): Record<number, number> {
  const flat = flatActions(rotation)
  const out: Record<number, number> = {}
  for (const [i, e] of Object.entries(edits)) {
    const f = flat[Number(i)]
    if (f && f.characterKey === e.characterKey && f.action.text === e.text)
      out[Number(i)] = e.frames
  }
  return out
}

export const seconds = (frames: number) => (frames / FPS).toFixed(2)

/**
 * This rotation's steps: when each action starts and how many frames it takes before the next one,
 * each editable for this rotation only (on top of the characters' frame data). A step is selected
 * with its timeline block (and selects it); the selected one links to its character's frame data.
 */
export function StepTiming({
  rotation,
  sim,
  settings,
  setSettings,
  selected,
  onSelect,
  onEditCharacter,
}: {
  rotation: ParsedRotation
  sim: SimulationResult
  settings: RotationTimingSettings
  setSettings: (s: RotationTimingSettings) => void
  selected?: number
  onSelect?: (index: number | undefined) => void
  /** Opens the step's action in its character's frame data (every rotation) */
  onEditCharacter?: (characterKey: CharacterKey, actionKey: string) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const flat = flatActions(rotation)
  const overrides = frameOverrides(rotation, settings.edits)
  // the kept rotation's actions, grouped into consecutive turns on the field
  const start = sim.start
  const turns: {
    characterKey: CharacterKey
    start: number
    rows: SimulationResult['actions']
  }[] = []
  const timeline = [...sim.actions, ...(sim.waits ?? [])].sort(
    (x, y) => x.start - y.start || (x.index ?? -1) - (y.index ?? -1)
  )
  for (const a of timeline) {
    const last = turns[turns.length - 1]
    if (last && last.characterKey === a.characterKey) last.rows.push(a)
    else turns.push({ characterKey: a.characterKey, start: a.start, rows: [a] })
  }
  const setFrames = (index: number, frames: number | undefined) => {
    const edits = { ...settings.edits }
    const f = flat[index]
    if (frames === undefined || !f) delete edits[index]
    else
      edits[index] = {
        characterKey: f.characterKey,
        text: f.action.text,
        frames,
      }
    setSettings({ ...settings, edits })
  }
  // the selected step (from the timeline): into view
  useEffect(() => {
    if (selected === undefined) return
    requestAnimationFrame(() =>
      document
        .getElementById(`step-${selected}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }, [selected])
  const grid = 'minmax(0, 1fr) 52px 92px 28px'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: grid,
          columnGap: 1,
          alignItems: 'center',
          px: 2,
          py: 0.75,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: theme.palette.contentNormal.main,
          borderBottom: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Typography variant="caption" color="text.secondary">
          {t('teamOpt.timing.action', 'Action')}
        </Typography>
        <Tooltip
          arrow
          title={t(
            'teamOpt.timing.startTip',
            'When the action starts, in seconds from the start of the rotation.'
          )}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ...hintSx, textAlign: 'right' }}
          >
            {t('teamOpt.timing.start', 'Starts')}
          </Typography>
        </Tooltip>
        <Tooltip
          arrow
          title={t(
            'teamOpt.timing.framesTip',
            'Frames until the next action can start. Lower it for a faster cancel, raise it for slower play or a pause. Hits already started still land on time.'
          )}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ...hintSx, textAlign: 'right' }}
          >
            {t('teamOpt.timing.frames', 'Frames')}
          </Typography>
        </Tooltip>
        <span />
      </Box>
      <Box sx={{ pb: 1 }}>
        {turns.map((turn, ti) => (
          <Box key={`${turn.characterKey}-${turn.start}`} sx={{ pt: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                mb: 0.25,
              }}
            >
              <MemberAvatar characterKey={turn.characterKey} size={22} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                <CharacterName
                  characterKey={turn.characterKey}
                  gender={gender}
                />
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
              >
                {ti + 1}
              </Typography>
            </Box>
            {turn.rows.map((a) => {
              const index = a.index
              const action =
                index !== undefined ? flat[index]?.action : undefined
              const isEdited = index !== undefined && index in overrides
              const isSelected = index !== undefined && index === selected
              return (
                <Box
                  key={`${a.start}-${index ?? 'entry'}`}
                  id={index !== undefined ? `step-${index}` : undefined}
                  onClick={() =>
                    index !== undefined &&
                    onSelect?.(isSelected ? undefined : index)
                  }
                  sx={(theme) => ({
                    display: 'grid',
                    gridTemplateColumns: grid,
                    columnGap: 1,
                    alignItems: 'center',
                    minHeight: 36,
                    pl: 5.25,
                    pr: 2,
                    cursor: index !== undefined ? 'pointer' : 'default',
                    scrollMarginTop: 40,
                    bgcolor: isSelected
                      ? alpha(theme.palette.primary.main, 0.1)
                      : 'transparent',
                    boxShadow: isSelected
                      ? `inset 2px 0 0 ${theme.palette.primary.main}`
                      : 'none',
                    transition: 'background-color .12s',
                    '&:hover': {
                      bgcolor: isSelected
                        ? alpha(theme.palette.primary.main, 0.12)
                        : alpha(theme.palette.text.primary, 0.04),
                    },
                  })}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    color={action ? 'text.primary' : 'text.secondary'}
                  >
                    {action ? (
                      <>
                        <Box
                          component="span"
                          sx={{
                            mr: 0.75,
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        >
                          {action.text}
                        </Box>
                        {actionName(t, action)}
                      </>
                    ) : (
                      <Tooltip
                        arrow
                        title={t(
                          'teamOpt.timing.entryTip',
                          'Played automatically when this character comes on field.'
                        )}
                      >
                        <span style={hintSx}>
                          {t('teamOpt.timing.entry', 'Entry (automatic)')}
                        </span>
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {seconds(a.start - start)}
                  </Typography>
                  {index !== undefined ? (
                    <Box onClick={(e) => e.stopPropagation()}>
                      <FramesInput
                        value={a.frames}
                        defaultValue={a.defaultFrames ?? a.frames}
                        min={action?.kind === 'wait' ? 0 : 1}
                        onChange={(v) =>
                          setFrames(
                            index,
                            v === (a.defaultFrames ?? a.frames) ? undefined : v
                          )
                        }
                        label={`${action ? actionName(t, action) : ''} ${t('teamOpt.timing.frames', 'Frames')}`}
                      />
                    </Box>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        textAlign: 'right',
                        pr: 1.25,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {a.frames}
                    </Typography>
                  )}
                  {isEdited ? (
                    <Tooltip
                      arrow
                      title={t('teamOpt.timing.resetOne', {
                        defaultValue: 'Reset to {{frames}} frames',
                        frames: a.defaultFrames,
                      })}
                    >
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFrames(index!, undefined)
                        }}
                        aria-label={t('teamOpt.timing.resetOne', {
                          defaultValue: 'Reset to {{frames}} frames',
                          frames: a.defaultFrames,
                        })}
                        sx={{ p: 0.25 }}
                      >
                        <RestartAltIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <span />
                  )}
                  {isSelected &&
                    action &&
                    action.kind !== 'wait' &&
                    onEditCharacter && (
                      <Box
                        sx={{ gridColumn: '1 / -1', pb: 0.75, mt: -0.25 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ButtonBase
                          onClick={() =>
                            onEditCharacter(
                              a.characterKey,
                              actionFrameKey(action)
                            )
                          }
                          sx={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: 'primary.main',
                            borderRadius: 1,
                            px: 0.5,
                            ml: -0.5,
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {t(
                            'teamOpt.timing.editEvery',
                            'Edit for every rotation'
                          )}
                        </ButtonBase>
                      </Box>
                    )}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** A dotted underline: this label has an explanation on hover */
export const hintSx = {
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
} as const

export function actionName(
  t: ReturnType<typeof useTranslation>['t'],
  a: RotationAction
): string {
  switch (a.kind) {
    case 'skill':
      return a.hold
        ? t('teamOpt.timing.kind.skillHold', 'Skill (hold)')
        : t('teamOpt.timing.kind.skill', 'Skill')
    case 'burst':
      return t('teamOpt.timing.kind.burst', 'Burst')
    case 'normal':
      return t('teamOpt.timing.kind.normal', {
        defaultValue: 'Normal attack ×{{count}}',
        count: a.count ?? 1,
      })
    case 'charged':
      return t('teamOpt.timing.kind.charged', 'Charged attack')
    case 'plunge':
      return t('teamOpt.timing.kind.plunge', 'Plunge')
    case 'dash':
      return t('teamOpt.timing.kind.dash', 'Dash')
    case 'jump':
      return t('teamOpt.timing.kind.jump', 'Jump')
    case 'wait':
      return t('teamOpt.timing.kind.wait', 'Wait')
  }
}

/**
 * A frame count: typed directly, committed on blur or Enter (each change replays the rotation).
 * Edited values are gold, with the default in their tooltip.
 */
export function FramesInput({
  value,
  defaultValue,
  min,
  onChange,
  label,
  large,
  unit = 'f',
  tip,
}: {
  value: number
  defaultValue: number
  min: number
  onChange: (v: number) => void
  label: string
  large?: boolean
  /** The suffix: f (frames) or ms */
  unit?: string
  /** Replaces the tooltip (frames in seconds, or the default when edited) */
  tip?: string
}) {
  const { t } = useTranslation('page_team')
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const edited = value !== defaultValue
  const commit = () => {
    if (draft === undefined) return
    const n = Math.round(Number(draft))
    setDraft(undefined)
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(Math.max(min, n))
  }
  const input = (
    <InputBase
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(undefined)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(undefined)
          onChange(Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1)))
        }
      }}
      inputProps={{
        inputMode: 'numeric',
        'aria-label': label,
        style: { textAlign: 'right' },
      }}
      endAdornment={
        <Box
          component="span"
          sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}
        >
          {unit}
        </Box>
      }
      sx={(theme) => ({
        width: large ? '100%' : 84,
        maxWidth: large ? 104 : undefined,
        px: 1,
        py: 0,
        borderRadius: 1,
        fontSize: large ? 18 : 14,
        fontWeight: large ? 700 : edited ? 700 : 500,
        fontVariantNumeric: 'tabular-nums',
        color: edited ? 'primary.main' : 'text.primary',
        border: `1px solid ${
          edited
            ? alpha(theme.palette.primary.main, 0.6)
            : alpha(theme.palette.text.primary, 0.14)
        }`,
        bgcolor: edited
          ? alpha(theme.palette.primary.main, 0.08)
          : 'transparent',
        '&.Mui-focused': {
          borderColor: 'primary.main',
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
        },
        '& input': { py: large ? 0.25 : 0.5 },
      })}
    />
  )
  if (tip || unit !== 'f')
    return tip ? (
      <Tooltip arrow placement="left" title={tip}>
        {input}
      </Tooltip>
    ) : (
      input
    )
  return edited ? (
    <Tooltip
      arrow
      placement="left"
      title={t('teamOpt.timing.default', {
        defaultValue: 'Default: {{frames}} frames ({{seconds}} s)',
        frames: defaultValue,
        seconds: seconds(defaultValue),
      })}
    >
      {input}
    </Tooltip>
  ) : (
    <Tooltip
      arrow
      placement="left"
      title={t('teamOpt.timing.inSeconds', {
        defaultValue: '{{seconds}} s',
        seconds: seconds(value),
      })}
    >
      {input}
    </Tooltip>
  )
}
