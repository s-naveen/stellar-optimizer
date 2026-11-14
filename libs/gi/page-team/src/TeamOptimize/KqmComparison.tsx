import {
  BootstrapTooltip,
  InfoTooltipInline,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon, TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import type {
  KqmBuild,
  KqmCatchUp,
  KqmOption,
  KqmResult,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  compareTeamKqm,
  KQM_SUBSTAT_ROLLS,
  kqmSetsId,
  kqmWeaponData,
  quickTooltipProps,
  statName,
  WeaponName,
  weaponSheetNs,
} from '@genshin-optimizer/gi/ui'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import UndoIcon from '@mui/icons-material/Undo'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  LinearProgress,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRate } from './format'
import { artifactStatValue, KqmBuildView, SetLines } from './KqmBuildView'
import { MemberAvatar } from './MemberAvatar'
import { WeaponDetails, WeaponThumb } from './TeamOptResults'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  selectedSx,
  tokens,
  type,
} from './ui'

const cache = new WeakMap<KqmResult, Map<string, KqmResult>>()
const choices = new WeakMap<
  KqmResult,
  Partial<Record<CharacterKey, Pick<KqmBuild, 'weapon' | 'sets'>>>
>()
const weaponId = (build: Pick<KqmBuild, 'weapon'>) =>
  `${build.weapon.key}@${build.weapon.refinement}`
const choiceId = (ck: CharacterKey, build: Pick<KqmBuild, 'weapon' | 'sets'>) =>
  `${ck}|${weaponId(build)}|${kqmSetsId(build.sets)}`

