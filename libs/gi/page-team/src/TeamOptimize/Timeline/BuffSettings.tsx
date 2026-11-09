import { NumberInputLazy } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptBuffSource,
  TeamOptTimedBuff,
} from '@genshin-optimizer/gi/db'
import { useDBGender } from '@genshin-optimizer/gi/db-ui'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  buffRefKey,
  buffSources,
  CharacterName,
  startsOnCast,
} from '@genshin-optimizer/gi/ui'
import BoltIcon from '@mui/icons-material/Bolt'
import {
  alpha,
  Box,
  Button,
  Checkbox,
  InputAdornment,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AttackName } from '../AttackName'
import type { TeamBuff } from '../buffs'
import { MemberAvatar } from '../MemberAvatar'
import type { TeamOptUpdate } from '../useTeamOpt'
import { Loading } from './Loading'
import { useTriggerNames } from './TimedBuffsPanel'

const fmt = (x: number) => `${Math.round(x * 100) / 100}`

/**
 * One timed buff's settings, where its ribbon is: how long it lasts, and what starts it. The
 * engine cannot tell which hits react or land (Instructor: the wearer's reactions; Tenacity: the
 * skill's hits, off-field too): the user ticks the attacks that start it, among the rotation's.
 */
export function BuffSettings({
  anchor,
  onClose,
  timing,
  buff,
  members,
  teamOpt,
  teamData,
  setTeamOpt,
  disabled,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  timing: TeamOptTimedBuff
  buff: TeamBuff | undefined
  members: TeamOptMember[]
  teamOpt: TeamOpt
  teamData: TeamData | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const triggerNames = useTriggerNames()
  const key = buffRefKey(timing)
  const manual = timing.trigger === 'manual'
  const chosen = !!timing.startedBy
  const onCast = startsOnCast(timing)
  // what starts it now (chosen, or found from its trigger)
  const sources = useMemo(
    () =>
      new Set(
        buffSources(timing, teamOpt.attacks).map(
          ({ member, index }) => `${member}:${index}`
        )
      ),
    [timing, teamOpt.attacks]
  )
  const update = (change: (b: TeamOptTimedBuff) => void) =>
    setTeamOpt((o) => {
      const b = o.timeline?.buffs.find((x) => buffRefKey(x) === key)
      if (b) change(b)
    })
  /** The attacks that start it now, as a list to edit */
  const current = (): TeamOptBuffSource[] => {
    const out: TeamOptBuffSource[] = []
    for (const id of sources) {
      const [member, i] = id.split(':') as [CharacterKey, string]
      const attack = teamOpt.attacks[member]?.[Number(i)]
      if (
        attack &&
        !out.some(
          (s) =>
            s.member === member && s.path.join('.') === attack.path.join('.')
        )
      )
        out.push({ member, path: [...attack.path] })
    }
    return out
  }
  const toggle = (member: CharacterKey, path: string[], on: boolean) =>
    update((b) => {
      const list = current().filter(
        (s) => !(s.member === member && s.path.join('.') === path.join('.'))
      )
      if (on) list.push({ member, path: [...path] })
      b.startedBy = list
      // (a buff drawn by hand: now started by these attacks' hits)
      if (b.trigger === 'manual') {
        b.trigger = 'hit'
        delete b.windows
      }
    })
  const setWhen = (cast: boolean) =>
    update((b) => {
      b.startedBy = current()
      if (cast && !startsOnCast(b)) b.trigger = 'skillOrBurst'
      if (!cast && startsOnCast(b)) b.trigger = 'hit'
    })

  const { title, condition } = buff
    ? buff.title
      ? { title: buff.title, condition: buff.label ?? buff.name }
      : { title: buff.label ?? buff.name, condition: undefined }
    : { title: timing.path.join(' · '), condition: undefined }

  return (
    <Popover
      open={!!anchor}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: (theme) => ({
            width: 440,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(640px, calc(100vh - 32px))',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
            boxShadow: `0 18px 48px ${alpha('#000', 0.6)}`,
          }),
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
        <Typography sx={{ fontWeight: 800 }}>
          <Loading width={140}>{title}</Loading>
        </Typography>
        {condition && (
          <Typography variant="caption" color="text.secondary" component="div">
            <Loading width={220}>{condition}</Loading>
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <NumberInputLazy
            float
            size="small"
            label={
              manual
                ? t('teamOpt.timeline.newWindow', 'New window')
                : t('teamOpt.timeline.lasts', 'Lasts')
            }
            value={timing.duration}
            disabled={disabled}
            onChange={(duration) =>
              update((b) => {
                b.duration = Math.max(0.1, duration)
              })
            }
            inputProps={{ min: 0.1, max: 600, sx: { textAlign: 'right' } }}
            InputProps={{
              endAdornment: <InputAdornment position="end">s</InputAdornment>,
            }}
            sx={{ width: 110 }}
          />
          {!manual && (
            <NumberInputLazy
              float
              size="small"
              label={t('teamOpt.timeline.cooldown', 'Cooldown')}
              value={timing.cooldown ?? 0}
              disabled={disabled}
              onChange={(cooldown) =>
                update((b) => {
                  if (cooldown > 0) b.cooldown = cooldown
                  else delete b.cooldown
                })
              }
              inputProps={{ min: 0, max: 600, sx: { textAlign: 'right' } }}
              InputProps={{
                endAdornment: <InputAdornment position="end">s</InputAdornment>,
              }}
              sx={{ width: 110 }}
            />
          )}
        </Box>
      </Box>

      <Box
        sx={(theme) => ({
          px: 2,
          py: 1.25,
          borderTop: `1px solid ${theme.palette.divider}`,
          borderBottom: `1px solid ${theme.palette.divider}`,
          backgroundColor: alpha(theme.palette.primary.main, 0.05),
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <BoltIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="body2" sx={{ fontWeight: 800, flexGrow: 1 }}>
            {t('teamOpt.timeline.starts.title', 'What starts it')}
          </Typography>
          {!manual && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={onCast ? 'cast' : 'hit'}
              disabled={disabled}
              onChange={(_, v: 'cast' | 'hit' | null) =>
                v && setWhen(v === 'cast')
              }
              sx={{
                '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: 12 },
              }}
            >
              <ToggleButton value="hit">
                {t('teamOpt.timeline.starts.eachHit', 'Each hit')}
              </ToggleButton>
              <ToggleButton value="cast">
                {t('teamOpt.timeline.starts.cast', 'When cast')}
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ mt: 0.5 }}
        >
          {manual
            ? t(
                'teamOpt.timeline.starts.manual',
                'Drawn by hand on its ribbon. Or tick the attacks that start it: each of their hits will.'
              )
            : chosen
              ? t(
                  'teamOpt.timeline.starts.chosen',
                  'Started by the attacks you ticked. The engine cannot tell which hits react or land: you know your rotation.'
                )
              : t('teamOpt.timeline.starts.auto', {
                  defaultValue:
                    'Found automatically: {{trigger}}. Tick or untick attacks if your rotation differs (say, which hits really react).',
                  trigger: triggerNames[timing.trigger],
                })}
        </Typography>
      </Box>

      <Box sx={{ overflowY: 'auto', px: 1, py: 1 }}>
        {members.map(({ characterKey }) => {
          const list = teamOpt.attacks[characterKey] ?? []
          if (!list.length) return null
          return (
            <Box key={characterKey} sx={{ mb: 1 }}>
              <MemberLabel characterKey={characterKey} />
              {list.map((attack, index) => {
                const on = sources.has(`${characterKey}:${index}`)
                return (
                  <Box
                    // biome-ignore lint/suspicious/noArrayIndexKey: attacks are kept by position
                    key={index}
                    component="label"
                    sx={(theme) => ({
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      alignItems: 'center',
                      gap: 0.75,
                      px: 0.5,
                      borderRadius: 1.5,
                      cursor: disabled ? 'default' : 'pointer',
                      backgroundColor: on
                        ? alpha(theme.palette.primary.main, 0.1)
                        : undefined,
                      transition: 'background-color 120ms',
                      '&:hover': {
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          on ? 0.16 : 0.06
                        ),
                      },
                    })}
                  >
                    <Checkbox
                      size="small"
                      checked={on}
                      disabled={disabled}
                      onChange={(_, checked) =>
                        toggle(characterKey, attack.path, checked)
                      }
                      sx={{ p: 0.5 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <AttackName
                        data={teamData?.[characterKey]?.target}
                        path={attack.path}
                        oneLine
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {attack.at
                        ? `${fmt(attack.at.start)}–${fmt(attack.at.end)} s · ×${fmt(attack.hits)}`
                        : t('teamOpt.timeline.starts.unplaced', 'not placed')}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>

      {(chosen || !manual) && (
        <Box
          sx={(theme) => ({
            display: 'flex',
            gap: 1,
            justifyContent: 'flex-end',
            px: 1.5,
            py: 1,
            borderTop: `1px solid ${theme.palette.divider}`,
          })}
        >
          {!manual && (
            <Button
              size="small"
              color="inherit"
              disabled={disabled}
              onClick={() =>
                update((b) => {
                  b.trigger = 'manual'
                  delete b.startedBy
                })
              }
              sx={{ color: 'text.secondary' }}
            >
              {t('teamOpt.timeline.starts.drawInstead', 'Draw by hand instead')}
            </Button>
          )}
          {chosen && (
            <Button
              size="small"
              disabled={disabled}
              onClick={() =>
                update((b) => {
                  delete b.startedBy
                })
              }
            >
              {t('teamOpt.timeline.starts.reset', 'Back to automatic')}
            </Button>
          )}
        </Box>
      )}
    </Popover>
  )
}

function MemberLabel({
  characterKey,
}: {
  characterKey: CharacterKey
}): ReactNode {
  const gender = useDBGender()
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.5,
        py: 0.5,
        color: 'text.secondary',
      }}
    >
      <MemberAvatar characterKey={characterKey} size={20} />
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        <CharacterName characterKey={characterKey} gender={gender} />
      </Typography>
    </Box>
  )
}
