import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { ArtifactSlotKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  artSlotMainKeys,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamCharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeam,
} from '@genshin-optimizer/gi/db-ui'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import { CharacterName, teamOptPool } from '@genshin-optimizer/gi/ui'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import {
  Box,
  Button,
  Collapse,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainStatSelectionCard from '../CharacterDisplay/Tabs/TabOptimize/Components/MainStatSelectionCard'
import { formatDamage, mainStatLabel } from './format'
import { MemberAvatar } from './MemberAvatar'
import { DialogHead } from './OptionTile'
import { MemberSettings, PoolSettings } from './TeamOptSettings'
import {
  FieldLabel,
  hairline,
  insetSx,
  numSx,
  PanelHeader,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * Before a run: what it searches. The inventory and weapons, then each member: whether it is
 * optimized, the size of its search and its main stats (all by default; fewer make its search
 * smaller, so the run faster). Then how many team builds to find, and Start.
 */
export function RunDialog({
  open,
  onClose,
  onStart,
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  poolSize,
}: {
  open: boolean
  onClose: () => void
  onStart: () => void
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  poolSize: number
}) {
  const { t } = useTranslation('page_team')
  const builds = teamOpt.topN ?? 1
  const optimized = members.filter(
    (m) => !m.isTc && !teamOpt.keep.includes(m.characterKey)
  ).length
  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
    >
      <CardThemed>
        <DialogHead
          title={t('teamOpt.runDialog.title', 'Optimize team')}
          info={t(
            'teamOpt.run.how',
            'Each member is optimized in turn for the whole rotation’s damage, the others fixed, the biggest damage dealer first. Rounds repeat until no build changes; then members trade pieces and weapons where the team gains.'
          )}
          onClose={onClose}
        />
        <Box
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            maxHeight: { xs: 'calc(100dvh - 150px)', sm: '72vh' },
            overflowY: 'auto',
            // (a scrolling column: its children keep their height)
            '& > *': { flexShrink: 0 },
          }}
        >
          {/* the inventory and weapons first: whether weapons are chosen too is a run's first choice */}
          <PoolSettings
            members={members}
            teamData={teamData}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            poolSize={poolSize}
          />
          <Box component="section">
            <PanelHeader
              title={t('teamOpt.runDialog.members', 'Members')}
              info={
                <>
                  {t(
                    'teamOpt.runDialog.sizeHint',
                    'Builds to search: the combinations of the artifacts a member may use with these settings (sets not counted). Fewer main stats make it smaller, so the run faster.'
                  )}
                  <br />
                  {t(
                    'teamOpt.pool.effects',
                    'Set effects count only when on (Requirements → Artifact sets)'
                  )}
                </>
              }
              actions={
                <Typography sx={{ ...type.label, ...numSx }}>
                  {t('teamOpt.run.summary', {
                    defaultValue: '{{count}} of {{total}} members optimized',
                    count: optimized,
                    total: members.length,
                  })}
                </Typography>
              }
              // (a gap between the title and its ⓘ)
              sx={{ mb: 1, '& h3': { gap: '6px' } }}
            />
            <Box sx={{ ...insetSx, overflow: 'hidden' }}>
              {members.map((member) => (
                <MemberRunRow
                  key={member.characterKey}
                  teamId={teamId}
                  member={member}
                  members={members}
                  teamData={teamData}
                  teamOpt={teamOpt}
                  setTeamOpt={setTeamOpt}
                />
              ))}
            </Box>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 1,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.5,
            borderTop: hairline,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FieldLabel
              tip={t(
                'teamOpt.run.buildsInfo',
                'How many team builds to find: the best one, then the next best ones (each changes one member’s artifacts).'
              )}
            >
              {t('teamOpt.run.buildsLabel', 'Builds')}
            </FieldLabel>
            <Segmented
              size="small"
              aria-label={t('teamOpt.run.buildsLabel', 'Builds')}
              value={builds}
              onChange={(n) =>
                setTeamOpt((o) => {
                  if (n > 1) o.topN = n
                  else delete o.topN
                })
              }
              options={[1, 2, 3, 4, 5].map((n) => ({
                value: n,
                label: <Box sx={{ minWidth: 10, ...numSx }}>{n}</Box>,
              }))}
            />
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {/* (phones: the title bar's close is the cancel) */}
          <Button
            color="inherit"
            onClick={onClose}
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {t('teamOpt.runDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            startIcon={<TrendingUpIcon />}
            onClick={() => {
              onClose()
              onStart()
            }}
            sx={{ ...giCtaSx, px: 2.25 }}
          >
            {t('teamOpt.runDialog.start', 'Start')}
          </Button>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

const mainSlots = ['sands', 'goblet', 'circlet'] as const
const slotNames = { sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }

/**
 * A member's line: optimized or kept, the size of its search, and its main stats, chosen as on
 * its Optimize page (the same card and settings: what is unticked here is unticked there)
 */
function MemberRunRow({
  teamId,
  member,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
}: {
  teamId: string
  member: TeamOptMember
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const team = useTeam(teamId)
  const { characterKey, isTc, teamCharId, loadoutDatum } = member
  const teamChar = database.teamChars.get(teamCharId) ?? member.teamChar
  const optConfig = useOptConfig(teamChar.optConfigId)
  const kept = isTc || teamOpt.keep.includes(characterKey)
  // the Optimize page's main stat card reads the member from this context
  const teamCharContext = useMemo<TeamCharacterContextObj | undefined>(
    () => team && { teamId, team, teamCharId, teamChar, loadoutDatum },
    [teamId, team, teamCharId, teamChar, loadoutDatum]
  )
  const locations = useMemo(
    () => new Set(members.map((m) => m.location as string)),
    [members]
  )
  // its search: the builds of its artifacts these settings allow (sets not counted)
  const size = useMemo(() => {
    if (!optConfig || kept) return 0
    const pool = teamOptPool(
      database.arts.values,
      member,
      optConfig,
      teamOpt,
      locations,
      new Set()
    )
    const perSlot = Object.fromEntries(
      allArtifactSlotKeys.map((s) => [s, 0])
    ) as Record<ArtifactSlotKey, number>
    for (const art of pool) perSlot[art.slotKey]++
    return Object.values(perSlot).reduce((a, b) => a * b, 1)
  }, [database, member, optConfig, teamOpt, locations, kept])

  const [open, setOpen] = useState(false)
  const expanded = open && !kept && !!teamCharContext
  // the main stats it may use, per slot (none ticked, or all: any)
  const mainStats = optConfig?.mainStatKeys as
    | Partial<Record<ArtifactSlotKey, string[]>>
    | undefined
  const toggle = (
    <Tooltip
      arrow
      title={
        isTc
          ? t('teamOpt.member.tc', 'TC build: kept as it is')
          : t('teamOpt.member.optimize', 'Optimize artifacts')
      }
    >
      <Switch
        size="small"
        checked={!kept}
        disabled={isTc}
        onChange={() =>
          setTeamOpt((o) => {
            o.keep = o.keep.includes(characterKey)
              ? o.keep.filter((k) => k !== characterKey)
              : [...o.keep, characterKey]
          })
        }
        inputProps={{
          'aria-label': t('teamOpt.member.optimize', 'Optimize artifacts'),
        }}
      />
    </Tooltip>
  )

  return (
    <Box sx={{ '& + &': { borderTop: hairline } }}>
      {/* one line: the member, whether it is optimized, its search, its main stats */}
      <Box
        sx={{
          display: 'grid',
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 0.75,
          px: 1.5,
          py: 1,
          minHeight: 52,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr) auto',
            md: 'minmax(140px, 180px) auto minmax(150px, 190px) minmax(0, 1fr) auto',
          },
          gridTemplateAreas: {
            xs: '"who toggle" "size size" "mains custom"',
            md: '"who toggle size mains custom"',
          },
        }}
      >
        <Box
          sx={{
            gridArea: 'who',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minWidth: 0,
            opacity: kept ? 0.6 : 1,
            ...quickSx,
          }}
        >
          <Box sx={{ display: 'flex', filter: kept ? 'grayscale(1)' : 'none' }}>
            <MemberAvatar characterKey={characterKey} />
          </Box>
          <Typography sx={{ fontSize: 14.5, fontWeight: 600 }} noWrap>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
        </Box>
        <Box
          sx={{
            gridArea: 'toggle',
            display: 'flex',
            ml: -0.75,
            borderRadius: tokens.radius.pill,
            // (the switch's keyboard focus: the same ring as the other controls)
            '&:has(.Mui-focusVisible)': {
              outline: `2px solid ${tokens.gold}`,
              outlineOffset: -2,
            },
          }}
        >
          {toggle}
        </Box>
        <Typography
          sx={{
            gridArea: 'size',
            fontSize: 13,
            color: 'text.secondary',
            ...numSx,
          }}
          noWrap
        >
          {isTc
            ? t('teamOpt.member.tc', 'TC build: kept as it is')
            : kept
              ? t('teamOpt.member.kept', 'Keeps its build')
              : t('teamOpt.runDialog.size', {
                  defaultValue: '≈ {{size}} builds to search',
                  size: formatDamage(size),
                })}
        </Typography>
        {!kept && (
          <Box
            sx={{
              gridArea: 'mains',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1.5,
              rowGap: 0.5,
              minWidth: 0,
            }}
          >
            {mainSlots.map((slot) => (
              <MainStatSummary
                key={slot}
                slot={slot}
                keys={mainStats?.[slot] ?? []}
              />
            ))}
          </Box>
        )}
        {!kept && teamCharContext && (
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={expanded}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transition: `transform .18s ${tokens.ease}`,
                  transform: expanded ? 'rotate(180deg)' : 'none',
                }}
              />
            }
            sx={(theme) => ({
              gridArea: 'custom',
              justifySelf: 'end',
              minHeight: 30,
              py: 0,
              color: expanded ? 'text.primary' : 'text.secondary',
              bgcolor: expanded ? theme.palette.action.selected : 'transparent',
              '&:hover': { color: 'text.primary' },
            })}
          >
            {t('teamOpt.runDialog.customize', 'Customize')}
          </Button>
        )}
      </Box>
      <Collapse in={expanded} timeout={180} unmountOnExit>
        {teamCharContext && (
          <MemberCustomize
            teamId={teamId}
            member={member}
            teamData={teamData}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            teamCharContext={teamCharContext}
            locations={locations}
          />
        )}
      </Collapse>
    </Box>
  )
}