/** Both lists hold the opposite selection fixed; only this member's main stats/rolls are searched. */
export function KqmCompare({
  teamId,
  runSettings,
  result,
  characterKey,
  rotationTime,
  disabled = false,
}: {
  teamId: string
  runSettings: TeamOpt
  result: KqmResult
  characterKey: CharacterKey
  rotationTime?: number
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const original = result.builds[characterKey]!
  const [choice, setChoice] = useState<Pick<KqmBuild, 'weapon' | 'sets'>>(
    () => choices.get(result)?.[characterKey] ?? original
  )
  const [view, setView] = useState(result)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [category, setCategory] = useState(0)
  const key = choiceId(characterKey, choice)
  useEffect(() => {
    if (disabled) return
    let cancelled = false
    const saved = cache.get(result) ?? new Map<string, KqmResult>()
    cache.set(result, saved)
    saved.set(choiceId(characterKey, original), result)
    const hit = saved.get(key)
    setError('')
    if (hit) {
      setView(hit)
      setBusy(false)
      return
    }
    setBusy(true)
    compareTeamKqm({
      database,
      teamId,
      gender,
      teamOpt: runSettings,
      result,
      characterKey,
      ...choice,
      isCancelled: () => cancelled,
    })
      .then((next) => {
        if (cancelled || !next) return
        saved.set(key, next)
        setView(next)
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason?.message ?? reason))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    database,
    teamId,
    gender,
    runSettings,
    result,
    characterKey,
    original,
    key,
    choice,
    disabled,
  ])
  const ranking = view.rankings[characterKey]
  const build = view.builds[characterKey]!
  // the rows' tooltips (passives, set bonuses) have their texts before the first hover: no
  // placeholder while they load
  useEffect(
    () =>
      preloadNamespaces([
        'weaponNames_gen',
        'artifactNames_gen',
        'sheet',
        ...(ranking?.weapons ?? []).map((o) => weaponSheetNs(o.weapon.key)),
        ...(ranking?.sets ?? []).flatMap((o) =>
          Object.keys(o.sets).map((k) => `artifact_${k}_gen`)
        ),
      ]),
    [ranking]
  )
  if (!ranking) return null
  const choose = (next: Pick<KqmBuild, 'weapon' | 'sets'>) => {
    if (disabled || busy || choiceId(characterKey, next) === key) return
    choices.set(result, { ...choices.get(result), [characterKey]: next })
    setChoice(next)
  }
  const changed = key !== choiceId(characterKey, original)
  const setOptions = [...ranking.sets]
  if (!setOptions.some((o) => kqmSetsId(o.sets) === kqmSetsId(choice.sets)))
    setOptions.unshift({ ...build, sets: choice.sets, total: 0, unmet: false })
  const weaponOptions = [...ranking.weapons]
  if (!weaponOptions.some((o) => weaponId(o) === weaponId(choice)))
    weaponOptions.unshift({
      ...build,
      weapon: choice.weapon,
      total: 0,
      unmet: false,
    })
  const er = view.energyRecharge[characterKey]
  const list = category === 0 ? ranking.weapons : ranking.sets
  const selectSx = compactFieldSx
  const equipment = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.weaponLabel', 'Weapon')}
        value={weaponId(choice)}
        disabled={busy || disabled}
        sx={selectSx}
        SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 380 } } } }}
        onChange={(e) => {
          const option = weaponOptions.find(
            (o) => weaponId(o) === e.target.value
          )
          if (option) choose({ weapon: option.weapon, sets: choice.sets })
        }}
      >
        {weaponOptions.map((o) => (
          <MenuItem key={weaponId(o)} value={weaponId(o)}>
            <Box
              component="span"
              sx={{ color: 'text.secondary', mr: 0.75, ...numSx }}
            >
              R{o.weapon.refinement}
            </Box>
            <WeaponName weaponKey={o.weapon.key} />
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.setLabel', 'Artifact set')}
        value={kqmSetsId(choice.sets)}
        disabled={busy || disabled}
        sx={selectSx}
        SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 380 } } } }}
        onChange={(e) => {
          const option = setOptions.find(
            (o) => kqmSetsId(o.sets) === e.target.value
          )
          if (option) choose({ weapon: choice.weapon, sets: option.sets })
        }}
      >
        {setOptions.map((o) => (
          <MenuItem key={kqmSetsId(o.sets)} value={kqmSetsId(o.sets)}>
            <SetLines sets={o.sets} />
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
  const shortfalls = view.after.shortfalls?.[characterKey] ?? []
  const erMet = !!er && er.value + 1e-6 >= er.minimum
  return (
    <Box
      component="section"
      aria-label={t('teamOpt.kqm.compareEquipment', 'Compare equipment')}
      sx={{ scrollMarginTop: 88 }}
    >
      {error && (
        <Box
          role="alert"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 1.5,
            fontSize: 13,
            color: 'error.main',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 16 }} />
          {error}
        </Box>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, lg: 2.5 },
          alignItems: 'start',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'minmax(300px, 0.85fr) minmax(0, 1.55fr)',
          },
        }}
      >
        {/* the inspector: this member's build with the chosen weapon and set */}
        <Box
          sx={{
            ...insetSx,
            p: { xs: 1.5, sm: 2 },
            minWidth: 0,
            opacity: busy ? 0.6 : 1,
            transition: 'opacity .18s',
          }}
        >
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}
          >
            <MemberAvatar characterKey={characterKey} size={40} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h3" noWrap sx={type.title}>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  columnGap: 0.75,
                }}
              >
                <Typography sx={type.stat}>
                  {formatRate(view.after.total, rotationTime, true)}
                </Typography>
                <Typography sx={{ ...type.label, fontSize: 12 }}>
                  {rotationTime
                    ? t('teamOpt.kqm.teamDps', 'team DPS')
                    : t('teamOpt.kqm.teamDmg', 'team DMG')}
                </Typography>
                {changed && (
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      ...numSx,
                      color:
                        view.after.total >= result.after.total
                          ? 'success.main'
                          : 'text.secondary',
                    }}
                  >
                    {formatGain(view.after.total / result.after.total - 1)}
                  </Typography>
                )}
              </Box>
            </Box>
            {changed && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                disabled={busy || disabled}
                startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                onClick={() => choose(original)}
                sx={{ color: 'text.secondary', ...quickSx }}
              >
                {t('teamOpt.kqm.resetShort', 'Reset')}
              </Button>
            )}
          </Box>
          <KqmBuildView
            characterKey={characterKey}
            build={build}
            equipment={equipment}
          />
          {er && (
            <Tooltip
              arrow
              title={t('teamOpt.kqm.erResult', {
                defaultValue: 'ER {{value}}% / {{minimum}}% required',
                value: +er.value.toFixed(1),
                minimum: +er.minimum.toFixed(1),
              })}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 1,
                  mt: 1.5,
                  pt: 1.25,
                  borderTop: hairline,
                  cursor: 'help',
                  color: erMet ? 'success.main' : 'warning.main',
                }}
              >
                <Typography
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: 12.5,
                    fontWeight: 500,
                  }}
                >
                  {erMet ? (
                    <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
                  )}
                  {t('teamOpt.kqm.erCheck', 'ER check')}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, ...numSx }}>
                  {er.value.toFixed(1)}%
                  <Box
                    component="span"
                    sx={{ color: 'text.secondary', fontWeight: 500 }}
                  >
                    {' / '}
                    {er.minimum.toFixed(1)}%
                  </Box>
                </Typography>
              </Box>
            </Tooltip>
          )}
          {!!shortfalls.length && (
            <Tooltip
              arrow
              title={shortfalls
                .map(
                  (s) =>
                    `${statName(s.path.at(-1) ?? '')}: ${artifactStatValue(s.path.at(-1) ?? '', s.value)} / ${artifactStatValue(s.path.at(-1) ?? '', s.min)}`
                )
                .join(' · ')}
            >
              <Typography
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 12.5,
                  mt: 1,
                  cursor: 'help',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
                {t('teamOpt.kqm.requirementsUnmet', 'Requirements unmet')}
              </Typography>
            </Tooltip>
          )}
        </Box>
        {/* the rankings: each row is the team with that weapon (or set) on this member */}
        <Box sx={{ minWidth: 0 }} aria-busy={busy}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mb: 0.75,
            }}
          >
            <RankTabs
              value={category}
              onChange={setCategory}
              characterKey={characterKey}
              label={t('teamOpt.kqm.rankings', 'Equipment rankings')}
            />
            <InfoTooltipInline
              title={t(
                'teamOpt.kqm.linkedCompareTip',
                'Choose a set to re-rank weapons, or a weapon to re-rank sets. Main stats and substats are optimized again. Teammates keep the builds from this run.'
              )}
            />
            <Box sx={{ flex: 1 }} />
            <CopyRankingButton
              options={list}
              kind={category === 0 ? 'weapons' : 'sets'}
              rotationTime={rotationTime}
            />
          </Box>
          {/* (a thin line while the rankings update; its space is always kept) */}
          <Box sx={{ height: 2, mb: 0.5 }}>
            {busy && (
              <LinearProgress
                aria-label={t(
                  'teamOpt.kqm.updatingRankings',
                  'Updating rankings'
                )}
                sx={{ height: 2, borderRadius: 1 }}
              />
            )}
          </Box>
          <Box
            role="tabpanel"
            id={`kqm-${characterKey}-ranking`}
            aria-labelledby={`kqm-${characterKey}-${category === 0 ? 'weapons' : 'sets'}`}
            sx={{
              opacity: busy ? 0.45 : 1,
              pointerEvents: busy ? 'none' : undefined,
              transition: 'opacity .18s',
            }}
          >
            <RankList
              key={category}
              options={list}
              rotationTime={rotationTime}
              selected={(o) =>
                category === 0
                  ? weaponId(o) === weaponId(choice)
                  : kqmSetsId(o.sets) === kqmSetsId(choice.sets)
              }
              onSelect={(o) =>
                choose(
                  category === 0
                    ? { weapon: o.weapon, sets: choice.sets }
                    : { weapon: choice.weapon, sets: o.sets }
                )
              }
              disabled={disabled || busy}
              label={(o) =>
                category === 0 ? (
                  <WeaponLabel weapon={kqmWeaponData(o.weapon, characterKey)} />
                ) : (
                  <SetLines sets={o.sets} tooltipPlacement="left" />
                )
              }
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/** A ranked weapon: its icon and name, its details (stats, passive) on hover */
function WeaponLabel({ weapon }: { weapon: ICachedWeapon }) {
  return (
    <BootstrapTooltip
      // (beside the list, not over it: the other rows stay readable)
      placement="left"
      disableInteractive
      title={<WeaponDetails weapon={weapon} />}
      {...quickTooltipProps}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          maxWidth: '100%',
          verticalAlign: 'middle',
        }}
      >
        <Box
          sx={{
            transform: 'scale(0.7)',
            transformOrigin: 'left center',
            width: 32,
            height: 32,
            flexShrink: 0,
          }}
        >
          <WeaponThumb weapon={weapon} highlight={false} />
        </Box>
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.4 }}>
          <WeaponName weaponKey={weapon.key} />
        </Typography>
      </Box>
    </BootstrapTooltip>
  )
}

