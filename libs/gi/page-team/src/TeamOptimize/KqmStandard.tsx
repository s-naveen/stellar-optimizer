import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allKqmStandardKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import type { KqmStandard } from '@genshin-optimizer/gi/solver'
import { KQM_CUSTOM_ROLLS, kqmStandardOf } from '@genshin-optimizer/gi/solver'
import { kqmMemberStandard } from '@genshin-optimizer/gi/ui'
import {
  Box,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldLabel, numSx, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/*
 * The artifact standard: KQM Standards (2 fixed rolls of every substat and 20 placed), a tier
 * built piece by piece as the game makes artifacts, up to Perfect, the best the game can make, or
 * Custom: how many of the set's 45 rolls land on wanted stats, typed in per member
 */

/** A standard's name (Custom with its wanted rolls) */
export function kqmStandardName(t: TFunction, standard: KqmStandard) {
  if (typeof standard === 'number')
    return t('teamOpt.kqm.customNamed', {
      defaultValue: 'Custom ({{rolls}})',
      rolls: standard,
    })
  switch (standard) {
    case 'good':
      return t('teamOpt.kqm.tierGood', 'Good')
    case 'great':
      return t('teamOpt.kqm.tierGreat', 'Great')
    case 'top':
      return t('teamOpt.kqm.tierTop', 'Top')
    case 'perfect':
      return t('teamOpt.kqm.tierPerfect', 'Perfect')
    default:
      return t('teamOpt.kqm.standard20', 'KQM Standard')
  }
}
/** A standard's name in a member's row: KQMS for KQM Standard */
const kqmStandardShort = (t: TFunction, standard: KqmStandard) =>
  standard === 'kqms'
    ? t('teamOpt.kqm.standard20Short', 'KQMS')
    : kqmStandardName(t, standard)
/** What a standard's artifacts are, in a line */
export function kqmStandardDetail(t: TFunction, standard: KqmStandard) {
  if (typeof standard === 'number')
    return t('teamOpt.kqm.customDetail', {
      defaultValue:
        '{{rolls}} of the set’s 45 rolls on wanted stats, the rest random · average rolls',
      rolls: standard,
    })
  switch (standard) {
    case 'good':
      return t(
        'teamOpt.kqm.tierGoodDetail',
        '8 rolls a piece: 2 of its 4 lines on wanted stats, 3 of its 4 upgrades on them · average rolls, substat CV up to 182'
      )
    case 'great':
      return t(
        'teamOpt.kqm.tierGreatDetail',
        '9 rolls a piece: 3 of its 4 lines on wanted stats, 4 of its 5 upgrades on them · average rolls, substat CV up to 215'
      )
    case 'top':
      return t(
        'teamOpt.kqm.tierTopDetail',
        '9 rolls a piece: every line on a wanted stat, every upgrade on them · average rolls, substat CV up to 232'
      )
    case 'perfect':
      return t(
        'teamOpt.kqm.tierPerfectDetail',
        'Top with every roll at its highest value: the best the game can make · substat CV up to 272'
      )
    default:
      return t(
        'teamOpt.kqm.tierKqmsDetail',
        '2 rolls of every substat and 20 placed, at most 2 a piece per stat · average rolls, substat CV up to 159'
      )
  }
}

/** The members' standards, in their order */
const memberStandards = (
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) => keys.map((k) => kqmMemberStandard(k, kqm))

/** Whether the members' artifact standards differ */
export function kqmStandardsMixed(
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) {
  const all = memberStandards(kqm, keys)
  return all.some((s) => s !== all[0])
}

/** The members' standard by name, or Mixed when they differ */
export function kqmStandardText(
  t: TFunction,
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) {
  return kqmStandardsMixed(kqm, keys)
    ? t('teamOpt.kqm.standardMixed', 'Mixed')
    : kqmStandardName(
        t,
        keys.length
          ? kqmMemberStandard(keys[0], kqm)
          : kqmStandardOf(kqm?.standard)
      )
}

/**
 * Custom's wanted rolls closest to a standard (KQMS about 20; Good's split on 9-roll pieces 25,
 * Great 35, Top 45): where its box starts
 */
const customRollsFor = (standard: KqmStandard) =>
  typeof standard === 'number'
    ? standard
    : ({ kqms: 20, good: 25, great: 35, top: 45, perfect: 45 } as const)[
        standard
      ]

/** Whether the standards are typed in, one box per member: Custom was picked, or a member is at one */
export function useKqmCustom(
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) {
  const typed = memberStandards(kqm, keys).some((s) => typeof s === 'number')
  const [picked, setPicked] = useState(typed)
  return [picked || typed, setPicked] as const
}

/** Every member at `standard` */
function setAllStandards(o: TeamOpt, standard: KqmStandard) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  settings.standard = standard === 'kqms' ? undefined : standard
  settings.memberStandards = undefined
}
/** One member at `standard` (all the same again: one standard for the team) */
function setMemberStandard(
  o: TeamOpt,
  keys: readonly CharacterKey[],
  characterKey: CharacterKey,
  standard: KqmStandard
) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  const next = {
    ...settings,
    memberStandards: { ...settings.memberStandards, [characterKey]: standard },
  }
  const all = memberStandards(next, keys)
  if (all.every((s) => s === all[0])) setAllStandards(o, all[0])
  else settings.memberStandards = next.memberStandards
}
/** Custom for every member, each at the wanted rolls closest to its standard */
function setAllCustom(o: TeamOpt, keys: readonly CharacterKey[]) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  const all = memberStandards(settings, keys).map(customRollsFor)
  if (all.every((n) => n === all[0])) setAllStandards(o, all[0] ?? 20)
  else {
    settings.standard = undefined
    settings.memberStandards = Object.fromEntries(
      keys.map((k, i) => [k, all[i]])
    )
  }
}

