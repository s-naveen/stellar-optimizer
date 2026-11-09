import { NumberInputLazy } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptBuffTrigger,
  TeamOptTimedBuff,
} from '@genshin-optimizer/gi/db'
import { allTeamOptBuffTriggers } from '@genshin-optimizer/gi/db'
import type { BuffRef, TeamOptMember } from '@genshin-optimizer/gi/ui'
import { buffRefKey } from '@genshin-optimizer/gi/ui'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import GroupsIcon from '@mui/icons-material/Groups'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  alpha,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TeamBuff } from '../buffs'
import { MemberAvatar } from '../MemberAvatar'
import type { TeamOptUpdate } from '../useTeamOpt'
import { Loading } from './Loading'
import { defaultTiming, triggerOf } from './timing'

type TimingChange = (
  timing: TeamOptTimedBuff | undefined
) => TeamOptTimedBuff | undefined

/** Seconds a buff lasts when the game data does not say */
const FALLBACK_DURATION = 10

/** A buff's line: on, whose, its name, then what starts it, how long, its cooldown */
const rowSx = {
  display: 'grid',
  gridTemplateColumns: 'auto 22px minmax(0, 1fr)',
  gridTemplateAreas: '"on who name" ". . fields"',
  alignItems: 'center',
  columnGap: 1,
  rowGap: 0.75,
  px: 1,
  py: 0.5,
  minHeight: 48,
  '@container (min-width: 820px)': {
    gridTemplateColumns: 'auto 22px minmax(0, 1fr) auto',
    gridTemplateAreas: '"on who name fields"',
  },
} as const

/** What starts each kind of trigger, for the select */
export function useTriggerNames(): Record<TeamOptBuffTrigger, string> {
  const { t } = useTranslation('page_team')
  return useMemo(
    () => ({
      burst: t('teamOpt.timeline.trigger.burst', 'Elemental Burst'),
      burstHit: t('teamOpt.timeline.trigger.burstHit', 'Burst hits'),
      skill: t('teamOpt.timeline.trigger.skill', 'Elemental Skill'),
      skillHit: t('teamOpt.timeline.trigger.skillHit', 'Skill hits'),
      skillOrBurst: t(
        'teamOpt.timeline.trigger.skillOrBurst',
        'Skill or Burst'
      ),
      hit: t('teamOpt.timeline.trigger.hit', 'Any hit'),
      normal: t('teamOpt.timeline.trigger.normal', 'Normal Attack hits'),
      charged: t('teamOpt.timeline.trigger.charged', 'Charged Attack hits'),
      plunging: t('teamOpt.timeline.trigger.plunging', 'Plunging Attack hits'),
      reaction: t('teamOpt.timeline.trigger.reaction', 'Reactions'),
      manual: t('teamOpt.timeline.trigger.manual', 'Drawn by hand'),
    }),
    [t]
  )
}

/**
 * The buffs that only last a while: the timed ones (what starts each, how long it lasts, its
 * cooldown), then the ones the game data says run out, then (folded) the team's other buffs.
 */
