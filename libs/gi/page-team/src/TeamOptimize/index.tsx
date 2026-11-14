import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  evaluateTeamRotation,
  teamOptBonusStats,
  teamOptCurrentWeapons,
  teamOptMembers,
  teamOptPool,
  teamStatFilters,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import {
  Alert,
  alpha,
  Box,
  Button,
  FormControlLabel,
  InputBase,
  LinearProgress,
  Switch,
  Typography,
} from '@mui/material'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { kqmTheorycraftingEnabled } from '../featureFlags'
import { buffsForAttacker, useTeamBuffs } from './buffs'
import { ExtraBuffs } from './ExtraBuffs'
import { defaultRotationTime, formatDamage, formatRate } from './format'
import { KqmProgress, KqmResults, KqmSettings } from './KqmMode'
import { MemberAvatar } from './MemberAvatar'
import { MemberRotation } from './MemberRotation'
import { RotationInline } from './RotationInline'
import { RotationTransfer } from './RotationTransfer'
import { RotationConfigureButton, useRotationWriter } from './RotationWriter'
import { RunDialog } from './RunDialog'
import { TeamOptResults } from './TeamOptResults'
import { TeamSensitivity } from './TeamSensitivity'
import {
  Disclosure,
  FieldLabel,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  StatTile,
  tokens,
  type,
  VDivider,
} from './ui'
import type { KqmRunState } from './useKqmRun'
import { useKqmRun } from './useKqmRun'
import { kqmRunKey, teamOptRunKey, useTeamOpt } from './useTeamOpt'
import type { TeamOptRunState, TeamOptStatus } from './useTeamOptRun'
import { useTeamOptRun } from './useTeamOptRun'

/** A section of the page: its own panel on the page's ink, as the results are */
const sectionSx = {
  bgcolor: tokens.panel,
  border: hairline,
  borderRadius: tokens.radius.panel,
  p: tokens.pad,
  minWidth: 0,
} as const

/** A result appears once: a short fade and rise (none with reduced motion) */
const revealSx = {
  '@keyframes teamOptReveal': {
    from: { opacity: 0, transform: 'translateY(6px)' },
    to: { opacity: 1, transform: 'none' },
  },
  animation: 'teamOptReveal .22s cubic-bezier(.2,.7,.2,1)',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
} as const

