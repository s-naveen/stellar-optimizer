import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
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
import { giTokens } from '@genshin-optimizer/gi/theme'
import { alpha, Box, ButtonBase, Skeleton, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  quickSx,
  tokens,
  type,
} from './ui'

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

/**
 * Per result (team build) shown: its cells as far as they are computed, so that they are there at
 * once when it is shown again (another tab, another page), and a computation stopped half way goes
 * on from where it was. Also saved with the team's last result, for after a reload.
 */
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
 * For the result as it was found (`teamOpt`: the run's settings); kept with it (see `cache`) and in
 * the saved result (`savedAt`: which one; `index`: which of its team builds).
 */
function useTeamSensitivity(
  teamId: string,
  teamOpt: TeamOpt,
  result: TeamOptResult,
  savedAt: number | undefined,
  index: number
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  // what the cells depend on besides the result
  const key = JSON.stringify([
    teamOpt.attacks,
    teamOpt.onField ?? '',
    teamOpt.bonusStats ?? {},
    teamOpt.assumeMaxMain,
  ])
  /** What is known for this result: of this visit, else the saved result's */
  const known = (): Sensitivity | undefined => {
    const hit = cache.get(result)
    if (hit?.key === key) return hit.value
    const run = database.teamOptResults.get().runs[teamId]
    const saved =
      savedAt !== undefined && run?.savedAt === savedAt
        ? run.sensitivity?.[index]
        : undefined
    if (saved?.key !== key) return undefined
    const value = { cells: saved.cells as Cells, done: saved.done }
    cache.set(result, { key, value })
    return value
  }
  const [value, setValue] = useState<Sensitivity>(
    () => known() ?? { cells: {}, done: false }
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the parts of `teamOpt` read
  useEffect(() => {
    const start = known()
    if (start?.done) {
      setValue(start)
      return undefined
    }
    let cancelled = false
    let cancel = () => undefined as void
    // (on from what is known: the cells computed before stay)
    const cells: Cells = structuredClone(start?.cells ?? {})
    let computed = false
    const save = (done: boolean) => {
      if (savedAt === undefined || !computed) return
      database.teamOptResults.setSensitivity(teamId, savedAt, index, {
        key,
        cells: cells as Record<string, Record<string, number | null>>,
        done,
      })
    }
    let sensitivity: ReturnType<typeof teamSensitivity> | undefined
    const has = (member: TeamOptMember, row: RowId) =>
      cells[member.characterKey]?.[row] !== undefined
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
    // the cells still to compute (the team's calculation first, when any is)
    const todo: (() => void)[] = [
      // the substat rolls first: one compiled problem per member, all ten rolls at once
      ...members
        .filter((member) =>
          sensitivitySubstats.some((key) => !has(member, `sub:${key}`))
        )
        .map((member) => () => {
          const totals = sensitivity?.substats(member) ?? {}
          for (const key of sensitivitySubstats)
            set(member, `sub:${key}`, totals[key])
        }),
      ...members.flatMap((member) =>
        sensitivityTalents
          .filter((talent) => !has(member, `talent:${talent}`))
          .map(
            (talent) => () =>
              set(
                member,
                `talent:${talent}`,
                sensitivity?.character(member, { talent })
              )
          )
      ),
      ...members.flatMap((member) =>
        sensitivityLevels
          .filter((level) => !has(member, `level:${level}`))
          .map(
            (level) => () =>
              set(
                member,
                `level:${level}`,
                sensitivity?.character(member, { level })
              )
          )
      ),
    ]
    const tasks: (() => void)[] = todo.length
      ? [
          () => {
            sensitivity = teamSensitivity(
              database,
              teamId,
              gender,
              teamOpt,
              result
            )
          },
          ...todo,
        ]
      : []
    let i = 0
    const next = () => {
      if (cancelled) return
      tasks[i++]?.()
      if (i > 1) computed = true
      const done = i >= tasks.length
      const value = { cells: { ...cells }, done }
      cache.set(result, { key, value })
      if (done) save(true)
      setValue(value)
      if (!done) cancel = whenIdle(next)
    }
    setValue({ cells: { ...cells }, done: false })
    cancel = whenIdle(next)
    return () => {
      cancelled = true
      cancel()
      // (stopped half way: what is computed is saved, and goes on from there next time)
      if (i < tasks.length) save(false)
    }
  }, [database, teamId, gender, key, result, savedAt, index])
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
  savedAt,
  index,
}: {
  teamId: string
  members: TeamOptMember[]
  /** The settings the result was found with */
  teamOpt: TeamOpt
  result: TeamOptResult
  /** When the result was found (which saved result it is) */
  savedAt?: number
  /** Which of the result's team builds it is (0: the best) */
  index: number
}) {
  const { t } = useTranslation(['page_team', 'statKey_gen'])
  const { gender } = useDBMeta()
  const { cells, done } = useTeamSensitivity(
    teamId,
    teamOpt,
    result,
    savedAt,
    index
  )

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

  // the first column stays put when the table scrolls sideways (phones): opaque, as the inset
  const stickySx = {
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    bgcolor: tokens.inset,
  }
  const info = (
    <>
      {t(
        'teamOpt.sens.info',
        'Each cell: the team’s rotation damage with that one change on that member, against the result above (same rotation, buffs, artifacts and weapons). A roll is an average 5★ roll, as in the Improve tab’s Substat value.'
      )}
      {done && best && best.value > 0.00005 && (
        <Box component="span" sx={{ display: 'block', mt: 1 }}>
          <HowToRead best={best} gender={gender} />
        </Box>
      )}
    </>
  )

  return (
    // half the page's width on large screens (as the user prefers), the whole width below that
    <Panel
      component="section"
      sx={{
        minWidth: 0,
        width: { xs: '100%', lg: 'calc(50% - 8px)' },
        alignSelf: 'flex-start',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          minHeight: 32,
          mb: 1.25,
        }}
      >
        <Typography
          component="h2"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          {t('teamOpt.sens.title', 'What raises team damage')}
          <InfoTooltipInline title={info} />
        </Typography>
      </Box>
      <Box sx={{ ...insetSx, overflowX: 'auto', overflowY: 'hidden' }}>
        <Box
          component="table"
          sx={(theme) => ({
            width: '100%',
            // past this, the table scrolls inside its inset (phones)
            minWidth: { xs: 148 + members.length * 96, sm: 0 },
            tableLayout: 'fixed',
            borderCollapse: 'separate',
            borderSpacing: 0,
            ...numSx,
            '& th, & td': {
              borderTop: hairline,
              px: { xs: 1, sm: 1.5 },
              py: 0.75,
              fontSize: 13.5,
              lineHeight: 1.45,
            },
            // a row's hover, across its sticky label too
            '& tbody tr.row': quickSx,
            '& tbody tr.row:hover > *': {
              backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, 0.04)}, ${alpha(theme.palette.text.primary, 0.04)})`,
            },
          })}
        >
          <colgroup>
            <Box component="col" sx={{ width: { xs: 148, sm: 164 } }} />
            {members.map(({ characterKey }) => (
              <col key={characterKey} />
            ))}
          </colgroup>
          <thead>
            <Box component="tr" sx={{ '& th': { borderTop: 'none', py: 1 } }}>
              <Box component="th" sx={stickySx} />
              {members.map(({ characterKey }) => (
                <Box
                  component="th"
                  key={characterKey}
                  scope="col"
                  sx={{ textAlign: 'center' }}
                >
                  {/* (phones: the name under its portrait, to fit a narrow column) */}
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: { xs: 0.25, sm: 0.75 },
                      minWidth: 0,
                    }}
                  >
                    <MemberAvatar characterKey={characterKey} size={24} />
                    <Typography
                      component="span"
                      sx={{
                        fontSize: { xs: 12.5, sm: 13.5 },
                        fontWeight: 600,
                        minWidth: 0,
                        maxWidth: '100%',
                      }}
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
                  sx={{
                    // a stronger line between groups than between rows
                    '& > th, & > td': {
                      borderTopColor: tokens.hairlineStrong,
                      pt: 1.25,
                      pb: 0.5,
                    },
                  }}
                >
                  <Box
                    component="th"
                    scope="rowgroup"
                    sx={{
                      ...stickySx,
                      ...type.label,
                      fontWeight: 600,
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.label}
                  </Box>
                  {members.map(({ characterKey }) => (
                    <td key={characterKey} />
                  ))}
                </Box>
                {group.rows.map((row) => (
                  <tr key={row.id} className="row">
                    <Box
                      component="th"
                      scope="row"
                      sx={{
                        ...stickySx,
                        textAlign: 'left',
                        fontWeight: 400,
                        color: 'text.secondary',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
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
      {/* the rows worth nothing here, in one muted line, and the switch to list them */}
      {!!noGainLabels.length && (
        <Typography
          component="p"
          sx={{ ...type.label, fontWeight: 400, mt: 1.25, lineHeight: 1.6 }}
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
          <ButtonBase
            onClick={() => setShowAll((show) => !show)}
            aria-pressed={showAll}
            sx={{
              verticalAlign: 'baseline',
              fontSize: 'inherit',
              fontWeight: 600,
              lineHeight: 'inherit',
              color: 'text.primary',
              borderRadius: 0.5,
              textDecoration: 'underline',
              textDecorationColor: alpha(giTokens.parchment, 0.3),
              textUnderlineOffset: 3,
              ...quickSx,
              ...focusSx,
              '&:hover': { textDecorationColor: 'currentColor' },
            }}
          >
            {showAll
              ? t('teamOpt.sens.hideNoGain', 'Hide these rows')
              : t('teamOpt.sens.showNoGain', 'Show these rows')}
          </ButtonBase>
        </Typography>
      )}
    </Panel>
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
        <Skeleton variant="text" width={48} sx={{ mx: 'auto' }} />
      </Box>
    )
  const zero = value === null || Math.abs(value) < 0.00005
  return (
    <Box
      component="td"
      sx={(theme) => ({
        textAlign: 'center',
        whiteSpace: 'nowrap',
        color: zero
          ? 'text.disabled'
          : highlight
            ? theme.palette.success.light
            : 'text.primary',
        fontWeight: highlight ? 700 : 400,
        // a gain's shade grows with it (the table's largest, the strongest)
        bgcolor:
          value === null || zero
            ? undefined
            : value < 0
              ? alpha(theme.palette.error.main, 0.1)
              : alpha(
                  theme.palette.success.main,
                  0.04 + 0.26 * (max > 0 ? value / max : 0)
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
