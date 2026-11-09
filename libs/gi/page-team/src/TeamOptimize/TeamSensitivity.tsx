import { CardThemed, InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBGender } from '@genshin-optimizer/gi/db-ui'
import type {
  SensitivityLevel,
  SensitivityTalent,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  sensitivityLevels,
  sensitivitySubstats,
  sensitivityTalents,
  teamOptMembers,
  teamSensitivity,
} from '@genshin-optimizer/gi/ui'
import type { Theme } from '@mui/material'
import { alpha, Box, Button, Skeleton, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'

type RowId =
  | `sub:${SubstatKey}`
  | `talent:${SensitivityTalent}`
  | `level:${SensitivityLevel}`
/** Per member and row: the team's damage change (0.0105 for +1.05%); null when it cannot be */
type Cells = Partial<
  Record<CharacterKey, Partial<Record<RowId, number | null>>>
>
interface Sensitivity {
  cells: Cells
  done: boolean
}

// computed once per result and rotation (results are new objects per run)
const cache = new WeakMap<TeamOptResult, { key: string; value: Sensitivity }>()

/** Runs `fn` when the page is idle (a timeout where idle callbacks are missing) */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 400 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 16)
  return () => clearTimeout(id)
}

/**
 * What each change to each member is worth to the team (see `teamSensitivity`): computed after the
 * result arrives, one change at a time while the page is idle, so the cells fill in as they come.
 */
