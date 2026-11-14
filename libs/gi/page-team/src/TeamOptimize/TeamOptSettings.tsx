import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { getUnitStr, objPathValue } from '@genshin-optimizer/common/util'
import type { ArtifactSetKey, MainStatKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allElementWithPhyKeys,
  artSlotMainKeys,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamCharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import {
  CharacterContext,
  TeamCharacterContext,
  useCharacter,
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeam,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import { FlowerIcon, SlotIcon, StatIcon } from '@genshin-optimizer/gi/svgicons'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  DataContext,
  resolveInfo,
  statName,
  teamOptPool,
} from '@genshin-optimizer/gi/ui'
import type { CalcResult } from '@genshin-optimizer/gi/uidata'
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  FormControlLabel,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ArtifactSetConfig, {
  configurableSetKeys,
} from '../CharacterDisplay/Tabs/TabOptimize/Components/ArtifactSetConfig'
import MainStatSelectionCard from '../CharacterDisplay/Tabs/TabOptimize/Components/MainStatSelectionCard'
import { SettingsCard } from '../CharacterDisplay/Tabs/TabOptimize/Components/SettingsCard'
import StatFilterCard from '../CharacterDisplay/Tabs/TabOptimize/Components/StatFilterCard'
import { ExcludedArtsTile } from './ExcludedArtifacts'
import { DialogHead, floatSx, OptionTile, stackedBackdrop } from './OptionTile'
import {
  FieldLabel,
  focusSx,
  numSx,
  PanelHeader,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'
import { WeaponSettings } from './WeaponChooser'

const levelRanges = [
  { key: '20', low: 20, high: 20 },
  { key: '16', low: 16, high: 20 },
  { key: '0', low: 0, high: 20 },
] as const

/** Which artifacts the team may use */
export function PoolSettings({
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  poolSize,
  disabled,
}: {
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  /** Artifacts the team may use, with these settings */
  poolSize: number
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const range = levelRanges.find(
    (r) => r.low === teamOpt.levelLow && r.high === teamOpt.levelHigh
  )
  return (
    <Box component="section">
      <PanelHeader
        title={t('teamOpt.pool.title', 'Inventory')}
        actions={
          <Typography sx={{ ...type.label, ...numSx }}>
            {t('teamOpt.pool.count', {
              defaultValue: '{{count}} artifacts to choose from',
              count: poolSize,
            })}
          </Typography>
        }
        sx={{ mb: 1 }}
      />
      {/* the level: a segmented choice */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.75,
          mb: 1.25,
        }}
      >
        <FieldLabel>{t('teamOpt.pool.level', 'Artifact level')}</FieldLabel>
        <Segmented
          size="small"
          aria-label={t('teamOpt.pool.level', 'Artifact level')}
          value={range?.key}
          onChange={(key) => {
            const r = levelRanges.find((r) => r.key === key)
            if (r)
              setTeamOpt((o) => {
                o.levelLow = r.low
                o.levelHigh = r.high
              })
          }}
          options={[
            { value: '20', label: '+20', disabled },
            {
              value: '16',
              label: t('teamOpt.pool.level16', '+16 and up'),
              disabled,
            },
            {
              value: '0',
              label: t('teamOpt.pool.levelAny', 'Any'),
              disabled,
            },
          ]}
        />
      </Box>
      {/* the options: tiles, the whole tile toggles */}
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        <OptionTile
          label={t('teamOpt.pool.others', 'Other characters’ artifacts')}
          checked={teamOpt.useOtherChars}
          disabled={disabled}
          onChange={() =>
            setTeamOpt((o) => {
              o.useOtherChars = !o.useOtherChars
            })
          }
        />
        <ExcludedArtsTile
          members={members}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          disabled={disabled}
        />
        {/* weapons: chosen too, if the user wants */}
        <WeaponSettings
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          disabled={disabled}
        />
      </Box>
    </Box>
  )
}

/**
 * A member's settings for a run: whether its artifacts are optimized or its build kept, and its
 * requirements (stat constraints, sets, set effects: the ones of its Optimize tab) as tags that
 * open them.
 */
export function MemberSettings({
  teamId,
  member,
  teamData,
  teamOpt,
  setTeamOpt,
  disabled,
  showOptimizeToggle = true,
}: {
  teamId: string
  member: TeamOptMember
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
  /** (the run dialog has its own switch on the member's row) */
  showOptimizeToggle?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { characterKey, isTc } = member
  const kept = isTc || teamOpt.keep.includes(characterKey)
  // the requirements dialog, or the set config alone (from the sets and effects tags)
  const [open, setOpen] = useState<'all' | 'sets'>()
  const onShowReq = () => setOpen('all')
  const requirements = useRequirements(member, teamData)
  const editable = !disabled && !kept

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {showOptimizeToggle && (
        <FormControlLabel
          sx={{ m: 0, gap: 0.5 }}
          disabled={disabled || isTc}
          control={
            <Switch
              size="small"
              checked={!kept}
              onChange={() =>
                setTeamOpt((o) => {
                  o.keep = o.keep.includes(characterKey)
                    ? o.keep.filter((k) => k !== characterKey)
                    : [...o.keep, characterKey]
                })
              }
            />
          }
          label={
            <Typography sx={{ fontSize: 13.5 }}>
              {t('teamOpt.member.optimize', 'Optimize artifacts')}
            </Typography>
          }
        />
      )}
      {/* its constraints: tags (a click opens their settings), then the requirements button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 0.75,
          minHeight: 32,
          opacity: kept && !isTc ? 0.45 : 1,
        }}
      >
        <FieldLabel sx={{ mr: 0.25 }}>
          {t('teamOpt.member.constraints', 'Constraints')}
        </FieldLabel>
        {isTc ? (
          <ReqTag>{t('teamOpt.member.tc', 'TC build: kept as it is')}</ReqTag>
        ) : (
          requirements.map((r) => (
            <RequirementTag
              key={r.key}
              req={r}
              onClick={
                editable
                  ? () =>
                      setOpen(
                        r.kind === 'sets' || r.kind === 'effects'
                          ? 'sets'
                          : 'all'
                      )
                  : undefined
              }
            />
          ))
        )}
        <Button
          size="small"
          color="inherit"
          variant="outlined"
          startIcon={<TuneIcon sx={{ fontSize: '16px !important' }} />}
          onClick={onShowReq}
          disabled={disabled || kept}
          sx={{
            ml: 'auto',
            flexShrink: 0,
            minHeight: 30,
            py: 0,
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          {t('teamOpt.member.requirements', 'Requirements')}
        </Button>
      </Box>
      {open && (
        <RequirementsModal
          teamId={teamId}
          member={member}
          teamData={teamData}
          setsOnly={open === 'sets'}
          onClose={() => setOpen(undefined)}
        />
      )}
    </Box>
  )
}

/** A member's requirement, shown as a tag */
type Requirement =
  | {
      key: string
      kind: 'stat'
      name: ReactNode
      icon?: ReactNode
      text: string
    }
  | {
      key: string
      kind: 'main'
      /** The slots with these main stats (slots with the same ones share a tag) */
      slotKeys: MainSlot[]
      statKeys: MainStatKey[]
    }
  | {
      key: string
      kind: 'sets'
      /** Sets a 4-piece may be of, of all */
      allowed4: number
      total: number
      /** Sets with a bonus allowed, and which (2-piece, 4-piece) */
      allowed: [ArtifactSetKey, (2 | 4)[]][]
      /** Sets with a bonus excluded, and which */
      excluded: [ArtifactSetKey, (2 | 4)[]][]
      /** Mixed builds' exclusions */
      rainbow: (2 | 4)[]
    }
  | {
      key: string
      kind: 'effects'
      /** Sets with a conditional effect turned on */
      sets: ArtifactSetKey[]
    }
type MainSlot = 'sands' | 'goblet' | 'circlet'

/** A member's requirements: stat minimums ("Energy Recharge ≥ 160%"), main stats per slot, sets */
function useRequirements(
  member: TeamOptMember,
  teamData: TeamData | undefined
) {
  const { t } = useTranslation('page_team')
  const optConfig = useOptConfig(member.teamChar.optConfigId)
  const conditional = useTeamChar(member.teamCharId)?.conditional
  const data = teamData?.[member.characterKey]?.target
  return useMemo(() => {
    if (!optConfig) return []
    const out: Requirement[] = []
    for (const [pathStr, settings] of Object.entries(optConfig.statFilters)) {
      const path = JSON.parse(pathStr) as string[]
      const node =
        data &&
        (objPathValue(data.getDisplay(), path) as CalcResult | undefined)
      const info = node?.info && resolveInfo(node.info)
      // (a basic stat: its own icon and short name)
      const statKey =
        path[0] === 'total' || path[0] === 'premod' || path[0] === 'basic'
          ? (path[1] as MainStatKey)
          : undefined
      settings.forEach(({ value, disabled }, i) => {
        if (disabled) return
        out.push({
          key: `${pathStr}:${i}`,
          kind: 'stat',
          name: statKey ? shortStat(statKey, t) : (info?.name ?? pathStr),
          icon:
            info?.icon ??
            (statKey ? (
              <StatIcon
                statKey={statKey}
                iconProps={{ sx: { fontSize: 14 } }}
              />
            ) : undefined),
          text: `≥ ${value}${info?.unit === '%' ? '%' : ''}`,
        })
      })
    }
    for (const slotKey of ['sands', 'goblet', 'circlet'] as const) {
      const keys = optConfig.mainStatKeys[slotKey]
      if (!keys.length || keys.length >= artSlotMainKeys[slotKey].length)
        continue
      const same = out.find(
        (r): r is Extract<Requirement, { kind: 'main' }> =>
          r.kind === 'main' &&
          r.statKeys.length === keys.length &&
          r.statKeys.every((k) => keys.includes(k))
      )
      if (same) same.slotKeys.push(slotKey)
      else
        out.push({
          key: slotKey,
          kind: 'main',
          slotKeys: [slotKey],
          statKeys: [...keys],
        })
    }
    const exclusion = optConfig.artSetExclusion as Partial<
      Record<ArtifactSetKey | 'rainbow', (2 | 4)[]>
    >
    out.push({
      key: 'sets',
      kind: 'sets',
      allowed4: configurableSetKeys.filter(
        (k) => !exclusion[k as ArtifactSetKey]?.includes(4)
      ).length,
      total: configurableSetKeys.length,
      allowed: configurableSetKeys.flatMap((k) => {
        const nums = ([2, 4] as const).filter(
          (n) => !exclusion[k as ArtifactSetKey]?.includes(n)
        )
        return nums.length ? [[k as ArtifactSetKey, [...nums]]] : []
      }),
      excluded: configurableSetKeys.flatMap((k) => {
        const nums = exclusion[k as ArtifactSetKey] ?? []
        return nums.length ? [[k as ArtifactSetKey, [...nums]]] : []
      }),
      rainbow: exclusion.rainbow ?? [],
    })
    out.push({
      key: 'effects',
      kind: 'effects',
      sets: allArtifactSetKeys.filter(
        (k) =>
          Object.keys((conditional as Record<string, object>)?.[k] ?? {}).length
      ),
    })
    return out
  }, [optConfig, data, conditional, t])
}

/** A small tag: a requirement (a click opens its settings), or the line's note */
function ReqTag({
  children,
  accent,
  title,
  onClick,
}: {
  children: ReactNode
  /** A stat minimum: tinted, apart from the main stats */
  accent?: boolean
  title?: ReactNode
  onClick?: () => void
}) {
  const tag = (
    <ButtonBase
      component="span"
      disabled={!onClick}
      onClick={onClick}
      sx={(theme) => {
        const tone = accent
          ? theme.palette.primary.main
          : theme.palette.text.primary
        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 26,
          px: 1,
          borderRadius: tokens.radius.control,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          ...numSx,
          color: accent ? 'primary.light' : 'text.secondary',
          backgroundColor: alpha(tone, accent ? 0.1 : 0.05),
          border: `1px solid ${alpha(tone, accent ? 0.22 : 0.08)}`,
          ...quickSx,
          ...focusSx,
          '&.Mui-disabled': { pointerEvents: 'auto' },
          ...(onClick
            ? {
                cursor: 'pointer',
                '&:hover': {
                  color: accent ? 'primary.light' : 'text.primary',
                  borderColor: alpha(tone, accent ? 0.5 : 0.25),
                  backgroundColor: alpha(tone, accent ? 0.16 : 0.09),
                },
              }
            : {}),
        }
      }}
    >
      {children}
    </ButtonBase>
  )
  return title ? (
    <Tooltip arrow title={title}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}

/** A hover list: a title, its lines (one line each; the first 12, then how many more), a note */
function TagList({
  title,
  lines,
  note,
}: {
  title: ReactNode
  lines: ReactNode[]
  note?: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const shown = lines.length > 13 ? lines.slice(0, 12) : lines
  return (
    <Box sx={{ py: 0.25, maxWidth: 300 }}>
      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
        {title}
      </Typography>
      {shown.map((line, i) => (
        <Typography
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
          key={i}
          variant="caption"
          component="div"
          noWrap
          sx={{ color: 'text.secondary' }}
        >
          {line}
        </Typography>
      ))}
      {shown.length < lines.length && (
        <Typography variant="caption" component="div" color="text.disabled">
          {t('teamOpt.member.more', {
            defaultValue: '+{{count}} more',
            count: lines.length - shown.length,
          })}
        </Typography>
      )}
      {note && (
        <Typography
          variant="caption"
          component="div"
          sx={{ mt: 0.5, color: 'text.secondary' }}
        >
          {note}
        </Typography>
      )}
    </Box>
  )
}

function RequirementTag({
  req,
  onClick,
}: {
  req: Requirement
  onClick?: () => void
}) {
  const { t } = useTranslation(['page_team', 'artifactNames_gen'])
  const setName = (key: ArtifactSetKey) => t(`artifactNames_gen:${key}`)
  if (req.kind === 'stat')
    return (
      <ReqTag accent onClick={onClick}>
        {req.icon}
        <span>
          {req.name} {req.text}
        </span>
      </ReqTag>
    )
  // (the sets' list: the allowed ones when fewer than the excluded)
  const showAllowed =
    req.kind === 'sets' && req.allowed.length < req.excluded.length
  if (req.kind === 'sets')
    return (
      <ReqTag
        onClick={onClick}
        title={
          req.excluded.length || req.rainbow.length ? (
            // the shorter list: what is allowed when most is excluded
            <TagList
              title={
                showAllowed
                  ? t('teamOpt.member.setsAllowed', 'Allowed')
                  : t('teamOpt.member.setsExcluded', 'Excluded')
              }
              lines={(showAllowed ? req.allowed : req.excluded).map(
                ([key, nums]) =>
                  // (one bonus of the two: which)
                  nums.length === 1
                    ? `${setName(key)} · ${nums[0]}-pc`
                    : setName(key)
              )}
              note={
                req.rainbow.length
                  ? req.rainbow.length === 2
                    ? t('teamOpt.member.noMixed', 'No mixed sets')
                    : t('teamOpt.member.noMixedPc', {
                        defaultValue: 'Mixed sets: no {{pieces}}-pc',
                        pieces: req.rainbow[0],
                      })
                  : undefined
              }
            />
          ) : (
            t('teamOpt.member.allSetsHint', 'Any set and any mix')
          )
        }
      >
        <FlowerIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
        {req.excluded.length
          ? t('teamOpt.member.setsCount', {
              defaultValue: '{{allowed}}/{{total}} sets',
              allowed: req.allowed.length,
              total: req.total,
            })
          : t('teamOpt.member.allSets', 'All sets')}
      </ReqTag>
    )
  if (req.kind === 'effects')
    return (
      <ReqTag
        onClick={onClick}
        title={
          req.sets.length ? (
            <TagList
              title={t('teamOpt.member.effectsOn', 'Set effects on')}
              lines={req.sets.map(setName)}
            />
          ) : (
            t(
              'teamOpt.member.noEffectsHint',
              'Set effects count only when on: click to turn them on'
            )
          )
        }
      >
        <ToggleOnOutlinedIcon
          sx={{
            fontSize: 16,
            color: req.sets.length ? 'text.primary' : 'text.disabled',
          }}
        />
        {req.sets.length
          ? t('teamOpt.member.effectsCount', {
              defaultValue: '{{count}} effects',
              count: req.sets.length,
            })
          : t('teamOpt.member.noEffects', 'No effects')}
      </ReqTag>
    )
  const slots = req.slotKeys
    .map((slotKey) => t(`teamOpt.slot.${slotKey}`, slotNames[slotKey]))
    .join(', ')
  return (
    <ReqTag
      onClick={onClick}
      title={`${slots}: ${req.statKeys
        .map((k) => `${statName(k)}${getUnitStr(k)}`)
        .join(', ')}`}
    >
      {req.slotKeys.map((slotKey) => (
        <SlotIcon
          key={slotKey}
          slotKey={slotKey}
          iconProps={{
            sx: { fontSize: 14, color: 'text.disabled', mr: -0.25 },
          }}
        />
      ))}
      <Box
        component="span"
        sx={{ width: '1px', height: 12, bgcolor: 'divider', mx: 0.25 }}
      />
      {req.statKeys.map((k) => {
        const element = allElementWithPhyKeys.find((e) => k.startsWith(e))
        return (
          <Box
            key={k}
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
          >
            <StatIcon
              statKey={k}
              iconProps={{
                sx: {
                  fontSize: 14,
                  color: element ? `${element}.main` : undefined,
                },
              }}
            />
            {/* (several: icons only, the tooltip names them) */}
            {req.statKeys.length <= 2 && shortStat(k, t)}
          </Box>
        )
      })}
    </ReqTag>
  )
}

/** A stat's short name for a tag: "ATK%", "EM", "ER", "Crit Rate", "Electro DMG" */
function shortStat(key: MainStatKey, t: TFunction<'page_team'>) {
  if (key === 'eleMas') return t('teamOpt.short.eleMas', 'EM')
  if (key === 'enerRech_') return t('teamOpt.short.enerRech_', 'ER')
  if (key === 'heal_') return t('teamOpt.short.heal_', 'Healing')
  const name = statName(key).replace(/ Bonus$/, '')
  // (ATK%, HP%, DEF%: the percent tells them from the flat stat)
  return /^(atk|hp|def)_$/.test(key) ? `${name}%` : name
}
const slotNames = { sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }

/** A member's Optimize-tab requirements, edited from Team Optimize (they are the same settings) */
function RequirementsModal({
  teamId,
  member,
  teamData,
  setsOnly,
  onClose,
}: {
  teamId: string
  member: TeamOptMember
  teamData: TeamData | undefined
  /** Only the artifact set config's dialog */
  setsOnly?: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const team = useTeam(teamId)!
  const { characterKey, teamCharId, loadoutDatum } = member
  const teamChar = database.teamChars.get(teamCharId) ?? member.teamChar
  const character = useCharacter(characterKey)
  const data = teamData?.[characterKey]?.target
  const teamCharContext: TeamCharacterContextObj = useMemo(
    () => ({ teamId, team, teamCharId, teamChar, loadoutDatum }),
    [teamId, team, teamCharId, teamChar, loadoutDatum]
  )
  const characterContext = useMemo(
    () => character && { character },
    [character]
  )
  const dataContext = useMemo(
    () => data && teamData && { data, teamData },
    [data, teamData]
  )
  const optConfig = useOptConfig(teamChar.optConfigId)
  // the counts next to the main stats: what this member could use
  const filteredArtIdMap = useMemo(() => {
    const teamOpt = team.teamOpt
    if (!optConfig || !teamOpt) return {}
    const pool = teamOptPool(
      database.arts.values,
      member,
      optConfig,
      teamOpt,
      new Set<string>(),
      new Set<string>()
    )
    return Object.fromEntries(pool.map((a) => [a.id, true]))
  }, [database, member, optConfig, team.teamOpt])

  if (!characterContext || !dataContext) return null
  if (setsOnly)
    return (
      <TeamCharacterContext.Provider value={teamCharContext}>
        <CharacterContext.Provider value={characterContext}>
          <DataContext.Provider value={dataContext}>
            <ArtifactSetConfig dialogOnly onDialogClose={onClose} />
          </DataContext.Provider>
        </CharacterContext.Provider>
      </TeamCharacterContext.Provider>
    )
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      slotProps={stackedBackdrop}
    >
      <TeamCharacterContext.Provider value={teamCharContext}>
        <CharacterContext.Provider value={characterContext}>
          <DataContext.Provider value={dataContext}>
            <CardThemed sx={floatSx}>
              <DialogHead
                title={
                  <span>
                    <CharacterName
                      characterKey={characterKey}
                      gender={gender}
                    />
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {' · '}
                    </Box>
                    {t('teamOpt.requirements.title', 'Requirements')}
                  </span>
                }
                onClose={onClose}
              />
              <Box
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  display: 'grid',
                  gap: 1.5,
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  alignItems: 'start',
                }}
              >
                <Box
                  sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
                >
                  <StatFilterCard />
                  <ArtifactSetConfig />
                </Box>
                <SettingsCard
                  title={t('teamOpt.requirements.mainStats', 'Main stats')}
                >
                  <MainStatSelectionCard filteredArtIdMap={filteredArtIdMap} />
                </SettingsCard>
              </Box>
            </CardThemed>
          </DataContext.Provider>
        </CharacterContext.Provider>
      </TeamCharacterContext.Provider>
    </ModalWrapper>
  )
}
