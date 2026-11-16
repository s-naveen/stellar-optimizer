import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  ActionFrameEdit,
  FrameData,
  FrameKind,
  ParsedRotation,
  SimulationResult,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameKey,
  CharacterName,
  FRAME_ACTIONS,
} from '@genshin-optimizer/gi/ui'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  actionName,
  DEFAULT_SWAP_FRAMES,
  FramesInput,
  frameOverrides,
  type RotationTimingSettings,
  StepTiming,
  swapFramesToPing,
  timingPing,
  withPing,
  withSwapFrames,
} from './RotationTiming'
import { FieldLabel } from './ui'

type ActionDefaults = NonNullable<SimulationResult['actionData']>[CharacterKey]

/** The cancels shown for each action, in the order players think of them */
const CANCELS: FrameKind[] = [
  'normal',
  'charged',
  'skill',
  'burst',
  'dash',
  'jump',
  'swap',
]

/** A cancel's value without its own edit: the kit's, shifted by an edited length */
const cancelDefault = (
  d: { frames: number; framesInto: Partial<Record<FrameKind, number>> },
  k: FrameKind,
  shift: number
) =>
  d.framesInto[k] !== undefined
    ? Math.max(0, d.framesInto[k]! + shift)
    : d.frames + shift

/** Drops the parts of an edit that equal the defaults (an empty edit is no edit) */
function cleanEdit(
  edit: ActionFrameEdit,
  d: { frames: number; framesInto: Partial<Record<FrameKind, number>> }
): ActionFrameEdit | undefined {
  const out: ActionFrameEdit = {}
  if (edit.frames !== undefined && edit.frames !== d.frames)
    out.frames = edit.frames
  const shift = (out.frames ?? d.frames) - d.frames
  if (edit.hitDelay) out.hitDelay = edit.hitDelay
  const into: Partial<Record<FrameKind, number>> = {}
  for (const [k, v] of Object.entries(edit.framesInto ?? {}) as [
    FrameKind,
    number,
  ][])
    if (v !== cancelDefault(d, k, shift)) into[k] = v
  if (Object.keys(into).length) out.framesInto = into
  return Object.keys(out).length ? out : undefined
}

/**
 * The rotation writer's timing inspector: the swap time for everyone (or the ping that sets it),
 * then two tabs: this rotation's steps (each one's frames, for this rotation only; a timeline block
 * opens its step) and each member's frame data for every action (length, cancels into each next
 * action, hit delay; saved for every team). Every change replays the rotation.
 */