export function TimedBuffsPanel({
  buffs,
  members,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  buffs: TeamBuff[]
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [showOthers, setShowOthers] = useState(false)
  const timed = useMemo(
    () =>
      new Map((teamOpt.timeline?.buffs ?? []).map((b) => [buffRefKey(b), b])),
    [teamOpt.timeline?.buffs]
  )
  const defaults = useMemo(
    () => new Map(buffs.map((b) => [b.key, defaultTiming(b)])),
    [buffs]
  )
  // (an effect the team cannot have, as a resonance it lacks, is not listed)
  const sections = useMemo(() => {
    const rank = new Map<string, number>(
      members.map((m, i) => [m.characterKey, i])
    )
    const listed = buffs
      .filter((b) => b.inactive !== 'hidden')
      .sort(
        (a, b) =>
          (rank.get(a.ref.owner) ?? members.length) -
          (rank.get(b.ref.owner) ?? members.length)
      )
    return {
      timed: listed.filter((b) => timed.has(b.key)),
      suggested: listed.filter((b) => !timed.has(b.key) && defaults.get(b.key)),
      others: listed.filter((b) => !timed.has(b.key) && !defaults.get(b.key)),
    }
  }, [buffs, members, timed, defaults])
  const triggerNames = useTriggerNames()

  const update = useCallback(
    (ref: BuffRef, change: TimingChange) =>
      setTeamOpt((o) => {
        const list = [...(o.timeline?.buffs ?? [])]
        const key = buffRefKey(ref)
        const i = list.findIndex((b) => buffRefKey(b) === key)
        const next = change(i >= 0 ? list[i] : undefined)
        if (i >= 0) {
          if (next) list[i] = next
          else list.splice(i, 1)
        } else if (next) list.push(next)
        o.timeline = { ...(o.timeline ?? { on: true }), buffs: list }
      }),
    [setTeamOpt]
  )
  const rows = (list: TeamBuff[]) =>
    list.map((buff) => (
      <TimedBuffRow
        key={buff.key}
        buff={buff}
        timing={timed.get(buff.key)}
        fallback={defaults.get(buff.key)}
        triggerNames={triggerNames}
        disabled={disabled}
        onChange={update}
      />
    ))

  return (
    <Box
      sx={(theme) => ({
        containerType: 'inline-size',
        px: 1.5,
        py: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
        backgroundColor: alpha(theme.palette.common.black, 0.12),
      })}
    >
      <Typography variant="body2" color="text.secondary">
        {t(
          'teamOpt.timeline.timedInfo',
          'A timed buff counts only on the hits inside its windows. Turn on the ones that run out during the rotation; their timings come from the game data where it has them.'
        )}
      </Typography>
      {!buffs.length && (
        <Typography variant="body2" color="text.secondary">
          {t(
            'teamOpt.timeline.noBuffs',
            'No buffs are on in the team yet: turn them on in Team settings or on the characters’ tabs.'
          )}
        </Typography>
      )}
      <Section
        title={t('teamOpt.timeline.section.timed', 'Timed')}
        count={sections.timed.length}
      >
        {sections.timed.length ? (
          rows(sections.timed)
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
            {t(
              'teamOpt.timeline.noneTimed',
              'None: every buff counts on every hit, as in List.'
            )}
          </Typography>
        )}
      </Section>
      {!!sections.suggested.length && (
        <Section
          title={t('teamOpt.timeline.section.suggested', 'Run out in the game')}
          count={sections.suggested.length}
          hint={t(
            'teamOpt.timeline.section.suggestedHint',
            'The game data gives these a duration: time them if they are not up the whole rotation.'
          )}
        >
          {rows(sections.suggested)}
        </Section>
      )}
      {!!sections.others.length &&
        (showOthers ? (
          <Section
            title={t('teamOpt.timeline.section.others', 'Other buffs')}
            count={sections.others.length}
            hint={t(
              'teamOpt.timeline.section.othersHint',
              'No duration in the game data: usually up all the time. Time one by hand if it is not.'
            )}
          >
            {rows(sections.others)}
          </Section>
        ) : (
          <Button
            size="small"
            color="inherit"
            startIcon={<ExpandMoreIcon />}
            onClick={() => setShowOthers(true)}
            sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}
          >
            {t('teamOpt.timeline.showOthers', {
              defaultValue: 'Show {{count}} other buffs',
              count: sections.others.length,
            })}
          </Button>
        ))}
    </Box>
  )
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: ReactNode
  count: number
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          mb: 0.5,
          px: 0.5,
        }}
      >
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ lineHeight: 1.6, fontWeight: 700 }}
        >
          {title} · {count}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {hint}
          </Typography>
        )}
      </Box>
      <Box
        sx={(theme) => ({
          borderRadius: 2,
          border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
          '& > * + *': {
            borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          },
        })}
      >
        {children}
      </Box>
    </Box>
  )
}