/** A slot's main stats on a member's line: its icon, then the stats, a count, or Any */
function MainStatSummary({
  slot,
  keys,
}: {
  slot: (typeof mainSlots)[number]
  keys: string[]
}) {
  const { t } = useTranslation('page_team')
  const any = !keys.length || keys.length >= artSlotMainKeys[slot].length
  const names = keys.map(mainStatLabel).join(', ')
  return (
    <Tooltip
      arrow
      title={`${t(`teamOpt.slot.${slot}`, slotNames[slot])}: ${
        any ? t('teamOpt.runDialog.anyMain', 'Any') : names
      }`}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          minWidth: 0,
          fontSize: 13,
          color: any ? 'text.secondary' : 'text.primary',
        }}
      >
        <SlotIcon
          slotKey={slot}
          iconProps={{ sx: { fontSize: 15, color: 'text.secondary' } }}
        />
        <Box
          component="span"
          sx={{
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {any
            ? t('teamOpt.runDialog.anyMain', 'Any')
            : keys.length > 3
              ? t('teamOpt.runDialog.mainCount', {
                  defaultValue: '{{count}} main stats',
                  count: keys.length,
                })
              : names}
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A member's details, opened from Customize: its constraints, then its main stats */
function MemberCustomize({
  teamId,
  member,
  teamData,
  teamOpt,
  setTeamOpt,
  teamCharContext,
  locations,
}: {
  teamId: string
  member: TeamOptMember
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  teamCharContext: TeamCharacterContextObj
  locations: Set<string>
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const optConfig = useOptConfig(teamCharContext.teamChar.optConfigId)
  // the counts next to the main stats: the artifacts it could use, whatever main stats are ticked
  const filteredArtIdMap = useMemo(() => {
    if (!optConfig) return {}
    const anyMain = {
      ...optConfig,
      mainStatKeys: { sands: [], goblet: [], circlet: [] },
    } as typeof optConfig
    return Object.fromEntries(
      teamOptPool(
        database.arts.values,
        member,
        anyMain,
        teamOpt,
        locations,
        new Set()
      ).map((a) => [a.id, true])
    )
  }, [database, member, optConfig, teamOpt, locations])
  return (
    <Box
      sx={{
        px: 1.5,
        pb: 1.5,
        pt: 0.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {/* stat minimums, sets and effects (the Requirements dialog) */}
      <MemberSettings
        teamId={teamId}
        member={member}
        teamData={teamData}
        teamOpt={teamOpt}
        setTeamOpt={setTeamOpt}
        showOptimizeToggle={false}
      />
      <Box>
        <FieldLabel
          tip={t(
            'teamOpt.runDialog.mainStatsHint',
            'The main stats it may use per slot (none ticked: any). The same settings as its Optimize tab.'
          )}
          sx={{ mb: 0.75 }}
        >
          {t('teamOpt.requirements.mainStats', 'Main stats')}
        </FieldLabel>
        <TeamCharacterContext.Provider value={teamCharContext}>
          <MainStatSelectionCard filteredArtIdMap={filteredArtIdMap} />
        </TeamCharacterContext.Provider>
      </Box>
    </Box>
  )
}