export function FrameDataPanel({
  members,
  rotation,
  sim,
  defaults,
  frameData,
  setFrameData,
  timing,
  setTiming,
  tab,
  setTab,
  selectedStep,
  onSelectStep,
}: {
  members: CharacterKey[]
  rotation?: ParsedRotation
  sim?: SimulationResult
  defaults: Partial<Record<CharacterKey, ActionDefaults>>
  frameData: FrameData
  setFrameData: (d: FrameData) => void
  timing: RotationTimingSettings
  setTiming: (s: RotationTimingSettings) => void
  tab: 'steps' | 'characters'
  setTab: (tab: 'steps' | 'characters') => void
  selectedStep?: number
  onSelectStep: (index: number | undefined) => void
}) {
  const { t } = useTranslation('page_team')
  const [selected, setSelected] = useState<CharacterKey>(members[0])
  const [openAction, setOpenAction] = useState<string>()
  const member = members.includes(selected) ? selected : members[0]
  const memberEdited = (m: CharacterKey) =>
    Object.keys(frameData[m] ?? {}).length > 0
  const stepEdits = rotation
    ? Object.keys(frameOverrides(rotation, timing.edits)).length
    : 0
  const anyEdit =
    members.some(memberEdited) ||
    timing.swapFrames !== undefined ||
    timing.rotations !== undefined ||
    stepEdits > 0
  const resetAll = () => {
    const next = { ...frameData }
    for (const m of members) delete next[m]
    setFrameData(next)
    setTiming({ edits: {} })
  }
  const swap = timing.swapFrames ?? DEFAULT_SWAP_FRAMES
  // a step's action, for every rotation: the member's frame data, that action open
  const editCharacter = (characterKey: CharacterKey, actionKey: string) => {
    setSelected(characterKey)
    setOpenAction(actionKey)
    setTab('characters')
  }

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <Box sx={{ px: 2, pt: 1.75, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            component="h3"
            sx={{ fontWeight: 700, fontSize: 16, flexGrow: 1 }}
          >
            {t('teamOpt.frames.title', 'Frame data')}{' '}
            <InfoTooltipInline
              title={t(
                'teamOpt.frames.intro',
                'gcsim’s frame data for each character (60 frames = 1 s). Change any value to match how you play; the rotation time, auras, buffs and hits recalculate. Character edits are saved for every team.'
              )}
            />
          </Typography>
          <Button
            size="small"
            color="inherit"
            startIcon={<RestartAltIcon fontSize="small" />}
            disabled={!anyEdit}
            onClick={resetAll}
            sx={{ color: 'text.secondary' }}
          >
            {t('teamOpt.timing.resetAll', 'Reset all')}
          </Button>
        </Box>
        {/* for everyone: the swap time, or the ping that sets it */}
        <Box
          sx={{
            mt: 1.5,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
          }}
        >
          <Field
            label={t('teamOpt.timing.swap', 'Swap time')}
            tip={t(
              'teamOpt.timing.swapTip',
              'Frames from pressing a character’s key until they are on the field and can act, for every swap. KQM standard: 12 frames.'
            )}
          >
            <FramesInput
              value={swap}
              defaultValue={DEFAULT_SWAP_FRAMES}
              min={0}
              large
              onChange={(v) => setTiming(withSwapFrames(timing, v))}
              label={t('teamOpt.timing.swap', 'Swap time')}
            />
          </Field>
          <Field
            label={t('teamOpt.frames.ping', 'Ping')}
            tip={t(
              'teamOpt.frames.pingTip',
              'Your ping sets the swap time: a swap waits for the server to answer, so it takes about twice your ping (100 ms ≈ 12 frames, KQM standard; 30 ms ≈ 4). Attacks, Skills and Bursts are not delayed by ping.'
            )}
          >
            <FramesInput
              value={timingPing(timing)}
              defaultValue={swapFramesToPing(DEFAULT_SWAP_FRAMES)}
              min={0}
              large
              unit="ms"
              onChange={(v) => setTiming(withPing(timing, Math.min(1000, v)))}
              label={t('teamOpt.frames.ping', 'Ping')}
              tip={t('teamOpt.frames.pingSwap', {
                defaultValue: 'A {{frames}}-frame swap',
                frames: swap,
              })}
            />
          </Field>
        </Box>
        {timing.swapFrames !== undefined && (
          <Button
            size="small"
            color="inherit"
            onClick={() =>
              setTiming(withSwapFrames(timing, DEFAULT_SWAP_FRAMES))
            }
            sx={{ mt: 0.5, color: 'text.secondary', textTransform: 'none' }}
          >
            {t(
              'teamOpt.frames.useKqmSwap',
              'Use KQM standard (12 frames, about 100 ms)'
            )}
          </Button>
        )}
      </Box>

      {/* this rotation's steps, or each member's frame data */}
      <Box
        role="tablist"
        aria-label={t('teamOpt.frames.title', 'Frame data')}
        sx={(theme) => ({
          display: 'flex',
          gap: 2,
          px: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
        })}
      >
        {(
          [
            [
              'steps',
              t('teamOpt.frames.stepsTab', 'This rotation'),
              stepEdits > 0,
              t(
                'teamOpt.frames.stepsHint',
                'When each action starts; change one step without changing the character'
              ),
            ],
            [
              'characters',
              t('teamOpt.frames.charactersTab', 'Characters'),
              members.some(memberEdited),
              t(
                'teamOpt.frames.charactersHint',
                'Each character’s frames for every action, saved for every team'
              ),
            ],
          ] as const
        ).map(([key, label, dot, tip]) => (
          <Tooltip key={key} arrow title={tip} enterDelay={600}>
            <ButtonBase
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              sx={(theme) => ({
                py: 1,
                fontSize: 13.5,
                fontWeight: 600,
                color: tab === key ? 'text.primary' : 'text.secondary',
                boxShadow:
                  tab === key
                    ? `inset 0 -2px 0 ${theme.palette.primary.main}`
                    : 'none',
                transition: 'color .15s',
                '&:hover': { color: 'text.primary' },
              })}
            >
              {label}
              {dot && <EditDot />}
            </ButtonBase>
          </Tooltip>
        ))}
      </Box>

      <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {tab === 'steps' ? (
          rotation && sim ? (
            <StepTiming
              rotation={rotation}
              sim={sim}
              settings={timing}
              setSettings={setTiming}
              selected={selectedStep}
              onSelect={onSelectStep}
              onEditCharacter={editCharacter}
            />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {t(
                'teamOpt.frames.noSteps',
                'Write a rotation to see its steps.'
              )}
            </Typography>
          )
        ) : (
          <>
            <Box
              role="tablist"
              aria-label={t('teamOpt.frames.members', 'Characters')}
              sx={{
                display: 'flex',
                gap: 0.5,
                px: 1.5,
                pt: 1.25,
                pb: 0.5,
                overflowX: 'auto',
              }}
            >
              {members.map((m) => (
                <ButtonBase
                  key={m}
                  role="tab"
                  aria-selected={m === member}
                  onClick={() => setSelected(m)}
                  sx={(theme) => ({
                    gap: 0.75,
                    pl: 0.5,
                    pr: 1.25,
                    py: 0.5,
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color: m === member ? 'text.primary' : 'text.secondary',
                    bgcolor:
                      m === member
                        ? alpha(theme.palette.primary.main, 0.14)
                        : 'transparent',
                    boxShadow:
                      m === member
                        ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.5)}`
                        : 'none',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.text.primary, 0.06),
                    },
                  })}
                >
                  <MemberAvatar characterKey={m} size={24} />
                  <CharacterNameShort characterKey={m} />
                  {memberEdited(m) && <EditDot />}
                </ButtonBase>
              ))}
            </Box>
            <CharacterFrames
              characterKey={member}
              defaults={defaults[member]}
              edits={frameData[member] ?? {}}
              open={openAction}
              setOpen={setOpenAction}
              used={
                new Set([
                  ...[...(rotation?.opener ?? []), ...(rotation?.steps ?? [])]
                    .filter((s) => s.characterKey === member)
                    .flatMap((s) => s.actions.map((a) => actionFrameKey(a))),
                  // (with the versions its kit played: Spirit Steed's Stride…)
                  ...(sim?.actions ?? [])
                    .filter((a) => a.characterKey === member && a.frameKey)
                    .map((a) => a.frameKey!),
                ])
              }
              setEdits={(edits) =>
                setFrameData({
                  ...frameData,
                  [member]: Object.keys(edits).length ? edits : undefined,
                })
              }
            />
          </>
        )}
      </Box>
    </Box>
  )
}

/** A labelled setting on its own surface (the label explains itself on hover) */
function Field({
  label,
  tip,
  children,
}: {
  label: string
  tip: string
  children: React.ReactNode
}) {
  return (
    <Box
      sx={(theme) => ({
        px: 1.25,
        py: 0.875,
        borderRadius: 1.5,
        bgcolor: alpha(theme.palette.text.primary, 0.04),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
        '& .MuiInputBase-root': { maxWidth: 'none' },
      })}
    >
      <Label tip={tip}>{label}</Label>
      {children}
    </Box>
  )
}

/** One member's frame data: every action's length and hit delay, its cancels on demand */
function CharacterFrames({
  characterKey,
  defaults,
  edits,
  used,
  setEdits,
  open,
  setOpen,
}: {
  characterKey: CharacterKey
  defaults: ActionDefaults | undefined
  edits: Record<string, ActionFrameEdit>
  used: Set<string>
  setEdits: (e: Record<string, ActionFrameEdit>) => void
  open: string | undefined
  setOpen: (key: string | undefined) => void
}) {
  const { t } = useTranslation('page_team')
  // each action, then the versions a mode or stance makes of it (Spirit Steed's Stride after E)
  const rows = FRAME_ACTIONS.flatMap((action) => {
    const key = actionFrameKey(action)
    const versions = Object.entries(defaults ?? {})
      .filter(([k, d]) => k.startsWith(`${key}@`) && d.variant)
      .map(([k, d]) => ({ action, key: k, variant: d.variant }))
    return [
      ...(defaults?.[key] ? [{ action, key, variant: undefined }] : []),
      ...versions,
    ]
  })
  // an action opened from a step: bring it into view
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() =>
      document
        .getElementById(`frames-${characterKey}-${open}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }, [open, characterKey])
  const update = (key: string, edit: ActionFrameEdit) => {
    const next = { ...edits }
    const cleaned = cleanEdit(edit, defaults![key]!)
    if (cleaned) next[key] = cleaned
    else delete next[key]
    setEdits(next)
  }
  if (!defaults)
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t(
          'teamOpt.frames.noKit',
          'No frame data for this character yet: their actions are not simulated.'
        )}
      </Typography>
    )
  const grid = 'minmax(0, 1fr) 84px 84px 28px'
  return (
    <Box sx={{ pb: 1 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: grid,
          columnGap: 1,
          alignItems: 'center',
          px: 2,
          pt: 1,
          pb: 0.5,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('teamOpt.timing.action', 'Action')}
        </Typography>
        <Label
          align="right"
          tip={t(
            'teamOpt.frames.lengthTip',
            'How long the action takes. Changing it moves all its cancels by the same amount. Open an action (▾) to set each cancel on its own.'
          )}
        >
          {t('teamOpt.frames.length', 'Length')}
        </Label>
        <Label
          align="right"
          tip={t(
            'teamOpt.frames.hitDelayTip',
            'Frames added before each of the action’s hits lands (travel time, a later hitmark). The next action is not delayed.'
          )}
        >
          {t('teamOpt.frames.hitDelay', 'Hit delay')}
        </Label>
        <span />
      </Box>
      {rows.map(({ action, key, variant }) => {
        const d = defaults[key]!
        const name = variant?.label ?? actionName(t, action)
        const e = edits[key] ?? {}
        const cancelEdits = Object.keys(e.framesInto ?? {}).length
        const isOpen = open === key
        return (
          <Fragment key={key}>
            <Box
              id={`frames-${characterKey}-${key}`}
              sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: grid,
                columnGap: 1,
                alignItems: 'center',
                minHeight: 40,
                px: 2,
                scrollMarginTop: 8,
                bgcolor: isOpen
                  ? alpha(theme.palette.text.primary, 0.04)
                  : 'transparent',
                // the actions this rotation uses: a bar on the left
                boxShadow: used.has(key)
                  ? `inset 2px 0 0 ${alpha(theme.palette.primary.main, 0.7)}`
                  : 'none',
              })}
            >
              <Typography
                variant="body2"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12,
                    color: 'text.secondary',
                    minWidth: 22,
                    flexShrink: 0,
                  }}
                >
                  {action.text}
                </Box>
                <Box
                  component="span"
                  title={
                    variant?.mode
                      ? `${name} (${t('teamOpt.frames.inMode', {
                          defaultValue: 'in {{mode}}',
                          mode: variant.mode,
                        })})`
                      : name
                  }
                  sx={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                  {variant?.mode && (
                    <Box
                      component="span"
                      sx={{ ml: 0.75, fontSize: 12, color: 'text.secondary' }}
                    >
                      {t('teamOpt.frames.inMode', {
                        defaultValue: 'in {{mode}}',
                        mode: variant.mode,
                      })}
                    </Box>
                  )}
                </Box>
                {used.has(key) && (
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                    }}
                  >
                    {t('teamOpt.frames.used', 'Used in this rotation')}
                  </Box>
                )}
              </Typography>
              <FramesInput
                value={e.frames ?? d.frames}
                defaultValue={d.frames}
                min={1}
                onChange={(v) => update(key, { ...e, frames: v })}
                label={`${name} ${t('teamOpt.frames.length', 'Length')}`}
              />
              <FramesInput
                value={e.hitDelay ?? 0}
                defaultValue={0}
                min={0}
                onChange={(v) => update(key, { ...e, hitDelay: v })}
                label={`${name} ${t('teamOpt.frames.hitDelay', 'Hit delay')}`}
              />
              <Tooltip
                arrow
                title={t('teamOpt.frames.cancels', {
                  defaultValue: 'Cancels',
                })}
              >
                <IconButton
                  size="small"
                  onClick={() => setOpen(isOpen ? undefined : key)}
                  aria-expanded={isOpen}
                  aria-label={`${name} ${t('teamOpt.frames.cancels', 'Cancels')}`}
                  sx={{
                    p: 0.25,
                    position: 'relative',
                    color: cancelEdits ? 'primary.main' : 'text.secondary',
                  }}
                >
                  <ExpandMoreIcon
                    sx={{
                      fontSize: 20,
                      transition: 'transform .15s',
                      transform: isOpen ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </IconButton>
              </Tooltip>
            </Box>
            <Collapse in={isOpen} unmountOnExit>
              <Box
                sx={(theme) => ({
                  px: 2,
                  pt: 0.5,
                  pb: 1.25,
                  bgcolor: alpha(theme.palette.text.primary, 0.04),
                })}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mb: 0.75, display: 'flex', alignItems: 'center' }}
                >
                  {t('teamOpt.frames.cancelsInto', 'Cancels into')}
                  <InfoTooltipInline
                    title={t(
                      'teamOpt.frames.cancelsHint',
                      'Frames until each next action can start. Greyed ones have no cancel of their own and wait the full length.'
                    )}
                  />
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    columnGap: 1.5,
                    rowGap: 0.75,
                  }}
                >
                  {CANCELS.map((k) => {
                    const def = cancelDefault(
                      d,
                      k,
                      (e.frames ?? d.frames) - d.frames
                    )
                    const own = d.framesInto[k] !== undefined
                    return (
                      <Box
                        key={k}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1,
                        }}
                      >
                        <Typography
                          variant="body2"
                          color={own ? 'text.primary' : 'text.secondary'}
                          noWrap
                        >
                          {cancelName(t, k)}
                        </Typography>
                        <FramesInput
                          value={e.framesInto?.[k] ?? def}
                          defaultValue={def}
                          min={0}
                          onChange={(v) =>
                            update(key, {
                              ...e,
                              framesInto: { ...e.framesInto, [k]: v },
                            })
                          }
                          label={`${name} → ${cancelName(t, k)}`}
                        />
                      </Box>
                    )
                  })}
                </Box>
                {(e.frames !== undefined || e.hitDelay || cancelEdits > 0) && (
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<RestartAltIcon fontSize="small" />}
                    onClick={() => {
                      const next = { ...edits }
                      delete next[key]
                      setEdits(next)
                    }}
                    sx={{ mt: 1, color: 'text.secondary' }}
                  >
                    {t('teamOpt.frames.resetAction', {
                      defaultValue: 'Reset {{action}}',
                      action: name,
                    })}
                  </Button>
                )}
              </Box>
            </Collapse>
          </Fragment>
        )
      })}
      {Object.keys(edits).length > 0 && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Button
            size="small"
            color="inherit"
            startIcon={<RestartAltIcon fontSize="small" />}
            onClick={() => setEdits({})}
            sx={{ color: 'text.secondary' }}
          >
            {t('teamOpt.frames.resetCharacter', 'Reset this character')}
          </Button>
        </Box>
      )}
    </Box>
  )
}

