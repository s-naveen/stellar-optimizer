import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  RotationAction,
  RotationMember,
  RotationStep,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { parseRotation } from '@genshin-optimizer/gi/ui'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import {
  Box,
  Button,
  ButtonBase,
  Collapse,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { laneColor } from './RotationTimeline'
import { FIRST_ROTATIONS, firstRotations } from './RotationTiming'
import {
  applyWritten,
  editorSx,
  exampleRotation,
  insertWord,
  type RotationWriterHandle,
  saveRotationTiming,
  simulateWritten,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
  WriterQuickRow,
  type WrittenRotation,
  writtenHits,
  writtenSeconds,
} from './RotationWriter'
import {
  FieldLabel,
  focusSx,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

// (Windows has none of the first three: Consolas or Cascadia Mono there)
const mono =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "Liberation Mono", monospace'
const shortcut =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ Enter'
    : 'Ctrl+Enter'

/**
 * The rotation as text, on the page: read as the members' steps, a click to edit it in place, and
 * "Use this rotation" turns it into the team's attacks (the same as the writer dialog, which
 * `writer` opens for the timeline and frame data).
 */
export function RotationInline({
  teamId,
  members,
  setTeamOpt,
  writer,
  replaces,
  disabled,
  kqm,
  kqmBuilds,
}: {
  /** KQM theorycrafting's settings, on its tab: previewed at its constellations, no own gear */
  kqm?: TeamOptKqm
  /** With KQM: the shown result's builds, whose weapon and set effects the preview plays */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  writer: RotationWriterHandle
  /** The team has attacks already: using the text replaces them */
  replaces: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { applied, text, setText, isDraft } = useRotationText(teamId)
  const settings = useRotationSettings(teamId)
  const names = useMemberNames(members)
  const team = useSimTeam(members, kqm, kqmBuilds)
  // (the attacks a rotation leaves on the team are Team optimize's: always the members' own)
  const ownTeam = useSimTeam(members)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)
  // read as steps while it is the rotation in use; a text field while it is written or changed
  const editing = focused || isDraft || !applied.trim()
  // typed and not used yet: played as it is typed (behind the typing)
  const pending = isDraft && !!text.trim()
  // (played once typing pauses: a play takes tens of ms, too long to run on every key)
  const typed = pending ? text : ''
  const [settled, setSettled] = useState(typed)
  // (not while the writer is open: it plays the same text, and this panel is behind it)
  const writing = writer.open
  useEffect(() => {
    if (writing) return
    const timer = setTimeout(
      () => startTransition(() => setSettled(typed)),
      typed ? 220 : 0
    )
    return () => clearTimeout(timer)
  }, [typed, writing])
  const { opener, timing, frameData } = settings
  const play = useMemo(
    () =>
      (value: string, as: typeof team = team) => {
        try {
          return {
            result: simulateWritten({
              text: value,
              opener,
              timing,
              frameData,
              team: as,
              names,
              members,
              database,
              teamId,
              gender,
              openerWarning: (warning) =>
                t('teamOpt.writer.openerWarning', {
                  defaultValue: 'Opener: {{warning}}',
                  warning,
                }),
            }),
          }
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    [
      opener,
      timing,
      frameData,
      team,
      names,
      members,
      database,
      teamId,
      gender,
      t,
    ]
  )
  const played = useMemo(() => play(settled), [play, settled])
  const result: WrittenRotation | undefined = played.result
  const stale = settled !== text
  const warnings = [
    ...new Set([
      ...(played.error ? [played.error] : []),
      ...(result?.sim?.warnings ?? result?.rotation.warnings ?? []),
    ]),
  ]

  const edit = () => {
    if (disabled) return
    setFocused(true)
    requestAnimationFrame(() => {
      const el = inputRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }
  const submit = () => {
    if (disabled || !pending) return
    const now = kqm
      ? play(text, ownTeam).result
      : stale
        ? play(text).result
        : result
    if (!now?.sim) return
    const undo = applyWritten({
      database,
      teamId,
      members,
      setTeamOpt,
      result: now,
      text,
      opener,
      timing,
      frameData,
    })
    if (undo) writer.onApplied(undo)
    inputRef.current?.blur()
    setFocused(false)
  }
  const canUse = pending && (stale || !!result?.sim)
  // a team without attacks or text: the field is the way in (roomy, its words and button shown);
  // attacks made another way: one quiet line until something is typed
  const fresh = !replaces && !text.trim()
  const useLabel = replaces
    ? t('teamOpt.writer.replace', 'Replace rotation')
    : t('teamOpt.writer.apply', 'Use this rotation')

  if (!editing)
    return (
      <ButtonBase
        component="div"
        onClick={edit}
        disabled={disabled}
        aria-label={`${t('teamOpt.writer.edit', 'Edit rotation')}: ${applied}`}
        sx={{
          ...insetSx,
          ...quickSx,
          ...focusSx,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1,
          px: 1.5,
          py: 1,
          minHeight: 44,
          textAlign: 'left',
          cursor: 'text',
          '&:hover': { borderColor: tokens.hairlineStrong },
          '&:hover .rotation-edit, &.Mui-focusVisible .rotation-edit': {
            opacity: 1,
          },
        }}
      >
        <RotationReadout
          text={applied}
          opener={opener}
          first={firstRotations(timing)}
          names={names}
        />
        <EditRoundedIcon
          className="rotation-edit"
          sx={{
            ml: 'auto',
            alignSelf: 'flex-start',
            mt: 0.25,
            fontSize: 16,
            color: 'text.secondary',
            opacity: 0.45,
            flexShrink: 0,
            transition: 'opacity .12s',
          }}
        />
      </ButtonBase>
    )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        multiline
        minRows={fresh ? 2 : 1}
        maxRows={8}
        fullWidth
        value={text}
        disabled={disabled}
        placeholder={exampleRotation(names.map((n) => n.name))}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            inputRef.current?.blur()
          }
        }}
        inputRef={inputRef}
        inputProps={{
          spellCheck: false,
          'aria-label': t('teamOpt.writer.loop', 'Rotation'),
        }}
        sx={editorSx}
      />
      <Collapse in={focused || fresh} timeout={180} unmountOnExit>
        <WriterQuickRow
          members={members}
          onInsert={(word) => insertWord(inputRef.current, text, word, setText)}
        />
      </Collapse>
      {(pending || fresh) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.75,
          }}
        >
          <Box
            role="status"
            sx={{
              ...type.label,
              ...numSx,
              opacity: stale ? 0.55 : 1,
              transition: 'opacity .12s',
            }}
          >
            {result?.sim &&
              `${(writtenSeconds(result) ?? 0).toFixed(1)} s · ${t(
                'teamOpt.writer.hitCount',
                {
                  defaultValue: '{{count}} hits',
                  count: Math.round(writtenHits(result) * 10) / 10,
                }
              )}`}
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {isDraft && !!applied.trim() && (
            <Button
              size="small"
              variant="text"
              color="inherit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setText(applied)}
              disabled={disabled}
              sx={{ color: 'text.secondary', ...quickSx }}
            >
              {t('teamOpt.writer.revertShort', 'Revert')}
            </Button>
          )}
          <Tooltip arrow title={canUse ? shortcut : ''}>
            <span>
              <Button
                size="small"
                variant="contained"
                disabled={disabled || !canUse}
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
                sx={canUse && !disabled ? giCtaSx : undefined}
              >
                {useLabel}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}
      {pending && !!warnings.length && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            opacity: stale ? 0.55 : 1,
          }}
        >
          {warnings.map((w) => (
            <Typography key={w} variant="body2" color="warning.main">
              {w}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** An action as the writer's short code */
const actionCode = (a: RotationAction) => {
  switch (a.kind) {
    case 'skill':
      return `${a.hold ? 'hE' : 'E'}${a.optional ? '?' : ''}`
    case 'burst':
      return a.optional ? 'Q?' : 'Q'
    case 'normal':
      return `N${a.count ?? 1}`
    case 'charged':
      return a.beams ? `CA[beams=${a.beams}]` : 'CA'
    case 'plunge':
      return 'P'
    case 'dash':
      return 'D'
    case 'jump':
      return 'J'
    case 'wait':
      return `W${a.count ?? 0}`
    default:
      return a.text
  }
}

/** The rotation in use, read as its steps: who acts (in their element's colour), then what */
function RotationReadout({
  text,
  opener,
  first,
  names,
}: {
  text: string
  opener: string
  /** Rotations counted from the start (the opener is the first of them), else undefined */
  first?: number
  names: RotationMember[]
}) {
  const { t } = useTranslation('page_team')
  const parsed = useMemo(() => parseRotation(text, names), [text, names])
  const openerSteps = useMemo(
    () => (opener.trim() ? parseRotation(opener, names).steps : []),
    [opener, names]
  )
  const nameOf = (ck: CharacterKey) =>
    names.find((n) => n.characterKey === ck)?.name ?? ck
  // what the reader cannot show as steps is shown as written
  if (parsed.warnings.length || !parsed.steps.length)
    return (
      <Box
        component="span"
        sx={{
          fontFamily: mono,
          fontSize: 14,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minWidth: 0,
        }}
      >
        {text}
      </Box>
    )
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        rowGap: 0.75,
        minWidth: 0,
      }}
    >
      {!!openerSteps.length && (
        <>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1,
              rowGap: 0.5,
            }}
          >
            <Box component="span" sx={type.label}>
              {t('teamOpt.writer.opener', 'First rotation only')}
            </Box>
            {openerSteps.map((step, i) => (
              <Fragment key={i}>
                {i > 0 && <Arrow />}
                <Step
                  step={step}
                  name={nameOf(step.characterKey)}
                  muted={first === undefined}
                />
              </Fragment>
            ))}
          </Box>
          <Box
            aria-hidden
            sx={{ width: '1px', height: 18, bgcolor: tokens.hairlineStrong }}
          />
        </>
      )}
      {/* (the first rotation alone, counted from the start: the rotation is not played) */}
      {parsed.steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <Arrow />}
          <Step
            step={step}
            name={nameOf(step.characterKey)}
            muted={first === 1 && !!openerSteps.length}
          />
        </Fragment>
      ))}
      {parsed.loopsTo && (
        <>
          <Arrow />
          <Tooltip
            arrow
            title={t('teamOpt.writer.loopsTo', {
              defaultValue: 'Loops back to {{name}}',
              name: nameOf(parsed.loopsTo),
            })}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.375,
                color: 'text.secondary',
              }}
            >
              <ReplayRoundedIcon sx={{ fontSize: 15 }} />
              <MemberAvatar characterKey={parsed.loopsTo} size={18} />
            </Box>
          </Tooltip>
        </>
      )}
    </Box>
  )
}