const CUSTOM = 'custom'
const MIXED = 'mixed'
const validCustom = (n: number) =>
  Number.isInteger(n) && n >= KQM_CUSTOM_ROLLS.min && n <= KQM_CUSTOM_ROLLS.max

/** The standards with what each one's artifacts are, then Custom: a standard menu's items */
function standardItems(t: TFunction) {
  const item = (value: string, name: string, detail: string) => (
    <MenuItem
      key={value}
      value={value}
      sx={{ display: 'block', maxWidth: 360, whiteSpace: 'normal' }}
    >
      <Box component="span" sx={{ display: 'block' }}>
        {name}
      </Box>
      <Box component="span" sx={{ ...type.label, display: 'block' }}>
        {detail}
      </Box>
    </MenuItem>
  )
  return [
    ...allKqmStandardKeys.map((standard) =>
      item(
        standard,
        kqmStandardName(t, standard),
        kqmStandardDetail(t, standard)
      )
    ),
    item(
      CUSTOM,
      t('teamOpt.kqm.standardCustom', 'Custom'),
      t('teamOpt.kqm.customItemDetail', {
        defaultValue:
          'Type how many of each member’s 45 rolls land on wanted stats, {{min}} to {{max}}',
        ...KQM_CUSTOM_ROLLS,
      })
    ),
  ]
}