function cancelName(
  t: ReturnType<typeof useTranslation>['t'],
  k: FrameKind
): string {
  switch (k) {
    case 'normal':
      return t('teamOpt.frames.into.normal', 'Normal attack')
    case 'charged':
      return t('teamOpt.frames.into.charged', 'Charged')
    case 'skill':
      return t('teamOpt.frames.into.skill', 'Skill')
    case 'burst':
      return t('teamOpt.frames.into.burst', 'Burst')
    case 'dash':
      return t('teamOpt.frames.into.dash', 'Dash')
    case 'jump':
      return t('teamOpt.frames.into.jump', 'Jump')
    case 'swap':
      return t('teamOpt.frames.into.swap', 'Swap')
    default:
      return k
  }
}

/** A small caption with an explanation on hover (dotted underline) */
function Label({
  tip,
  align,
  children,
}: {
  tip: string
  align?: 'right'
  children: React.ReactNode
}) {
  return (
    <Box sx={{ textAlign: align, minWidth: 0, lineHeight: 1 }}>
      <FieldLabel tip={tip} sx={{ fontSize: 12 }}>
        {children}
      </FieldLabel>
    </Box>
  )
}

function EditDot() {
  const { t } = useTranslation('page_team')
  return (
    <Box
      component="span"
      title={t('teamOpt.timing.edited', 'Edited')}
      sx={{
        display: 'inline-block',
        ml: 0.75,
        width: 6,
        height: 6,
        borderRadius: '50%',
        bgcolor: 'primary.main',
        verticalAlign: 'middle',
      }}
    />
  )
}

function CharacterNameShort({ characterKey }: { characterKey: CharacterKey }) {
  const { gender } = useDBMeta()
  return <CharacterName characterKey={characterKey} gender={gender} />
}