const TimedBuffRow = memo(function TimedBuffRow({
  buff,
  timing,
  fallback,
  triggerNames,
  disabled,
  onChange,
}: {
  buff: TeamBuff
  timing: TeamOptTimedBuff | undefined
  /** Its timing from the game data, when it has one */
  fallback: TeamOptTimedBuff | undefined
  triggerNames: Record<TeamOptBuffTrigger, string>
  disabled?: boolean
  onChange: (ref: BuffRef, change: TimingChange) => void
}) {
  const { t } = useTranslation('page_team')
  const on = !!timing
  const owner = buff.ref.owner as CharacterKey | 'team'
  const fresh = (): TeamOptTimedBuff =>
    fallback ?? {
      owner: buff.ref.owner,
      path: [...buff.ref.path],
      trigger: triggerOf(buff) ?? 'manual',
      duration: FALLBACK_DURATION,
    }
  const edited =
    !!timing &&
    !!fallback &&
    (timing.trigger !== fallback.trigger ||
      timing.duration !== fallback.duration ||
      (timing.cooldown ?? 0) !== (fallback.cooldown ?? 0))
  const set = (patch: Partial<TeamOptTimedBuff>) =>
    onChange(buff.ref, (current) => {
      const next = { ...(current ?? fresh()), ...patch }
      if (!next.cooldown) delete next.cooldown
      if (next.trigger !== 'manual') delete next.windows
      return next
    })
  const condition = buff.label ?? buff.name
  return (
    <Box sx={rowSx}>
      <Switch
        size="small"
        checked={on}
        disabled={disabled}
        onChange={(_, checked) =>
          onChange(buff.ref, () => (checked ? fresh() : undefined))
        }
        inputProps={{
          'aria-label': t('teamOpt.timeline.timed', 'Timed'),
        }}
        sx={{ gridArea: 'on' }}
      />
      <Box sx={{ gridArea: 'who', display: 'grid', placeItems: 'center' }}>
        {owner === 'team' ? (
          <GroupsIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
        ) : (
          <MemberAvatar characterKey={owner} size={22} />
        )}
      </Box>
      <Box sx={{ gridArea: 'name', minWidth: 0, opacity: on ? 1 : 0.8 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600, lineHeight: 1.35 }}
        >
          <Loading width={140}>{buff.title ?? condition}</Loading>
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          noWrap
          sx={{ lineHeight: 1.35 }}
        >
          {buff.title && <Loading width={200}>{condition}</Loading>}
          {buff.title && !on && fallback && ' · '}
          {!on &&
            fallback &&
            t('teamOpt.timeline.gameData', {
              defaultValue: '{{duration}} s in the game data',
              duration: fallback.duration,
            })}
        </Typography>
      </Box>
      {timing && (
        <Box
          sx={{
            gridArea: 'fields',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <TextField
            select
            size="small"
            label={t('teamOpt.timeline.startsOn', 'Starts on')}
            value={timing.trigger}
            disabled={disabled}
            onChange={(e) =>
              set({ trigger: e.target.value as TeamOptBuffTrigger })
            }
            sx={{ width: 184 }}
          >
            {allTeamOptBuffTriggers.map((trigger) => (
              <MenuItem key={trigger} value={trigger}>
                {triggerNames[trigger]}
              </MenuItem>
            ))}
          </TextField>
          <NumberInputLazy
            float
            size="small"
            label={
              timing.trigger === 'manual'
                ? t('teamOpt.timeline.newWindow', 'New window')
                : t('teamOpt.timeline.lasts', 'Lasts')
            }
            value={timing.duration}
            disabled={disabled}
            onChange={(duration) => set({ duration: Math.max(0.1, duration) })}
            inputProps={{ min: 0.1, max: 600, sx: { textAlign: 'right' } }}
            InputProps={{
              endAdornment: <InputAdornment position="end">s</InputAdornment>,
            }}
            sx={{ width: 96 }}
          />
          <NumberInputLazy
            float
            size="small"
            label={t('teamOpt.timeline.cooldown', 'Cooldown')}
            value={timing.cooldown ?? 0}
            disabled={disabled || timing.trigger === 'manual'}
            onChange={(cooldown) => set({ cooldown })}
            inputProps={{ min: 0, max: 600, sx: { textAlign: 'right' } }}
            InputProps={{
              endAdornment: <InputAdornment position="end">s</InputAdornment>,
            }}
            sx={{
              width: 96,
              visibility: timing.trigger === 'manual' ? 'hidden' : undefined,
            }}
          />
          <Tooltip
            title={
              edited ? t('teamOpt.timeline.reset', 'Back to the game data') : ''
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={disabled || !edited}
                onClick={() => fallback && onChange(buff.ref, () => fallback)}
                aria-label={t(
                  'teamOpt.timeline.reset',
                  'Back to the game data'
                )}
                sx={{ visibility: edited ? undefined : 'hidden' }}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  )
})
