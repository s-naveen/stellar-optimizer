import { NumberInputLazy } from '@genshin-optimizer/common/ui'
import { getUnitStr } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { StatOption, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  StatKeyAutocomplete,
  useStatKeyOptions,
} from '@genshin-optimizer/gi/ui'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { allInputPremodKeys } from '@genshin-optimizer/gi/wr-types'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import {
  Box,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { focusSx, hairline, insetSx, quickSx } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

export const extraStatKeys = [...allInputPremodKeys]

type Target = CharacterKey | 'team'
type Stats = Partial<Record<InputPremodKey, number>>

/** A buff's line: its stat, its value, remove. Same widths on every line, so they line up. */
const rowSx = {
  display: 'grid',
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr) 120px auto',
    sm: 'minmax(0, 320px) 132px auto',
  },
  alignItems: 'center',
  gap: 1,
} as const

/**
 * Buffs the game data does not have (food, an Abyss blessing, a custom bonus), for the whole team
 * or one member: they count on its hits and in its stats, as its own bonus stats do. Each one is a
 * line under who it is for; the last line adds one: for whom, then which stat (its value field
 * then takes the typing).
 */
export function ExtraBuffs({
  members,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const options = useStatKeyOptions(extraStatKeys)
  const [target, setTarget] = useState<Target>('team')
  /** The buff just added: its value field takes the focus */
  const [added, setAdded] = useState<string>()
  const all = teamOpt.bonusStats ?? {}
  const targets: Target[] = ['team', ...members.map((m) => m.characterKey)]
  const listed = targets.filter((key) => Object.keys(all[key] ?? {}).length)
  // (a member who left the team: new buffs go to the whole team)
  const addTo = targets.includes(target) ? target : 'team'
  const update = (key: Target, change: (stats: Stats) => Stats) =>
    setTeamOpt((o) => {
      const stats = change({ ...o.bonusStats?.[key] })
      const next = { ...o.bonusStats }
      if (Object.keys(stats).length) next[key] = stats
      else delete next[key]
      if (Object.keys(next).length) o.bonusStats = next
      else delete o.bonusStats
    })

  return (
    // (its title, count and explanation are on the section that opens it)
    <Box
      sx={{
        ...insetSx,
        p: { xs: 1.25, sm: 1.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      {listed.map((key) => {
        const stats = all[key] ?? {}
        return (
          <Box
            key={key}
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
          >
            <TargetName target={key} />
            {(Object.entries(stats) as [InputPremodKey, number][]).map(
              ([statKey, value]) => (
                <BuffRow
                  key={statKey}
                  options={options}
                  statKey={statKey}
                  value={value}
                  taken={stats}
                  focus={added === `${key}:${statKey}`}
                  disabled={disabled}
                  onStat={(next) =>
                    update(key, (s) =>
                      Object.fromEntries(
                        Object.entries(s).map(([k, v]) => [
                          k === statKey ? next : k,
                          v,
                        ])
                      )
                    )
                  }
                  onValue={(next) =>
                    update(key, (s) => ({ ...s, [statKey]: next }))
                  }
                  onRemove={() =>
                    update(key, (s) => {
                      delete s[statKey]
                      return s
                    })
                  }
                />
              )
            )}
          </Box>
        )
      })}
      {/* the last line adds one: for whom, then which stat */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          ...(listed.length ? { pt: 1.5, borderTop: hairline } : {}),
        }}
      >
        <TextField
          select
          size="small"
          label={t('teamOpt.extra.for', 'For')}
          value={addTo}
          onChange={(e) => setTarget(e.target.value as Target)}
          disabled={disabled}
          sx={{ width: { xs: '100%', sm: 190 } }}
          SelectProps={{
            renderValue: (value) => <TargetName target={value as Target} />,
          }}
        >
          {targets.map((key) => (
            <MenuItem key={key} value={key}>
              <TargetName target={key} />
            </MenuItem>
          ))}
        </TextField>
        <StatKeyAutocomplete
          // (a fresh, empty field after each buff added)
          key={`${addTo}:${Object.keys(all[addTo] ?? {}).length}`}
          options={options}
          valueKey={null}
          label={t('teamOpt.extra.addStat', 'Add a stat')}
          disabled={disabled}
          getOptionDisabled={(option) => option.key in (all[addTo] ?? {})}
          onChange={(statKey) => {
            if (!statKey) return
            update(addTo, (s) => ({ ...s, [statKey]: 0 }))
            setAdded(`${addTo}:${statKey}`)
          }}
          sx={{ flex: '1 1 240px', maxWidth: { sm: 400 } }}
        />
      </Box>
    </Box>
  )
}

/** Who a buff is for: the whole team, or a member (avatar and name) */
function TargetName({ target }: { target: Target }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
    >
      {target === 'team' ? (
        <GroupsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      ) : (
        <MemberAvatar characterKey={target} size={22} />
      )}
      <Typography
        component="span"
        noWrap
        sx={{ fontSize: 13.5, fontWeight: 600 }}
      >
        {target === 'team' ? (
          t('teamOpt.extra.team', 'Whole team')
        ) : (
          <CharacterName characterKey={target} gender={gender} />
        )}
      </Typography>
    </Box>
  )
}

/** A buff: its stat (another one can be picked), its value (with the unit), and remove */
function BuffRow({
  options,
  statKey,
  value,
  taken,
  focus,
  disabled,
  onStat,
  onValue,
  onRemove,
}: {
  options: StatOption[]
  statKey: InputPremodKey
  value: number
  /** The stats this target has already: not to be picked twice */
  taken: Stats
  /** Just added: the value field takes the focus */
  focus: boolean
  disabled?: boolean
  onStat: (statKey: InputPremodKey) => void
  onValue: (value: number) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('page_team')
  const unit = getUnitStr(statKey)
  return (
    <Box sx={rowSx}>
      <StatKeyAutocomplete
        options={options}
        valueKey={statKey}
        disabled={disabled}
        getOptionDisabled={(option) =>
          option.key !== statKey && option.key in taken
        }
        // (clearing the stat removes the buff)
        onChange={(next) => (next ? onStat(next) : onRemove())}
      />
      <Tooltip
        placement="top"
        title={
          value
            ? ''
            : t('teamOpt.extra.zero', 'At 0 it does nothing: enter its value.')
        }
      >
        {/* (the tooltip's handlers go on this box: on the field they would replace its own) */}
        <Box>
          <NumberInputLazy
            value={value}
            float={unit === '%'}
            fullWidth
            autoFocus={focus}
            disabled={disabled}
            onChange={onValue}
            size="small"
            inputProps={{
              sx: { textAlign: 'right' },
              'aria-label': t('teamOpt.extra.value', 'Value'),
            }}
            InputProps={{
              endAdornment: unit ? (
                <InputAdornment position="end" sx={{ ml: 0.5 }}>
                  {unit}
                </InputAdornment>
              ) : undefined,
            }}
            sx={
              value
                ? undefined
                : {
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'warning.main',
                    },
                  }
            }
          />
        </Box>
      </Tooltip>
      <Tooltip title={t('teamOpt.extra.remove', 'Remove')}>
        <span>
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t('teamOpt.extra.remove', 'Remove')}
            sx={{
              color: 'text.secondary',
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'error.main' },
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}