/** Weapons or artifact sets: two tabs on a segmented track */
function RankTabs({
  value,
  onChange,
  characterKey,
  label,
}: {
  value: number
  onChange: (value: number) => void
  characterKey: CharacterKey
  label: string
}) {
  const { t } = useTranslation('page_team')
  const tabs = [
    ['weapons', t('teamOpt.kqm.weaponsList', 'Weapons')],
    ['sets', t('teamOpt.kqm.sets', 'Artifact sets')],
  ] as const
  return (
    <Box
      role="tablist"
      aria-label={label}
      sx={(theme) => ({
        display: 'inline-grid',
        gridAutoFlow: 'column',
        p: 0.375,
        gap: 0.25,
        borderRadius: tokens.radius.control,
        bgcolor: alpha(theme.palette.text.primary, 0.05),
      })}
    >
      {tabs.map(([id, name], i) => {
        const active = value === i
        return (
          <ButtonBase
            key={id}
            role="tab"
            id={`kqm-${characterKey}-${id}`}
            aria-selected={active}
            aria-controls={`kqm-${characterKey}-ranking`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(i)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const next = (i + 1) % tabs.length
              onChange(next)
              ;(
                e.currentTarget.parentElement?.children[next] as
                  | HTMLElement
                  | undefined
              )?.focus()
            }}
            sx={{
              px: 1.5,
              minHeight: 30,
              borderRadius: 1.25,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: active ? 'text.primary' : 'text.secondary',
              bgcolor: active ? tokens.raised : 'transparent',
              boxShadow: active
                ? `0 1px 2px ${alpha('#000', 0.45)}, inset 0 0 0 1px ${tokens.hairlineStrong}`
                : 'none',
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            {name}
          </ButtonBase>
        )
      })}
    </Box>
  )
}

const shortStat: Record<string, string> = {
  critRate_: 'CR',
  critDMG_: 'CD',
  enerRech_: 'ER',
  eleMas: 'EM',
  atk_: 'ATK',
  atk: 'ATK',
  hp_: 'HP',
  hp: 'HP',
  def_: 'DEF',
  def: 'DEF',
}
function CatchUp({ gap, rank }: { gap?: KqmCatchUp; rank: number }) {
  const { t } = useTranslation('page_team')
  if (!gap)
    return (
      <Typography sx={{ color: 'text.disabled', fontSize: 12.5 }}>—</Typography>
    )
  const detail = Object.entries(gap.rolls)
    .filter(([, n]) => n > 1e-5)
    .map(
      ([key, n]) =>
        `+${artifactStatValue(key, n * KQM_SUBSTAT_ROLLS[key as keyof typeof KQM_SUBSTAT_ROLLS])} ${shortStat[key] ?? statName(key)}`
    )
    .join(' · ')
  return (
    <Tooltip
      arrow
      title={
        <Box>
          {t('teamOpt.kqm.matchRank', {
            defaultValue: 'Match rank #{{rank}}',
            rank,
          })}
          {detail && <Box sx={{ mt: 0.5 }}>{detail}</Box>}
          <Box sx={{ mt: 0.5 }}>
            {t(
              'teamOpt.kqm.catchUpTip',
              'Extra average rolls above the KQM budget, with the same equipment and teammates. ER requirements and per-stat placement caps still apply.'
            )}
          </Box>
        </Box>
      }
    >
      <Box sx={{ cursor: 'help', minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: gap.status === 'matched' ? 600 : 500,
            color: gap.status === 'matched' ? 'text.primary' : 'text.secondary',
            whiteSpace: 'nowrap',
            ...numSx,
          }}
        >
          {gap.status === 'tied'
            ? t('teamOpt.kqm.tie', 'Tie')
            : gap.status === 'limit'
              ? '—'
              : `≈ +${(Math.ceil(gap.count * 10) / 10).toFixed(1)} ${t('teamOpt.kqm.rollUnit', 'rolls')}`}
        </Typography>
        {gap.status === 'matched' && (
          <Typography
            sx={{
              mt: 0.125,
              fontSize: 11.5,
              color: 'text.secondary',
              lineHeight: 1.45,
              ...numSx,
            }}
          >
            {detail}
          </Typography>
        )}
      </Box>
    </Tooltip>
  )
}

/** Copies a ranking as a Markdown table (Discord, sheets, docs) */
function CopyRankingButton({
  options,
  kind,
  rotationTime,
}: {
  options: KqmOption[]
  kind: 'weapons' | 'sets'
  rotationTime?: number
}) {
  const { t, i18n } = useTranslation([
    'page_team',
    'weaponNames_gen',
    'artifactNames_gen',
  ])
  const [copied, setCopied] = useState(false)
  const best = options.find((o) => !o.unmet)?.total ?? options[0]?.total ?? 0
  const copy = () => {
    const name = (o: KqmOption) =>
      kind === 'weapons'
        ? `${i18n.t(`weaponNames_gen:${o.weapon.key}`)} R${o.weapon.refinement}`
        : Object.entries(o.sets).length
          ? Object.entries(o.sets)
              .map(([k, n]) => `${n}pc ${i18n.t(`artifactNames_gen:${k}`)}`)
              .join(' + ')
          : t('teamOpt.kqm.noSetBonus', 'No set bonus')
    const head = [
      '#',
      kind === 'weapons'
        ? t('teamOpt.kqm.weaponLabel', 'Weapon')
        : t('teamOpt.kqm.setLabel', 'Artifact set'),
      rotationTime
        ? t('teamOpt.kqm.teamDpsHeader', 'Team DPS')
        : t('teamOpt.kqm.teamDmgHeader', 'Team DMG'),
      '%',
    ]
    const rows = options.map((o, i) => [
      String(i + 1),
      name(o) + (o.unmet ? ' ⚠' : ''),
      formatRate(o.total, rotationTime, true),
      best ? `${((o.total / best) * 100).toFixed(1)}%` : '',
    ])
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`
    const text = [
      line(head),
      line(head.map(() => '---')),
      ...rows.map(line),
    ].join('\n')
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
    // (a selected textarea when the Clipboard API is missing or refused)
    const fallback = () => {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      if (ok) done()
    }
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(done, fallback)
    else fallback()
  }
  return (
    <Button
      size="small"
      variant="text"
      color="inherit"
      onClick={copy}
      aria-label={t('teamOpt.kqm.copyRanking', 'Copy as a table')}
      startIcon={
        copied ? (
          <CheckIcon sx={{ fontSize: 17 }} />
        ) : (
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        )
      }
      sx={{
        minWidth: 0,
        whiteSpace: 'nowrap',
        color: copied ? 'success.main' : 'text.secondary',
        ...quickSx,
        ...focusSx,
        '&:hover': { color: copied ? 'success.main' : 'text.primary' },
        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 }, ml: 0 },
      }}
    >
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {copied
          ? t('teamOpt.kqm.copied', 'Copied')
          : t('teamOpt.kqm.copyRanking', 'Copy as a table')}
      </Box>
    </Button>
  )
}

/** The first rows shown; the rest open below them */
const FIRST_ROWS = 8

function RankList({
  options,
  rotationTime,
  label,
  selected,
  onSelect,
  disabled,
}: {
  options: KqmOption[]
  rotationTime?: number
  label: (option: KqmOption) => ReactNode
  selected: (option: KqmOption) => boolean
  onSelect: (option: KqmOption) => void
  disabled: boolean
}) {
  const { t } = useTranslation('page_team')
  const [expanded, setExpanded] = useState(false)
  const best = options.find((o) => !o.unmet)?.total ?? options[0]?.total ?? 0
  const columns = {
    xs: '22px minmax(0, 1fr) 76px',
    sm: '28px minmax(0, 1fr) 88px 136px',
  }
  const row = (option: KqmOption, i: number) => {
    const active = selected(option)
    const ratio = best > 0 ? option.total / best : 0
    return (
      <ButtonBase
        key={`${weaponId(option)}|${kqmSetsId(option.sets)}`}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onSelect(option)}
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: columns,
          alignItems: 'center',
          columnGap: 1,
          rowGap: 0.5,
          px: 1.25,
          py: 1,
          minHeight: 54,
          width: '100%',
          textAlign: 'left',
          borderRadius: tokens.radius.control,
          // (a hairline between rows; the selected row's ring replaces it)
          boxShadow: i > 0 ? `inset 0 1px 0 ${tokens.hairline}` : 'none',
          ...(active && selectedSx(theme)),
          ...quickSx,
          '&:hover': {
            bgcolor: active
              ? alpha(theme.palette.primary.main, 0.14)
              : alpha(theme.palette.text.primary, 0.035),
          },
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens.gold}`,
            outlineOffset: -2,
          },
        })}
      >
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: active ? 600 : 500,
            color: active ? 'primary.main' : 'text.secondary',
            ...numSx,
          }}
        >
          {i + 1}
        </Typography>
        <Box sx={{ minWidth: 0 }}>{label(option)}</Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 600, ...numSx }}>
            {formatRate(option.total, rotationTime)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', ...numSx }}>
            {(ratio * 100).toFixed(1)}%
          </Typography>
        </Box>
        <Box
          sx={{
            gridColumn: { xs: '2 / -1', sm: 'auto' },
            pl: { sm: 1 },
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
          }}
        >
          {option.unmet ? (
            <Tooltip
              arrow
              title={(option.shortfalls ?? [])
                .map(
                  (s) =>
                    `${statName(s.path.at(-1) ?? '')}: ${artifactStatValue(s.path.at(-1) ?? '', s.value)} / ${artifactStatValue(s.path.at(-1) ?? '', s.min)}`
                )
                .join(' · ')}
            >
              <Typography
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 12.5,
                  color: 'warning.main',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />
                {t('teamOpt.kqm.requirementsUnmet', 'Requirements unmet')}
              </Typography>
            </Tooltip>
          ) : (
            <CatchUp gap={option.catchUp} rank={i} />
          )}
        </Box>
      </ButtonBase>
    )
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: columns,
          columnGap: 1,
          px: 1.25,
          pb: 0.75,
          alignItems: 'center',
          borderBottom: hairline,
          mb: 0.25,
        }}
      >
        <Typography sx={{ ...type.label, fontSize: 12 }}>#</Typography>
        <Typography sx={{ ...type.label, fontSize: 12 }}>
          {t('teamOpt.kqm.equipment', 'Equipment')}
        </Typography>
        <Typography sx={{ ...type.label, fontSize: 12, textAlign: 'right' }}>
          {rotationTime
            ? t('teamOpt.kqm.teamDpsHeader', 'Team DPS')
            : t('teamOpt.kqm.teamDmgHeader', 'Team DMG')}
        </Typography>
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            gap: 0.5,
            pl: 1,
          }}
        >
          <Typography sx={{ ...type.label, fontSize: 12 }}>
            {t('teamOpt.kqm.toPrevious', 'To rank above')}
          </Typography>
          <InfoTooltipInline
            title={t(
              'teamOpt.kqm.catchUpHeader',
              'Extra substats needed to match the rank immediately above.'
            )}
          />
        </Box>
      </Box>
      {options.slice(0, FIRST_ROWS).map(row)}
      {options.length > FIRST_ROWS && (
        <>
          <Collapse in={expanded} timeout={180} unmountOnExit>
            {options
              .slice(FIRST_ROWS)
              .map((option, i) => row(option, i + FIRST_ROWS))}
          </Collapse>
          <Button
            fullWidth
            size="small"
            variant="text"
            color="inherit"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transition: `transform .18s ${tokens.ease}`,
                  transform: expanded ? 'rotate(180deg)' : 'none',
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                  },
                }}
              />
            }
            sx={{
              mt: 0.5,
              minHeight: 34,
              color: 'text.secondary',
              borderTop: hairline,
              borderRadius: 0,
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            {expanded
              ? t('teamOpt.kqm.showLess', 'Show less')
              : t('teamOpt.kqm.showAll', {
                  defaultValue: 'Show all {{count}}',
                  count: options.length,
                })}
          </Button>
        </>
      )}
    </Box>
  )
}

/** A compact outlined field: 36 px tall */
const compactFieldSx = {
  '& .MuiInputBase-root': { fontSize: 13.5 },
  '& .MuiInputLabel-root': { fontSize: 13.5 },
  '& .MuiSelect-select': { py: 0.875 },
} as const