function Arrow() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ color: 'text.secondary', opacity: 0.5, fontSize: 13 }}
    >
      →
    </Box>
  )
}

/** One step: the member, then their actions in the writer's codes */
function Step({
  step,
  name,
  muted,
}: {
  step: RotationStep
  name: string
  muted?: boolean
}) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 0.625,
        rowGap: 0.25,
        minWidth: 0,
        opacity: muted ? 0.7 : 1,
      }}
    >
      <MemberAvatar characterKey={step.characterKey} size={20} />
      {/* (the name and its codes on one baseline: the two fonts sit differently in their boxes,
          so centred they drift apart on some systems, e.g. Consolas on Windows) */}
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          columnGap: 0.625,
          rowGap: 0.25,
          minWidth: 0,
        }}
      >
        <Box
          component="span"
          sx={(theme) => ({
            color: laneColor(theme, step.characterKey),
            fontWeight: 650,
            fontSize: 13.5,
            whiteSpace: 'nowrap',
          })}
        >
          {name}
        </Box>
        {step.actions.map((a, j) => (
          <Box
            key={j}
            component="span"
            sx={{
              fontFamily: mono,
              fontSize: 13.5,
              color: 'text.primary',
              letterSpacing: '0.01em',
            }}
          >
            {actionCode(a)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The rotations Team optimize and KQM count, on the page beside the rotation: the pace it keeps
 * repeating, or the first 1–6 from the start. Changing it plays the rotation in use again with it
 * (Undo as for using a rotation).
 */
export function RotationsSetting({
  teamId,
  members,
  setTeamOpt,
  writer,
  disabled,
}: {
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  writer: RotationWriterHandle
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { applied } = useRotationText(teamId)
  const { opener, timing, frameData } = useRotationSettings(teamId)
  const names = useMemberNames(members)
  // (the attacks a rotation leaves on the team are Team optimize's: the members' own)
  const ownTeam = useSimTeam(members)
  const first = firstRotations(timing)
  const set = (rotations: number | undefined) => {
    const { rotations: _previous, ...rest } = timing
    const next = rotations === undefined ? rest : { ...rest, rotations }
    if (applied.trim()) {
      try {
        const result = simulateWritten({
          text: applied,
          opener,
          timing: next,
          frameData,
          team: ownTeam,
          names,
          members,
          database,
          teamId,
          gender,
          openerWarning: (warning) => warning,
        })
        if (result?.sim) {
          const undo = applyWritten({
            database,
            teamId,
            members,
            setTeamOpt,
            result,
            text: applied,
            opener,
            timing: next,
            frameData,
          })
          if (undo) writer.onApplied(undo)
          return
        }
      } catch {
        // (a rotation that does not play: the setting is still saved)
      }
    }
    saveRotationTiming(teamId, next)
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.timing.rotationsTip',
          'Repeating: the pace the rotation keeps when played over and over, as KQM counts it (a cooldown not ready in time waits). From the start: only the first 1 to 6 rotations, with every cooldown ready at the start, as in a timed challenge. Team optimize and KQM use the same choice.'
        )}
      >
        {t('teamOpt.timing.rotations', 'Rotations')}
      </FieldLabel>
      <Segmented
        size="small"
        aria-label={t('teamOpt.timing.rotations', 'Rotations')}
        value={first === undefined ? 'repeat' : 'start'}
        onChange={(key) => set(key === 'repeat' ? undefined : (first ?? 1))}
        options={[
          {
            value: 'repeat',
            label: t('teamOpt.timing.repeating', 'Repeating'),
            disabled,
          },
          {
            value: 'start',
            label: t('teamOpt.timing.fromStart', 'From the start'),
            disabled,
          },
        ]}
      />
      {first !== undefined && (
        <>
          <Typography component="span" sx={type.label}>
            {t('teamOpt.timing.first', 'First')}
          </Typography>
          <Segmented
            size="small"
            aria-label={t(
              'teamOpt.timing.rotationsFromStart',
              'Rotations from the start'
            )}
            value={String(first)}
            onChange={(key) => set(Number(key))}
            options={FIRST_ROTATIONS.map((n) => ({
              value: String(n),
              label: String(n),
              disabled,
            }))}
          />
        </>
      )}
    </Box>
  )
}