function useTeamSensitivity(
  teamId: string,
  teamOpt: TeamOpt,
  result: TeamOptResult
) {
  const database = useDatabase()
  const gender = useDBGender()
  // what the cells depend on besides the result
  const key = JSON.stringify([
    teamOpt.attacks,
    teamOpt.timeline ?? null,
    teamOpt.rotationTime ?? 0,
    teamOpt.onField ?? '',
    teamOpt.bonusStats ?? {},
    teamOpt.assumeMaxMain,
  ])
  const [value, setValue] = useState<Sensitivity>(() => {
    const hit = cache.get(result)
    return hit?.key === key ? hit.value : { cells: {}, done: false }
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the parts of `teamOpt` read
  useEffect(() => {
    const hit = cache.get(result)
    if (hit?.key === key && hit.value.done) {
      setValue(hit.value)
      return undefined
    }
    let cancelled = false
    let cancel = () => undefined as void
    const cells: Cells = {}
    let sensitivity: ReturnType<typeof teamSensitivity> | undefined
    const set = (
      member: TeamOptMember,
      row: RowId,
      total: number | undefined
    ) => {
      const base = sensitivity?.base
      cells[member.characterKey] = {
        ...cells[member.characterKey],
        [row]: total === undefined || !base ? null : total / base - 1,
      }
    }
    const members = teamOptMembers(database, teamId)
    const tasks: (() => void)[] = [
      () => {
        sensitivity = teamSensitivity(database, teamId, gender, teamOpt, result)
      },
      // the substat rolls first: one compiled problem per member, all ten rolls at once
      ...members.map((member) => () => {
        const totals = sensitivity?.substats(member) ?? {}
        for (const key of sensitivitySubstats)
          set(member, `sub:${key}`, totals[key])
      }),
      ...members.flatMap((member) =>
        sensitivityTalents.map(
          (talent) => () =>
            set(
              member,
              `talent:${talent}`,
              sensitivity?.character(member, { talent })
            )
        )
      ),
      ...members.flatMap((member) =>
        sensitivityLevels.map(
          (level) => () =>
            set(
              member,
              `level:${level}`,
              sensitivity?.character(member, { level })
            )
        )
      ),
    ]
    let i = 0
    const next = () => {
      if (cancelled) return
      tasks[i++]()
      const done = i >= tasks.length
      const value = { cells: { ...cells }, done }
      if (done) cache.set(result, { key, value })
      setValue(value)
      if (!done) cancel = whenIdle(next)
    }
    setValue({ cells: {}, done: false })
    cancel = whenIdle(next)
    return () => {
      cancelled = true
      cancel()
    }
  }, [database, teamId, gender, key, result])
  return value
}

const percentKeys = ['hp_', 'atk_', 'def_']
const formatChange = (value: number) =>
  `${value < -0.00005 ? '−' : ''}${Math.abs(value * 100).toFixed(2)}%`

/**
 * Below the result: what one more substat roll, talent level or level on each member would add to
 * the team's damage, against the result (same rotation, buffs, builds and weapons).
 */
export function TeamSensitivity({
  teamId,
  members,
  teamOpt,
  result,
}: {
  teamId: string
  members: TeamOptMember[]
  teamOpt: TeamOpt
  result: TeamOptResult
}) {
  const { t } = useTranslation(['page_team', 'statKey_gen'])
  const gender = useDBGender()
  const { cells, done } = useTeamSensitivity(teamId, teamOpt, result)

  const groups: {
    label: ReactNode
    rows: { id: RowId; label: ReactNode }[]
  }[] = [
    {
      label: t('teamOpt.sens.substats', '+1 substat roll'),
      rows: sensitivitySubstats.map((key) => ({
        id: `sub:${key}` as const,
        label: `${t(`statKey_gen:${key}`)}${percentKeys.includes(key) ? '%' : ''}`,
      })),
    },
    {
      label: t('teamOpt.sens.talents', '+1 talent level'),
      rows: sensitivityTalents.map((talent) => ({
        id: `talent:${talent}` as const,
        label: t(`teamOpt.sens.talent.${talent}`, talentNames[talent]),
      })),
    },
    {
      label: t('teamOpt.sens.levels', 'Level'),
      rows: sensitivityLevels.map((level) => ({
        id: `level:${level}` as const,
        label: t('teamOpt.sens.level', {
          defaultValue: 'Level {{level}}',
          level,
        }),
      })),
    },
  ]

  // The heatmap's scale, each member's best cells within a group (the 2 substats worth farming,
  // the talent worth raising: a level is always best at 100, the shading shows by how much) and
  // the best substat roll of the table, for the caption.
  const { max, top, best } = useMemo(() => {
    let max = 0
    let best:
      | { characterKey: CharacterKey; id: RowId; value: number }
      | undefined
    const top = new Set<string>()
    for (const { characterKey } of members) {
      const own = Object.entries(cells[characterKey] ?? {}).filter(
        (entry): entry is [RowId, number] => typeof entry[1] === 'number'
      )
      for (const [id, value] of own) {
        if (value > max) max = value
        if (id.startsWith('sub:') && (!best || value > best.value))
          best = { characterKey, id, value }
      }
      for (const [group, count] of [
        ['sub:', 2],
        ['talent:', 1],
      ] as const) {
        const ranked = own
          .filter(([id, value]) => id.startsWith(group) && value > 0.00005)
          .sort((a, b) => b[1] - a[1])
        const groupBest = ranked[0]?.[1] ?? 0
        ranked
          .slice(0, count)
          // only what matters: at least 0.10%, and at least a quarter of the member's best here
          .filter(([, value]) => value >= 0.001 && value >= groupBest * 0.25)
          .forEach(([id]) => top.add(`${characterKey}|${id}`))
      }
    }
    return { max, top, best }
  }, [cells, members])

  // Rows worth nothing to every member (no gain, or a talent already at its highest) fold into one
  // line under the table, once everything is computed, so the rows that matter stand together.
  const [showAll, setShowAll] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `groups` is rebuilt per render from fixed row lists
  const noGain = useMemo(() => {
    const ids = new Set<RowId>()
    if (!done) return ids
    for (const group of groups)
      for (const { id } of group.rows)
        if (
          members.every(({ characterKey }) => {
            const value = cells[characterKey]?.[id]
            return (
              value === null ||
              (value !== undefined && Math.abs(value) < 0.00005)
            )
          })
        )
          ids.add(id)
    return ids
  }, [done, cells, members])
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => showAll || !noGain.has(row.id)),
    }))
    .filter((group) => group.rows.length)
  const noGainLabels = groups
    .flatMap((group) => group.rows)
    .filter((row) => noGain.has(row.id))
    .map((row) => row.label)

  const stickySx = (theme: Theme) => ({
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    backgroundColor: theme.palette.contentNormal.main,
  })

  return (
    // the card hugs the table (compact columns read faster than ones stretched across the page)
    <CardThemed
      sx={{ p: { xs: 1.5, md: 2 }, width: 'fit-content', maxWidth: '100%' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography component="h2" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          {t('teamOpt.sens.title', 'What raises team damage')}
        </Typography>
        <InfoTooltipInline
          title={t(
            'teamOpt.sens.info',
            'Each cell: the team’s rotation damage with that one change on that member, against the result above (same rotation, buffs, artifacts and weapons). A roll is an average 5★ roll, as in the Improve tab’s Substat value.'
          )}
        />
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{
            tableLayout: 'fixed',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            '& th, & td': {
              borderTop: (theme) => `1px solid ${theme.palette.divider}`,
              px: 1.25,
              py: 0.5,
            },
          }}
        >
          <colgroup>
            <col style={{ width: 188 }} />
            {members.map(({ characterKey }) => (
              <col key={characterKey} style={{ width: 132 }} />
            ))}
          </colgroup>
          <thead>
            <Box
              component="tr"
              sx={(theme) => ({
                '& th': {
                  borderTop: 'none',
                  // raised: a tint over the card's colour (opaque, for the sticky cell)
                  backgroundColor: theme.palette.contentNormal.main,
                  backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, 0.04)}, ${alpha(theme.palette.text.primary, 0.04)})`,
                  py: 0.75,
                },
              })}
            >
              <Box component="th" sx={stickySx} />
              {members.map(({ characterKey }) => (
                <Box
                  component="th"
                  key={characterKey}
                  scope="col"
                  sx={{ textAlign: 'center' }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.75,
                      minWidth: 0,
                    }}
                  >
                    <MemberAvatar characterKey={characterKey} size={22} />
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, minWidth: 0 }}
                      noWrap
                    >
                      <CharacterName
                        characterKey={characterKey}
                        gender={gender}
                      />
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </thead>
          <tbody>
            {visibleGroups.map((group, g) => (
              <Fragment
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
                key={g}
              >
                {/* the group's label in the sticky first column: a cell spanning the table would scroll away */}
                <Box
                  component="tr"
                  sx={(theme) => ({
                    // a stronger line between groups than between rows
                    '& > th, & > td': g
                      ? {
                          borderTopColor: alpha(
                            theme.palette.text.primary,
                            0.16
                          ),
                        }
                      : {},
                  })}
                >
                  <Box
                    component="th"
                    scope="rowgroup"
                    sx={(theme) => ({
                      ...stickySx(theme),
                      pt: g ? 1.75 : 1,
                      pb: 0.5,
                      textAlign: 'left',
                      color: 'text.secondary',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    })}
                  >
                    {group.label}
                  </Box>
                  {members.map(({ characterKey }) => (
                    <td key={characterKey} />
                  ))}
                </Box>
                {group.rows.map((row) => (
                  <tr key={row.id}>
                    <Box
                      component="th"
                      scope="row"
                      sx={(theme) => ({
                        ...stickySx(theme),
                        textAlign: 'left',
                        fontWeight: 400,
                        fontSize: '0.875rem',
                        color: 'text.secondary',
                        whiteSpace: 'nowrap',
                      })}
                    >
                      {row.label}
                    </Box>
                    {members.map(({ characterKey }) => (
                      <SensitivityCell
                        key={characterKey}
                        value={cells[characterKey]?.[row.id]}
                        max={max}
                        highlight={top.has(`${characterKey}|${row.id}`)}
                      />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Box>
      </Box>
      {!!noGainLabels.length && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1.25, maxWidth: 'min(100%, 720px)' }}
        >
          {t('teamOpt.sens.noGain', 'No gain for this team:')}{' '}
          {noGainLabels.map((label, i) => (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: labels follow the fixed row order
              key={i}
            >
              {i ? ', ' : ''}
              {label}
            </Fragment>
          ))}
          {' · '}
          <Button
            size="small"
            variant="text"
            onClick={() => setShowAll((show) => !show)}
            sx={{
              minWidth: 0,
              p: 0,
              verticalAlign: 'baseline',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              color: 'primary.light',
              '&:hover': {
                backgroundColor: 'transparent',
                textDecoration: 'underline',
              },
            }}
          >
            {showAll
              ? t('teamOpt.sens.hideNoGain', 'Hide these rows')
              : t('teamOpt.sens.showNoGain', 'Show these rows')}
          </Button>
        </Typography>
      )}
      {done && best && best.value > 0.00005 && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: noGainLabels.length ? 0.5 : 1.25 }}
        >
          <HowToRead best={best} gender={gender} />
        </Typography>
      )}
    </CardThemed>
  )
}

const talentNames: Record<SensitivityTalent, string> = {
  auto: 'Normal Attack',
  skill: 'Elemental Skill',
  burst: 'Elemental Burst',
}

function SensitivityCell({
  value,
  max,
  highlight,
}: {
  /** undefined: still computing; null: not possible (a talent at its highest) */
  value: number | null | undefined
  max: number
  highlight: boolean
}) {
  const { t } = useTranslation('page_team')
  if (value === undefined)
    return (
      <Box component="td" sx={{ textAlign: 'center' }}>
        <Skeleton variant="text" width={52} sx={{ mx: 'auto' }} />
      </Box>
    )
  const zero = value === null || Math.abs(value) < 0.00005
  return (
    <Box
      component="td"
      sx={(theme) => ({
        textAlign: 'center',
        fontSize: '0.875rem',
        whiteSpace: 'nowrap',
        color: zero
          ? 'text.disabled'
          : highlight
            ? theme.palette.primary.light
            : 'text.primary',
        fontWeight: highlight ? 700 : 400,
        backgroundColor:
          value === null || zero
            ? undefined
            : value < 0
              ? alpha(theme.palette.error.main, 0.1)
              : alpha(
                  theme.palette.primary.main,
                  0.06 + 0.3 * (max > 0 ? value / max : 0)
                ),
      })}
    >
      {/* "max": a talent already at its highest; a faint dash: no gain (quieter than "0.00%") */}
      {value === null
        ? t('teamOpt.sens.max', 'max')
        : zero
          ? '–'
          : formatChange(value)}
    </Box>
  )
}

/** The table's best cell, in words */
function HowToRead({
  best,
  gender,
}: {
  best: { characterKey: CharacterKey; id: RowId; value: number }
  gender: 'F' | 'M'
}) {
  const { t } = useTranslation(['page_team', 'statKey_gen'])
  const [kind, which] = best.id.split(':')
  const name = (
    <CharacterName characterKey={best.characterKey} gender={gender} />
  )
  const value = formatChange(best.value)
  if (kind === 'sub') {
    const stat = `${t(`statKey_gen:${which}`)}${percentKeys.includes(which) ? '%' : ''}`
    return (
      <Trans
        t={t}
        i18nKey="teamOpt.sens.readSubstat"
        defaults="How to read it: one extra {{stat}} roll on <name/>’s artifacts raises the team’s damage by {{value}}."
        values={{ stat, value }}
        components={{ name }}
      />
    )
  }
  if (kind === 'talent') {
    const talent = t(
      `teamOpt.sens.talent.${which}`,
      talentNames[which as SensitivityTalent]
    )
    return (
      <Trans
        t={t}
        i18nKey="teamOpt.sens.readTalent"
        defaults="How to read it: one more {{talent}} level on <name/> raises the team’s damage by {{value}}."
        values={{ talent, value }}
        components={{ name }}
      />
    )
  }
  return (
    <Trans
      t={t}
      i18nKey="teamOpt.sens.readLevel"
      defaults="How to read it: <name/> at level {{level}} raises the team’s damage by {{value}}."
      values={{ level: which, value }}
      components={{ name }}
    />
  )
}