/** The artifact standard for every member at once (Mixed while they differ) */
export function KqmArtifactStandard({
  kqm,
  members,
  custom,
  setCustom,
  setTeamOpt,
}: {
  kqm: TeamOptKqm | undefined
  members: readonly CharacterKey[]
  /** The standards are typed in, per member (`useKqmCustom`) */
  custom: boolean
  setCustom: (custom: boolean) => void
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const mixed = kqmStandardsMixed(kqm, members)
  const standard = members.length
    ? kqmMemberStandard(members[0], kqm)
    : kqmStandardOf(kqm?.standard)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.standardAllTipCustom',
          'Sets every member’s artifacts; each can be changed in its row. KQM Standard is KQM’s own: 2 rolls of every substat and 20 placed for damage, at most 2 a piece per stat. Good, Great, Top and Perfect are this site’s: each piece is built as the game makes one (4 different lines, never its main stat, and 4 or 5 upgrades), with more of its lines and upgrades on the stats the build wants at each step. Perfect is the best five artifacts the game can make. Custom: type how many of a member’s 45 rolls land on wanted stats (each piece an even share, the rest random). A 4★ piece has 2 fewer rolls, each 0.8 of a 5★ one. Every roll is KQM’s average roll value (crit rate 3.31%, crit DMG 6.62%), except Perfect’s, at the highest. Substat CV: the most crit value the substats can reach, the circlet’s main stat not counted. With a crit circlet, add its 62.2 and take a little off the substats (fewer crit lines fit): Great is 207 + 62 = 269 CV.'
        )}
      >
        {t('teamOpt.kqm.standard', 'Artifacts')}
      </FieldLabel>
      <TextField
        select
        size="small"
        value={custom ? CUSTOM : mixed ? MIXED : standard}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            setTeamOpt((o) => setAllCustom(o, members))
            return
          }
          setCustom(false)
          setTeamOpt((o) => setAllStandards(o, kqmStandardOf(e.target.value)))
        }}
        SelectProps={{
          renderValue: (v) =>
            v === CUSTOM
              ? t('teamOpt.kqm.standardCustom', 'Custom')
              : v === MIXED
                ? t('teamOpt.kqm.standardMixed', 'Mixed')
                : kqmStandardName(t, kqmStandardOf(v)),
        }}
        inputProps={{
          'aria-label': t(
            'teamOpt.kqm.standardAll',
            'Every member’s artifacts'
          ),
        }}
        sx={{
          minWidth: 150,
          '& .MuiInputBase-root': { fontSize: 13 },
          '& .MuiSelect-select': { py: 0.5 },
        }}
      >
        {standardItems(t)}
        <MenuItem value={MIXED} sx={{ display: 'none' }} />
      </TextField>
    </Box>
  )
}

/** A member's artifact standard in its row: a named one, or its wanted rolls typed in (Custom) */
export function KqmMemberStandard({
  characterKey,
  members,
  kqm,
  custom,
  setCustom,
  setTeamOpt,
}: {
  characterKey: CharacterKey
  members: readonly CharacterKey[]
  kqm: TeamOptKqm | undefined
  custom: boolean
  setCustom: (custom: boolean) => void
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const standard = kqmMemberStandard(characterKey, kqm)
  const rolls = customRollsFor(standard)
  const [text, setText] = useState(`${rolls}`)
  useEffect(() => setText(`${rolls}`), [rolls])
  const label = t('teamOpt.kqm.memberArtifacts', {
    defaultValue: '{{character}} artifacts',
    character: characterKey,
  })
  if (!custom)
    return (
      <TextField
        select
        size="small"
        fullWidth
        value={standard}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            setTeamOpt((o) => setAllCustom(o, members))
            return
          }
          setTeamOpt((o) =>
            setMemberStandard(
              o,
              members,
              characterKey,
              kqmStandardOf(e.target.value)
            )
          )
        }}
        SelectProps={{
          renderValue: (v) => kqmStandardShort(t, kqmStandardOf(v)),
        }}
        inputProps={{ 'aria-label': label }}
        sx={{
          '& .MuiInputBase-root': { fontSize: 14 },
          '& .MuiSelect-select': { py: 0.875, ...numSx },
        }}
      >
        {standardItems(t)}
      </TextField>
    )
  const invalid = !validCustom(Number(text))
  return (
    <Tooltip
      arrow
      title={
        invalid
          ? t('teamOpt.kqm.standardRange', {
              defaultValue: '{{min}} to {{max}}',
              ...KQM_CUSTOM_ROLLS,
            })
          : kqmStandardDetail(t, rolls)
      }
    >
      <TextField
        size="small"
        fullWidth
        value={text}
        error={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (validCustom(n))
            setTeamOpt((o) => setMemberStandard(o, members, characterKey, n))
        }}
        inputProps={{
          inputMode: 'numeric',
          'aria-label': t('teamOpt.kqm.memberRollsInput', {
            defaultValue: '{{character}} artifact rolls',
            character: characterKey,
          }),
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Box component="span" sx={type.label}>
                {t('teamOpt.kqm.wantedUnit', 'wanted')}
              </Box>
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiInputBase-root': { fontSize: 14, px: { xs: 1, sm: 1.25 } },
          '& .MuiInputBase-input': {
            py: 0.875,
            px: 0,
            textAlign: 'right',
            ...numSx,
          },
        }}
      />
    </Tooltip>
  )
}