/** One shared team rotation, with separate inventory and KQM build workflows. */
export default function TeamBuildWorkspace({
  teamId,
  teamData,
  mode,
}: {
  teamId: string
  teamData: TeamData | undefined
  mode: 'inventory' | 'kqm'
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  const [teamOpt, setTeamOpt] = useTeamOpt(teamId)
  // `teamData` is recomputed whenever a member, a build or a conditional changes
  const members = useMemo(
    () => teamOptMembers(database, teamId),
    [database, teamId, team, teamData]
  )
  const buffs = useTeamBuffs(teamId, teamData)
  // the rotation with the builds equipped now: Team optimize's only (KQM theorycrafting never
  // counts or shows the members' own builds)
  const evaluation = useCurrentEvaluation(
    teamId,
    teamOpt,
    mode === 'inventory' ? teamData : undefined
  )
  const { state, status, run, cancel, clear } = useTeamOptRun(teamId)
  const kqm = useKqmRun(teamId)
  const kqmRunning = kqm.state.type === 'running'
  // either run in progress: the settings stay as they are
  const running = state.type === 'running' || kqmRunning
  const rotationTitleId = useId()
  const rotationBodyId = useId()
  // (as set for this team, else the default: damage is also shown per second)
  const rotationTime = teamOpt.rotationTime ?? defaultRotationTime
  // who is on the field by default: as chosen, else the team's first member (as in the app)
  const onField =
    teamOpt.onField && members.some((m) => m.characterKey === teamOpt.onField)
      ? teamOpt.onField
      : members[0]?.characterKey

  const attackCount = members.reduce(
    (n, m) => n + (teamOpt.attacks[m.characterKey]?.length ?? 0),
    0
  )
  const optimizable = members.filter(
    (m) => !m.isTc && !teamOpt.keep.includes(m.characterKey)
  )
  const poolSize = usePoolSize(members, teamOpt)
  const [runDialog, setRunDialog] = useState(false)
  useEffect(() => setRunDialog(false), [mode])
  const [rotationExpanded, setRotationExpanded] = useState(() => !attackCount)
  // the rotation written as text (inline), and its writer dialog with Undo
  const writer = useRotationWriter({ teamId, members, setTeamOpt })
  // Extra buffs: their count, and the section open when there are some
  const extraCount = Object.values(teamOpt.bonusStats ?? {}).reduce(
    (n, stats) => n + Object.values(stats ?? {}).filter((v) => !!v).length,
    0
  )
  const [extraOpen, setExtraOpen] = useState(() => extraCount > 0)
  const kqmDone =
    kqm.state.type === 'done'
      ? kqm.state
      : kqmRunning
        ? kqm.lastResult
        : undefined
  const kqmResult =
    kqmDone &&
    Object.keys(kqmDone.result.builds).every((ck) =>
      members.some((m) => m.characterKey === ck)
    )
      ? kqmDone
      : undefined
  useEffect(() => {
    if (kqm.state.type !== 'done') return
    setRotationExpanded(false)
    if (mode === 'kqm')
      requestAnimationFrame(() =>
        document
          .getElementById(`kqm-results-${teamId}`)
          ?.scrollIntoView({ block: 'start' })
      )
  }, [kqm.state, mode, teamId])
  // KQM theorycrafting's own rotation, while its result is for the rotation as it is: the attacks
  // it played for its builds (at its constellations, with their gear), with their damage
  const kqmRotation =
    mode === 'kqm' &&
    kqmResult &&
    kqmRunKey(kqmResult.teamOpt) === kqmRunKey(teamOpt)
      ? kqmResult
      : undefined
  const setAttacks = useCallback(
    (characterKey: CharacterKey) =>
      (update: (attacks: TeamOptAttack[]) => TeamOptAttack[]) => {
        if (running) return
        setTeamOpt((o) => {
          o.attacks[characterKey] = update(o.attacks[characterKey] ?? [])
        })
      },
    [setTeamOpt, running]
  )
  // a result for another line-up is of no use
  const result =
    state.type === 'done' &&
    Object.keys(state.result.builds).every((ck) =>
      members.some((m) => m.characterKey === ck)
    )
      ? state
      : undefined
  // which of the result's team builds is shown (the best, or one of the next ones)
  const [pick, setPick] = useState(0)
  const builds = result ? teamBuilds(result.result) : []
  const shown = builds[Math.min(pick, builds.length - 1)]
  useEffect(() => setPick(0), [result?.result])
  // a new result: the rotation folds away (it opens again with a click) and the result, below it,
  // comes into view
  useEffect(() => {
    if (mode !== 'inventory' || !result) return
    setRotationExpanded(false)
    requestAnimationFrame(() =>
      document
        .getElementById(`teamopt-results-${teamId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }, [mode, result, teamId])
  // power users can show each attack's buff states and limits inline
  const [showConditions, setShowConditions] = useState(
    () => localStorage.getItem('teamOpt.showConditions') === '1'
  )
  const toggleConditions = () =>
    setShowConditions((on) => {
      localStorage.setItem('teamOpt.showConditions', on ? '0' : '1')
      return !on
    })

  if (!members.length) return <EmptyTeam teamId={teamId} />

  return (
    // each section is its own panel on the page, 16 px apart
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* the rotation: what it is with its actions and figures, then its settings, then the team */}
      <Box
        component="section"
        aria-labelledby={rotationTitleId}
        sx={{
          ...sectionSx,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 1.25,
          }}
        >
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}
          >
            <Typography
              id={rotationTitleId}
              component="h2"
              sx={{ ...type.section, whiteSpace: 'nowrap' }}
            >
              {t('teamOpt.rotation.title', 'Rotation')}
            </Typography>
            <InfoTooltipInline
              title={t(
                'teamOpt.rotation.info',
                'Add each member’s attacks and hits for one rotation. This rotation is shared by Team Optimize and KQM Theorycrafting.'
              )}
            />
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 0.75,
            }}
          >
            <RotationConfigureButton
              teamId={teamId}
              writer={writer}
              disabled={running}
            />
            <RotationTransfer
              members={members}
              teamOpt={teamOpt}
              setTeamOpt={setTeamOpt}
              disabled={running}
            />
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {!!attackCount && mode === 'inventory' && (
            <HeaderStats
              total={evaluation?.total}
              rotationTime={rotationTime}
              equipped={!!result && !!shown}
            />
          )}
        </Box>
        {/* the rotation as text: read as its steps, edited in place */}
        <RotationInline
          teamId={teamId}
          members={members}
          setTeamOpt={setTeamOpt}
          writer={writer}
          replaces={!!attackCount}
          disabled={running}
        />
        {writer.element}
        {/* the rotation's settings, in one row of labelled controls */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 2,
            rowGap: 1,
            minHeight: 34,
          }}
        >
          <RotationTimeInput
            // (KQM's: the time of the rotation it played, which it counts)
            value={
              kqmRotation?.rotation === 'played'
                ? (kqmRotation.runTeamOpt.rotationTime ?? rotationTime)
                : rotationTime
            }
            disabled={running || kqmRotation?.rotation === 'played'}
            onChange={(seconds) =>
              setTeamOpt((o) => {
                if (seconds && seconds !== defaultRotationTime)
                  o.rotationTime = seconds
                else delete o.rotationTime
              })
            }
          />
          {onField && members.length > 1 && (
            <OnFieldPicker
              members={members}
              value={onField}
              disabled={running}
              onChange={(characterKey) =>
                setTeamOpt((o) => {
                  if (characterKey === members[0]?.characterKey)
                    delete o.onField
                  else o.onField = characterKey
                })
              }
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          {rotationExpanded && !!attackCount && (
            <FormControlLabel
              sx={{ mr: 0, ml: -0.5, gap: 0.5 }}
              control={
                <Switch
                  size="small"
                  checked={showConditions}
                  onChange={toggleConditions}
                />
              }
              label={
                <Typography component="span" sx={type.label}>
                  {t('teamOpt.rotation.showConditions', 'Show buff conditions')}
                </Typography>
              }
            />
          )}
        </Box>
        {/* one panel for the team: folded, a line per member; open, a column per member with
            hairlines between them */}
        <Box
          sx={{
            ...insetSx,
            overflow: 'hidden',
            containerType: 'inline-size',
          }}
        >
          <Box
            id={rotationBodyId}
            sx={{
              minWidth: 0,
              display: 'grid',
              gap: '1px',
              // (the hairlines between the members: the grid's gaps over this colour)
              bgcolor: tokens.hairline,
              gridTemplateColumns: 'minmax(0, 1fr)',
              '@container (min-width: 520px)': {
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              },
              '@container (min-width: 1040px)': {
                gridTemplateColumns: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
              },
            }}
          >
            {members.map((member) => (
              <MemberRotation
                key={member.characterKey}
                teamId={teamId}
                member={member}
                teamData={teamData}
                attacks={
                  (kqmRotation?.runTeamOpt ?? teamOpt).attacks[
                    member.characterKey
                  ] ?? []
                }
                setAttacks={setAttacks(member.characterKey)}
                evaluation={
                  mode === 'inventory' ? evaluation : kqmRotation?.result.after
                }
                figures={mode === 'inventory'}
                played={kqmRotation?.rotation === 'played'}
                buffs={buffsForAttacker(buffs, member.characterKey)}
                mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
                members={members}
                onField={onField ?? member.characterKey}
                rotationTime={
                  kqmRotation?.runTeamOpt.rotationTime ?? rotationTime
                }
                showConditions={showConditions}
                expanded={rotationExpanded}
                onToggle={
                  attackCount ? () => setRotationExpanded((o) => !o) : undefined
                }
                disabled={running}
              />
            ))}
          </Box>
        </Box>
        {/* buffs the game data does not have (food, an Abyss blessing…): the panel's footer */}
        <Disclosure
          label={t('teamOpt.bonus.advanced', 'Extra buffs (food, blessings…)')}
          count={
            extraCount > 0
              ? t('teamOpt.extra.count', {
                  defaultValue: '{{count}} buffs',
                  count: extraCount,
                })
              : undefined
          }
          info={t(
            'teamOpt.extra.info',
            'Buffs the game data does not have, like food, an Abyss blessing or your own numbers. For the whole team or one member: they count on its hits and in its stats and requirements.'
          )}
          open={extraOpen}
          onToggle={() => setExtraOpen((open) => !open)}
          sx={{ ml: -0.25, pt: 1.25, mt: 0.25, borderTop: hairline }}
        >
          <ExtraBuffs
            members={members}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            disabled={running}
          />
        </Disclosure>
      </Box>

      {/* (only on the KQM tab: kept mounted there while its results show, to keep its drafts) */}
      {kqmTheorycraftingEnabled && mode === 'kqm' && (
        <Box sx={{ ...sectionSx, p: 0 }}>
          <KqmSettings
            active={mode === 'kqm'}
            hasResult={!!kqmResult}
            disabled={running}
            canRun={!!attackCount}
            onStart={kqm.run}
            teamId={teamId}
            members={members}
            teamData={teamData}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
          />
        </Box>
      )}
      {/* before a run: what it searches (main stats, inventory, weapons, builds) */}
      {mode === 'inventory' && runDialog && (
        <RunDialog
          open
          onClose={() => setRunDialog(false)}
          onStart={run}
          teamId={teamId}
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          poolSize={poolSize}
        />
      )}

      {mode === 'kqm' && kqm.state.type === 'error' && (
        <Alert severity="error" onClose={kqm.clear}>
          {t('teamOpt.kqm.error', 'KQM builds stopped:')} {kqm.state.message}
        </Alert>
      )}
      {mode === 'kqm' && kqmResult && (
        <Box key={kqmResult.seconds} sx={{ ...revealSx, ...sectionSx, p: 0 }}>
          <KqmResults
            teamId={teamId}
            running={running}
            runSettings={kqmResult.runTeamOpt ?? kqmResult.teamOpt}
            setup={kqmResult.teamOpt}
            rotation={kqmResult.rotation}
            stalls={kqmResult.stalls}
            members={members}
            result={kqmResult.result}
            seconds={kqmResult.seconds}
            // (the run's: the written rotation at the KQM constellations takes its own time)
            rotationTime={
              (kqmResult.runTeamOpt ?? kqmResult.teamOpt).rotationTime ??
              rotationTime
            }
            stale={kqmRunKey(kqmResult.teamOpt) !== kqmRunKey(teamOpt)}
            now={teamOpt}
            onDiscard={() => {
              kqm.clear()
              setRotationExpanded(true)
            }}
          />
        </Box>
      )}
      {/* the run's result, below what it was run with (the rotation) */}
      {mode === 'inventory' && state.type === 'error' && (
        <Alert severity="error" onClose={clear}>
          {state.setRulesUnmet?.length ? (
            <SetRulesUnmet characterKeys={state.setRulesUnmet} />
          ) : (
            <>
              {t('teamOpt.run.error', 'Team Optimize stopped:')} {state.message}
            </>
          )}
        </Alert>
      )}
      {mode === 'inventory' && result && shown && builds.length > 1 && (
        <TeamBuildPicker
          builds={builds}
          value={builds.indexOf(shown)}
          onChange={setPick}
          rotationTime={rotationTime}
        />
      )}
      {mode === 'inventory' && result && shown && (
        <Box
          key={result.seconds + (result.teamOpt ? '' : '-')}
          id={`teamopt-results-${teamId}`}
          sx={{ ...revealSx, scrollMarginTop: 88 }}
        >
          <TeamOptResults
            teamId={teamId}
            members={members}
            result={shown}
            seconds={result.seconds}
            runTeamOpt={result.teamOpt}
            rotationTime={rotationTime}
            onDiscard={clear}
            teamData={teamData}
            stale={teamOptRunKey(result.teamOpt) !== teamOptRunKey(teamOpt)}
            onRunAgain={() => setRunDialog(true)}
          />
        </Box>
      )}
      {/* what one more roll, talent level or level on each member would add */}
      {mode === 'inventory' && result && shown && (
        <TeamSensitivity
          teamId={teamId}
          members={members}
          // (the result's: its rotation and settings, as it was found)
          teamOpt={result.teamOpt}
          result={shown}
          savedAt={result.savedAt}
          index={Math.min(pick, builds.length - 1)}
        />
      )}
      {/* last on the page: it stays pinned to the window's foot while anything above scrolls */}
      {(mode === 'inventory' || running) && (
        <RunBar
          teamId={teamId}
          state={state}
          status={status}
          members={members}
          attackCount={attackCount}
          optimizable={optimizable}
          onRun={() => setRunDialog(true)}
          onCancel={cancel}
          kqmState={kqm.state}
          onKqmCancel={kqm.cancel}
        />
      )}
    </Box>
  )
}

/** A team without members: what to do first, and the way there */
function EmptyTeam({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const navigate = useNavigate()
  return (
    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 1.5,
          px: 3,
          py: { xs: 5, md: 7 },
          borderRadius: tokens.radius.panel,
          border: `1px dashed ${tokens.hairlineStrong}`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 48,
            height: 48,
            borderRadius: '50%',
            bgcolor: tokens.raised,
            color: 'text.secondary',
          }}
        >
          <GroupsIcon />
        </Box>
        <Typography
          component="h2"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {t('teamOpt.empty.title', 'Add the team’s members first')}
          <InfoTooltipInline
            title={t(
              'teamOpt.empty.desc',
              'Team Optimize finds artifacts for the whole team at once, for one rotation of their attacks.'
            )}
          />
        </Typography>
        <Button
          variant="contained"
          startIcon={<GroupsIcon />}
          sx={giCtaSx}
          onClick={() => navigate(`/teams/${teamId}`)}
        >
          {t('teamOpt.empty.action', 'Team settings')}
        </Button>
      </Box>
    </Box>
  )
}

/** How long one rotation takes, in seconds, for the DPS (empty: back to the default) */
function RotationTimeInput({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (seconds: number | undefined) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [text, setText] = useState(`${value}`)
  useEffect(() => setText(`${value}`), [value])
  const commit = () => {
    const seconds = Number.parseFloat(text.replace(',', '.'))
    const next =
      Number.isFinite(seconds) && seconds > 0
        ? Math.min(seconds, 600)
        : undefined
    setText(`${next ?? defaultRotationTime}`)
    if (next !== value) onChange(next)
  }
  return (
    <Box
      component="label"
      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
    >
      <FieldLabel
        tip={t(
          'teamOpt.rotationTime.info',
          'How long one rotation takes, for the DPS. Saved for this team.'
        )}
      >
        {t('teamOpt.rotationTime.label', 'Rotation time')}
      </FieldLabel>
      <InputBase
        value={text}
        placeholder={`${defaultRotationTime}`}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        inputProps={{
          inputMode: 'decimal',
          'aria-label': t('teamOpt.rotationTime.label', 'Rotation time'),
        }}
        endAdornment={
          <Typography
            component="span"
            sx={{ ...type.label, ml: 0.25, pointerEvents: 'none' }}
          >
            s
          </Typography>
        }
        sx={{
          height: 30,
          pl: 1,
          pr: 0.875,
          borderRadius: tokens.radius.control,
          border: `1px solid ${tokens.hairlineStrong}`,
          bgcolor: tokens.inset,
          fontSize: 13.5,
          fontWeight: 600,
          ...numSx,
          ...quickSx,
          '&:hover': { borderColor: alpha(giTokens.parchment, 0.3) },
          '&.Mui-focused': { borderColor: tokens.gold },
          '&.Mui-disabled': { opacity: 0.5 },
          '& input': { width: '2.5em', textAlign: 'right', p: 0 },
        }}
      />
    </Box>
  )
}

/** The rotation's damage and its DPS, side by side */
function HeaderStats({
  total,
  rotationTime,
  equipped,
}: {
  total: number | undefined
  rotationTime: number
  /** A result is on screen too: say these are the equipped builds' numbers */
  equipped?: boolean
}) {
  const { t } = useTranslation('page_team')
  const tip = t('teamOpt.header.equippedTip', 'With the builds equipped now')
  // (the figures keep their width while they change: nothing beside them moves)
  const valueSx = { '& .MuiTypography-root': { minWidth: '7.5ch' } } as const
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
      <StatTile
        label={
          equipped
            ? t('teamOpt.header.equippedTotal', 'Equipped DMG')
            : t('teamOpt.header.total', 'Rotation DMG')
        }
        tip={tip}
        value={formatDamage(total, true)}
        sx={valueSx}
      />
      <VDivider />
      <StatTile
        label={
          equipped
            ? t('teamOpt.header.equippedDps', 'Equipped DPS')
            : t('teamOpt.header.dps', 'DPS')
        }
        tip={tip}
        value={formatRate(total, rotationTime, true)}
        sx={valueSx}
      />
    </Box>
  )
}

/**
 * Who is on the field during the rotation's hits, unless an attack says otherwise: buffs for the
 * active character (e.g. Mitya's C1 CRIT DMG) go to them
 */
function OnFieldPicker({
  members,
  value,
  onChange,
  disabled,
}: {
  members: TeamOptMember[]
  value: CharacterKey
  onChange: (characterKey: CharacterKey) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.onField.info',
          'Who is on the field during the rotation’s hits, unless an attack says otherwise (open it to change it). Buffs for the active character, like Mitya’s C1 CRIT DMG, go to them, and the ones for off-field characters to the others. Elsewhere the app counts the team’s first member as on the field.'
        )}
      >
        {t('teamOpt.onField.label', 'On field')}
      </FieldLabel>
      <Segmented
        size="small"
        aria-label={t('teamOpt.onField.label', 'On field')}
        value={value}
        // (the one already on the field: nothing to change)
        onChange={(characterKey) =>
          characterKey !== value && onChange(characterKey)
        }
        options={members.map((m) => ({
          value: m.characterKey,
          disabled,
          tip: <CharacterName characterKey={m.characterKey} gender={gender} />,
          label: (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                // the others, quieter: the one on the field stands out
                opacity: m.characterKey === value ? 1 : 0.7,
                filter: m.characterKey === value ? 'none' : 'saturate(.7)',
                transition: 'opacity .12s, filter .12s',
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
                '*:hover > &': { opacity: 1, filter: 'none' },
              }}
            >
              <MemberAvatar characterKey={m.characterKey} size={22} />
            </Box>
          ),
        }))}
      />
    </Box>
  )
}

/** The page's one main action (Cancel while running), with the run's progress */
function RunBar({
  teamId,
  state,
  status,
  members,
  attackCount,
  optimizable,
  onRun,
  onCancel,
  kqmState,
  onKqmCancel,
}: {
  state: TeamOptRunState
  status: TeamOptStatus
  members: TeamOptMember[]
  attackCount: number
  optimizable: TeamOptMember[]
  /** Opens the run's dialog (it starts the run) */
  onRun: () => void
  onCancel: () => void
  kqmState: KqmRunState
  onKqmCancel: () => void
  teamId: string
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const kqmRunning = kqmState.type === 'running'
  const running = state.type === 'running' || kqmRunning
  const blocked = !attackCount
    ? t('teamOpt.run.noAttacks', 'Add the rotation’s attacks first.')
    : !optimizable.length
      ? t(
          'teamOpt.run.allKept',
          'Every member’s build is kept: nothing to optimize.'
        )
      : undefined

  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: { xs: 8, sm: 12 },
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 56,
        pl: { xs: 1.5, sm: 2 },
        pr: 1,
        py: 1,
        borderRadius: tokens.radius.panel,
        overflow: 'hidden',
        // it floats over the page while scrolling: raised, with a shadow
        bgcolor: alpha(tokens.raised, 0.94),
        backdropFilter: 'blur(8px)',
        border: `1px solid ${tokens.hairlineStrong}`,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
      }}
    >
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
        }}
      >
        {kqmRunning ? (
          <KqmProgress
            teamId={teamId}
            members={members.map((m) => m.characterKey)}
            startTime={kqmState.startTime}
          />
        ) : state.type === 'running' ? (
          <RunProgress state={state} status={status} gender={gender} />
        ) : (
          <>
            {!blocked && (
              <Box
                sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5 }}
                aria-hidden
              >
                {members.map(({ characterKey }) => {
                  const on = optimizable.some(
                    (m) => m.characterKey === characterKey
                  )
                  return (
                    <Box
                      key={characterKey}
                      sx={{
                        display: 'flex',
                        opacity: on ? 1 : 0.3,
                        filter: on ? 'none' : 'grayscale(1)',
                      }}
                    >
                      <MemberAvatar characterKey={characterKey} size={26} />
                    </Box>
                  )
                })}
              </Box>
            )}
            <Typography
              sx={{
                ...type.body,
                ...numSx,
                fontWeight: blocked ? 400 : 500,
                color: blocked ? 'text.secondary' : 'text.primary',
                fontSize: { xs: 13.5, sm: 14 },
                lineHeight: 1.35,
                // (one line; a reason may take two on phones)
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: { xs: 2, sm: 1 },
                overflow: 'hidden',
              }}
            >
              {blocked ??
                t('teamOpt.run.toOptimize', {
                  defaultValue: '{{count}} of {{total}} to optimize',
                  count: optimizable.length,
                  total: members.length,
                })}
            </Typography>
          </>
        )}
      </Box>

      {running ? (
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<CloseIcon />}
          onClick={kqmRunning ? onKqmCancel : onCancel}
          sx={{ flexShrink: 0, minHeight: 36, ...quickSx }}
        >
          {t('teamOpt.run.cancel', 'Cancel')}
        </Button>
      ) : (
        <Button
          variant="contained"
          color="inherit"
          startIcon={<TrendingUpIcon />}
          disabled={!!blocked}
          onClick={onRun}
          sx={[
            { flexShrink: 0, minHeight: 36, px: 2, fontWeight: 650 },
            !blocked && giCtaSx,
          ]}
        >
          {t('teamOpt.run.button', 'Optimize team')}
        </Button>
      )}
    </Box>
  )
}

/** The thin gold line along the run bar's foot (measured when `value` is given) */
function ProgressLine({ value }: { value?: number }) {
  return (
    <LinearProgress
      aria-hidden
      variant={value === undefined ? 'indeterminate' : 'determinate'}
      value={value}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        bgcolor: 'transparent',
      }}
    />
  )
}

/** A run without a result: no team build keeps these members to their allowed sets */
function SetRulesUnmet({ characterKeys }: { characterKeys: CharacterKey[] }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <>
      {t('teamOpt.run.setRulesUnmet', 'No team build fits the allowed sets of')}{' '}
      {characterKeys.map((ck, i) => (
        <Fragment key={ck}>
          {i > 0 && ', '}
          <strong>
            <CharacterName characterKey={ck} gender={gender} />
          </strong>
        </Fragment>
      ))}
      {'. '}
      <InfoTooltipInline
        title={t(
          'teamOpt.run.setRulesUnmetWhy',
          'Even with the pieces the other members hold, no build of the artifacts they may use keeps to the sets allowed on their Optimize tab (Requirements → Artifact sets), with their main stats and the inventory settings. Allow more sets, or free up pieces of the sets they need.'
        )}
      />
    </>
  )
}

function RunProgress({
  state,
  status,
  gender,
}: {
  state: Extract<TeamOptRunState, { type: 'running' }>
  status: TeamOptStatus
  gender: 'F' | 'M'
}) {
  const { t } = useTranslation('page_team')
  // the solver's counters are updated in place: poll them
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 300)
    return () => clearInterval(timer)
  }, [])
  // the run's step, kept with its counters (see `TeamOptStatus.step`)
  const step = status.step ?? state.step
  const seconds = (performance.now() - state.startTime) / 1000
  const total = Number.isFinite(status.total) ? status.total : 0
  const done = status.tested + status.skipped
  return (
    <>
      <Typography noWrap sx={{ ...type.body, ...numSx, minWidth: 0 }}>
        {step ? (
          <Box component="span" sx={{ fontWeight: 600 }}>
            {step.alternatives
              ? t('teamOpt.run.alternatives', 'Next best builds')
              : t('teamOpt.run.round', {
                  defaultValue: 'Round {{round}}',
                  round: step.round,
                })}
            {' · '}
            <CharacterName characterKey={step.characterKey} gender={gender} /> (
            {step.step}/{step.steps})
            {!!step.weapons &&
              ` · ${t('teamOpt.run.weapon', {
                defaultValue: 'weapon {{weapon}}/{{weapons}}',
                weapon: step.weapon,
                weapons: step.weapons,
              })}`}
            {step.exchange &&
              ` · ${t('teamOpt.run.exchange', 'exchanges between members')}`}
            {step.energyFor && (
              <>
                {' · '}
                {t('teamOpt.run.energyFor', 'energy check:')}{' '}
                <CharacterName characterKey={step.energyFor} gender={gender} />
              </>
            )}
          </Box>
        ) : (
          t('teamOpt.run.preparing', 'Preparing…')
        )}
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' · '}
          {t('teamOpt.run.elapsed', {
            defaultValue: '{{seconds}} s',
            seconds: Math.round(seconds),
          })}
          {' · '}
          {!total
            ? t('teamOpt.run.setup', 'setting up the search')
            : !done
              ? t('teamOpt.run.searching', {
                  defaultValue: 'searching {{total}} builds',
                  total: formatDamage(total),
                })
              : t('teamOpt.run.builds', {
                  defaultValue: '{{done}} of {{total}} builds',
                  done: formatDamage(done),
                  total: formatDamage(total),
                })}
        </Box>
      </Typography>
      <ProgressLine
        value={total && done ? Math.min(100, (done / total) * 100) : undefined}
      />
    </>
  )
}

/** The rotation's damage with the members' current builds, recomputed shortly after a change */
function useCurrentEvaluation(
  teamId: string,
  teamOpt: TeamOpt,
  teamData: TeamData | undefined
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [evaluation, setEvaluation] = useState<TeamOptEvaluation>()
  useEffect(() => {
    if (!teamData) return undefined
    const timer = setTimeout(() => {
      const members = teamOptMembers(database, teamId)
      // with what the team's energy weapons save each member
      const statFilters = teamStatFilters(
        Object.fromEntries(
          members.map((m) => [
            m.characterKey,
            database.optConfigs.get(m.teamChar.optConfigId)?.statFilters ?? {},
          ])
        ),
        teamOptCurrentWeapons(database, members),
        teamOpt
      )
      setEvaluation(
        evaluateTeamRotation(database, teamId, gender, {
          arts: {},
          attacks: teamOpt.attacks,
          mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
          statFilters,
          onField: teamOpt.onField,
          bonusStats: teamOptBonusStats(
            teamOpt,
            members.map((m) => m.characterKey)
          ),
        })
      )
    }, 120)
    return () => clearTimeout(timer)
  }, [database, teamId, gender, teamOpt, teamData])
  return evaluation
}

/** How many artifacts the team may use (any member, before main-stat filters) */
function usePoolSize(members: TeamOptMember[], teamOpt: TeamOpt) {
  const database = useDatabase()
  return useMemo(() => {
    const member = members[0]
    if (!member) return 0
    const anyConfig = {
      mainStatKeys: { sands: [], goblet: [], circlet: [] },
      artExclusion: [],
    } as never
    const locations = new Set(members.map((m) => m.location as string))
    return teamOptPool(
      database.arts.values,
      member,
      anyConfig,
      teamOpt,
      locations,
      new Set()
    ).length
  }, [database, members, teamOpt])
}

/**
 * A result's team builds as results of their own: the best one, then its alternatives (see
 * `TeamOptResult.alternatives`). One object each, kept with the result: the views cache their
 * work by it, and one made again on every render would restart them.
 */
const teamBuildsOf = new WeakMap<TeamOptResult, TeamOptResult[]>()
function teamBuilds(result: TeamOptResult): TeamOptResult[] {
  let list = teamBuildsOf.get(result)
  if (!list) {
    list = [
      result,
      ...(result.alternatives ?? []).map(({ builds, after }) => ({
        ...result,
        builds,
        after,
        alternatives: undefined,
      })),
    ]
    teamBuildsOf.set(result, list)
  }
  return list
}

/** Picks which of a result's team builds is shown: #1 (the best), #2... with their damage */
function TeamBuildPicker({
  builds,
  value,
  onChange,
  rotationTime,
}: {
  builds: TeamOptResult[]
  value: number
  onChange: (index: number) => void
  rotationTime?: number
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const best = builds[0].after.total
  const alternatives = builds[0].alternatives ?? []
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
      }}
    >
      <FieldLabel>{t('teamOpt.result.builds', 'Team builds')}</FieldLabel>
      <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Segmented
          size="small"
          aria-label={t('teamOpt.result.builds', 'Team builds')}
          value={value}
          onChange={onChange}
          options={builds.map((build, i) => {
            const changed = i > 0 ? alternatives[i - 1]?.changed : undefined
            return {
              value: i,
              tip: changed ? (
                <>
                  {t(
                    'teamOpt.result.buildChanges',
                    'The best build, with other artifacts on'
                  )}{' '}
                  <CharacterName characterKey={changed} gender={gender} />
                </>
              ) : (
                t('teamOpt.result.buildBest', 'The best build found')
              ),
              label: (
                <Box component="span" sx={{ ...numSx }}>
                  #{i + 1} {formatRate(build.after.total, rotationTime)}
                  {i > 0 && (
                    <Box
                      component="span"
                      sx={{ color: 'text.secondary', fontWeight: 500 }}
                    >
                      {/* (the difference itself: next best builds are often within 0.1%) */}{' '}
                      −{formatRate(best - build.after.total, rotationTime)}
                    </Box>
                  )}
                </Box>
              ),
            }
          })}
        />
      </Box>
    </Box>
  )
}
