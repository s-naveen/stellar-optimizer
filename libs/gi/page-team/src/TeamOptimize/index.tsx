import {
  CardThemed,
  EmptyState,
  InfoTooltipInline,
  SolidToggleButtonGroup,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBGender, useTeam } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  arrangeTimeline,
  CharacterName,
  evaluateTeamRotation,
  rotationAttacks,
  teamOptBonusStats,
  teamOptCurrentWeapons,
  teamOptMembers,
  teamOptPool,
  teamStatFilters,
  timelineLength,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import TimelineIcon from '@mui/icons-material/Timeline'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import ViewListIcon from '@mui/icons-material/ViewList'
import {
  Alert,
  alpha,
  Box,
  Button,
  InputBase,
  LinearProgress,
  Skeleton,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  memo,
  Suspense,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { TeamBuff } from './buffs'
import { buffsForAttacker, useTeamBuffs } from './buffs'
import { ExtraBuffs } from './ExtraBuffs'
import { defaultRotationTime, formatDamage, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'
import { MemberRotation } from './MemberRotation'
import { RotationTransfer } from './RotationTransfer'
import { RunDialog } from './RunDialog'
import { TeamOptResults } from './TeamOptResults'
import { MemberSettings } from './TeamOptSettings'
import { TeamSensitivity } from './TeamSensitivity'
import { TimelineEditor } from './Timeline/TimelineEditor'
import { timedBuffDefaults } from './Timeline/timing'
import type { TeamOptUpdate } from './useTeamOpt'
import { teamOptRunKey, useTeamOpt } from './useTeamOpt'
import type { TeamOptRunState, TeamOptStatus } from './useTeamOptRun'
import { useTeamOptRun } from './useTeamOptRun'

/**
 * Team Optimize: one rotation for the whole team (every member's attacks, each with the buffs
 * that are up during it), and artifacts for every member at once, maximizing the rotation's
 * damage without using an artifact twice.
 */
export default function TeamOptimize({
  teamId,
  teamData,
}: {
  teamId: string
  teamData: TeamData | undefined
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const navigate = useNavigate()
  const team = useTeam(teamId)
  const [teamOpt, setTeamOpt] = useTeamOpt(teamId)
  // `teamData` is recomputed whenever a member, a build or a conditional changes
  const freshMembers = useMemo(
    () => teamOptMembers(database, teamId),
    [database, teamId, team, teamData]
  )
  // (a save of Team Optimize's settings gives the same members: kept as they were, so what
  // shows them does not redo its work)
  const membersKey = JSON.stringify(freshMembers)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the same members while their key is
  const members = useMemo(() => freshMembers, [membersKey])
  const buffs = useTeamBuffs(teamId, teamData)
  const evaluation = useCurrentEvaluation(teamId, teamOpt, teamData)
  // with the timeline: what the same rotation would deal with every buff always up
  const alwaysUp = useCurrentEvaluation(
    teamId,
    teamOpt,
    teamData,
    teamOpt.timeline?.on ? 'alwaysUp' : 'off'
  )
  // the members' lists follow a change a moment later, so an edit (a drag on the timeline) shows
  // at once
  const deferredTeamOpt = useDeferredValue(teamOpt)
  const deferredEvaluation = useDeferredValue(evaluation)
  const { state, status, run, cancel, clear } = useTeamOptRun(teamId)
  const running = state.type === 'running'
  const rotationTitleId = useId()
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
  const timelineOn = !!teamOpt.timeline?.on
  // the timeline (advanced): the first time, the buffs the game data times, and a first layout
  const setTimeline = (on: boolean) =>
    setTeamOpt((o) => {
      if (!on) {
        if (o.timeline) o.timeline = { ...o.timeline, on: false }
        return
      }
      o.timeline = {
        buffs: timedBuffDefaults(buffs.filter((b) => b.inactive !== 'hidden'))
          .map(({ timing }) => timing)
          .filter((timing) => timing.trigger !== 'manual'),
        ...o.timeline,
        on: true,
      }
      const order = members.map((m) => m.characterKey)
      // a first layout of everything, in the rotation's time; later, only what was added since
      const timed = Object.values(o.attacks).some((list) =>
        list?.some((a) => a.at)
      )
      o.attacks = arrangeTimeline(order, o.attacks, {
        length: timelineLength(o),
        ...(o.onField ? { carry: o.onField } : {}),
        ...(timed ? { only: 'untimed' as const } : {}),
      })
    })
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

  if (!members.length)
    return (
      <Box sx={{ p: { xs: 1, md: 1.5 } }}>
        <EmptyState
          icon={<GroupsIcon />}
          title={t('teamOpt.empty.title', 'Add the team’s members first')}
          description={t(
            'teamOpt.empty.desc',
            'Team Optimize finds artifacts for the whole team at once, for one rotation of their attacks.'
          )}
          actions={
            <Button
              variant="contained"
              sx={giCtaSx}
              onClick={() => navigate(`/teams/${teamId}`)}
            >
              {t('teamOpt.empty.action', 'Team settings')}
            </Button>
          }
        />
      </Box>
    )

  return (
    <Box
      sx={{
        p: { xs: 1, md: 1.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      {/* one header: what this is, the rotation's transfer and settings, its damage and DPS */}
      <Box
        component="section"
        aria-labelledby={rotationTitleId}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.5,
            rowGap: 1,
            px: 0.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 0.5 }}>
            <Typography
              id={rotationTitleId}
              component="h2"
              sx={{
                fontSize: '1.125rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {t('teamOpt.title', 'Team optimize')}
            </Typography>
            <InfoTooltipInline
              title={
                <>
                  {t(
                    'teamOpt.desc',
                    'Builds for the whole team at once. Every member’s attacks in one rotation count, with the buffs the members give each other, and no artifact is used twice: a support gets the set and stats that help the team most.'
                  )}
                  <br />
                  <br />
                  {t(
                    'teamOpt.rotation.info',
                    'Add each member’s attacks and how often they hit in one rotation. The buffs are the ones that are on in Team settings and on the characters’ tabs: open an attack to turn off one that is not up during it, to put it in another state, or to limit one to its first hits (Shenhe’s quills, a buff that runs out).'
                  )}
                  <br />
                  <br />
                  {t(
                    'teamOpt.run.how',
                    'Each member is optimized in turn for the whole rotation’s damage, the others fixed, the biggest damage dealer first. Rounds repeat until no build changes; then members trade pieces and weapons where the team gains.'
                  )}
                </>
              }
            />
          </Box>
          <RotationView
            value={timelineOn ? 'timeline' : 'list'}
            disabled={running}
            onChange={(view) => setTimeline(view === 'timeline')}
          />
          <RotationTransfer
            members={members}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            disabled={running}
          />
          <Box sx={{ flexGrow: 1 }} />
          {/* the rotation's settings, in one compact bar */}
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              height: 44,
              pl: 1.25,
              pr: 0.5,
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              backgroundColor: alpha(theme.palette.text.primary, 0.02),
            })}
          >
            <RotationTimeInput
              value={rotationTime}
              disabled={running}
              onChange={(seconds) =>
                setTeamOpt((o) => {
                  if (seconds && seconds !== defaultRotationTime)
                    o.rotationTime = seconds
                  else delete o.rotationTime
                })
              }
            />
            {onField && members.length > 1 && (
              <>
                <Box
                  sx={{
                    alignSelf: 'stretch',
                    my: 1,
                    width: '1px',
                    bgcolor: 'divider',
                  }}
                />
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
              </>
            )}
          </Box>
          {!!attackCount && (
            <HeaderStats
              total={evaluation?.total}
              rotationTime={rotationTime}
            />
          )}
        </Box>
        {timelineOn && onField && (
          <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
            <TimelineEditor
              teamId={teamId}
              teamData={teamData}
              members={members}
              teamOpt={teamOpt}
              setTeamOpt={setTeamOpt}
              buffs={buffs}
              onField={onField}
              mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
              disabled={running}
              evaluation={evaluation}
              alwaysUpTotal={alwaysUp?.total}
            />
          </Suspense>
        )}
        <MemberColumns
          teamId={teamId}
          teamData={teamData}
          members={members}
          teamOpt={deferredTeamOpt}
          setTeamOpt={setTeamOpt}
          evaluation={deferredEvaluation}
          buffs={buffs}
          onField={onField}
          rotationTime={rotationTime}
          running={running}
        />
      </Box>

      {/* buffs the game data does not have: food, an Abyss blessing... */}
      <ExtraBuffs
        members={members}
        teamOpt={teamOpt}
        setTeamOpt={setTeamOpt}
        disabled={running}
      />

      {/* the run: sticks to the bottom of the screen, like the Optimize tab's generate bar */}
      <RunBar
        state={state}
        status={status}
        members={members}
        attackCount={attackCount}
        optimizable={optimizable}
        onRun={() => setRunDialog(true)}
        onCancel={cancel}
      />
      {/* before a run: what it searches (main stats, inventory, weapons, builds) */}
      {runDialog && (
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

      {state.type === 'error' && (
        <Alert severity="error" onClose={clear}>
          {t('teamOpt.run.error', 'Team Optimize stopped:')} {state.message}
        </Alert>
      )}
      {result && shown && builds.length > 1 && (
        <TeamBuildPicker
          builds={builds}
          value={builds.indexOf(shown)}
          onChange={setPick}
          rotationTime={rotationTime}
        />
      )}
      {result && shown && (
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
      )}
      {/* what one more roll, talent level or level on each member would add */}
      {result && shown && (
        <TeamSensitivity
          teamId={teamId}
          members={members}
          teamOpt={teamOpt}
          result={shown}
        />
      )}
    </Box>
  )
}

/** One panel for the team: a column per member (its attacks, its settings), with hairlines between them */
const MemberColumns = memo(function MemberColumns({
  teamId,
  teamData,
  members,
  teamOpt,
  setTeamOpt,
  evaluation,
  buffs,
  onField,
  rotationTime,
  running,
}: {
  teamId: string
  teamData: TeamData | undefined
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  evaluation: TeamOptEvaluation | undefined
  buffs: TeamBuff[]
  onField: CharacterKey | undefined
  rotationTime: number
  running: boolean
}) {
  const setAttacks =
    (characterKey: CharacterKey) =>
    (update: (attacks: TeamOptAttack[]) => TeamOptAttack[]) =>
      setTeamOpt((o) => {
        o.attacks[characterKey] = update(o.attacks[characterKey] ?? [])
      })
  return (
    <CardThemed bgt="light" sx={{ containerType: 'inline-size' }}>
      <Box
        sx={(theme) => ({
          display: 'grid',
          gap: '1px',
          backgroundColor: theme.palette.divider,
          gridTemplateColumns: 'minmax(0, 1fr)',
          '@container (min-width: 520px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
          '@container (min-width: 1040px)': {
            gridTemplateColumns: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
          },
        })}
      >
        {members.map((member) => (
          <MemberRotation
            key={member.characterKey}
            teamId={teamId}
            member={member}
            teamData={teamData}
            attacks={teamOpt.attacks[member.characterKey] ?? []}
            setAttacks={setAttacks(member.characterKey)}
            evaluation={evaluation}
            buffs={buffsForAttacker(buffs, member.characterKey)}
            mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
            members={members}
            onField={onField ?? member.characterKey}
            rotationTime={rotationTime}
            footer={
              <MemberSettings
                teamId={teamId}
                member={member}
                teamData={teamData}
                teamOpt={teamOpt}
                setTeamOpt={setTeamOpt}
                disabled={running}
              />
            }
          />
        ))}
      </Box>
    </CardThemed>
  )
})

/** The rotation as lists of attacks, or on a timeline (timed buffs count only while up) */
function RotationView({
  value,
  disabled,
  onChange,
}: {
  value: 'list' | 'timeline'
  disabled?: boolean
  onChange: (value: 'list' | 'timeline') => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <SolidToggleButtonGroup
        quiet
        exclusive
        size="small"
        value={value}
        disabled={disabled}
        onChange={(_, v: 'list' | 'timeline' | null) => v && onChange(v)}
        aria-label={t('teamOpt.view.label', 'Rotation view')}
      >
        <ToggleButton value="list" sx={{ gap: 0.75 }}>
          <ViewListIcon fontSize="small" />
          {t('teamOpt.view.list', 'List')}
        </ToggleButton>
        <ToggleButton value="timeline" sx={{ gap: 0.75 }}>
          <TimelineIcon fontSize="small" />
          {t('teamOpt.view.timeline', 'Timeline')}
        </ToggleButton>
      </SolidToggleButtonGroup>
      <InfoTooltipInline
        title={t(
          'teamOpt.view.info',
          'Timeline (advanced): place each attack in time, and say which buffs run out (Instructor, Noblesse Oblige…). A timed buff then counts only on the hits inside its windows, instead of on every hit. Back to List keeps your timeline for later, and counts every buff on every hit again.'
        )}
      />
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
    <Tooltip
      placement="top"
      title={t(
        'teamOpt.rotationTime.info',
        'How long one rotation takes, for the DPS. Saved for this team.'
      )}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <TimerOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
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
              variant="body2"
              color="text.secondary"
              sx={{ ml: 0.25 }}
            >
              s
            </Typography>
          }
          sx={(theme) => ({
            height: 28,
            px: 0.75,
            borderRadius: 1.5,
            fontSize: '0.875rem',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
            '&.Mui-focused': {
              outline: `1px solid ${theme.palette.primary.main}`,
            },
            '& input': { width: '2.25em', textAlign: 'right', p: 0 },
          })}
        />
      </Box>
    </Tooltip>
  )
}

/** The rotation's damage and its DPS, side by side */
function HeaderStats({
  total,
  rotationTime,
}: {
  total: number | undefined
  rotationTime: number
}) {
  const { t } = useTranslation('page_team')
  const stat = (label: ReactNode, value: string, accent?: boolean) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'text.secondary',
          lineHeight: 1.4,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: '1.25rem',
          fontWeight: 700,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
          color: accent ? 'primary.main' : 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        px: 2,
        py: 0.75,
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: alpha(theme.palette.text.primary, 0.02),
      })}
    >
      {stat(
        t('teamOpt.header.total', 'Rotation DMG'),
        formatDamage(total, true)
      )}
      <Box sx={{ width: '1px', bgcolor: 'divider' }} />
      {stat(
        t('teamOpt.header.dps', 'DPS'),
        formatRate(total, rotationTime, true),
        true
      )}
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
  const gender = useDBGender()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Tooltip
        placement="top"
        title={t(
          'teamOpt.onField.info',
          'Who is on the field during the rotation’s hits, unless an attack says otherwise (open it to change it). Buffs for the active character, like Mitya’s C1 CRIT DMG, go to them, and the ones for off-field characters to the others. Elsewhere the app counts the team’s first member as on the field.'
        )}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ cursor: 'help', whiteSpace: 'nowrap' }}
        >
          {t('teamOpt.onField.label', 'On the field')}
        </Typography>
      </Tooltip>
      <SolidToggleButtonGroup
        quiet
        exclusive
        size="small"
        value={value}
        disabled={disabled}
        onChange={(_, v: CharacterKey | null) => v && onChange(v)}
      >
        {members.map((m) => (
          <ToggleButton
            key={m.characterKey}
            value={m.characterKey}
            sx={{ px: 0.5, py: 0.25 }}
          >
            <Tooltip
              title={
                <CharacterName characterKey={m.characterKey} gender={gender} />
              }
            >
              <Box component="span" sx={{ display: 'inline-flex' }}>
                <MemberAvatar characterKey={m.characterKey} size={22} />
              </Box>
            </Tooltip>
          </ToggleButton>
        ))}
      </SolidToggleButtonGroup>
    </Box>
  )
}

/** The page's one main action (Cancel while running), with the run's progress */
function RunBar({
  state,
  status,
  members,
  attackCount,
  optimizable,
  onRun,
  onCancel,
}: {
  state: TeamOptRunState
  status: TeamOptStatus
  members: TeamOptMember[]
  attackCount: number
  optimizable: TeamOptMember[]
  /** Opens the run's dialog (it starts the run) */
  onRun: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('page_team')
  const gender = useDBGender()
  const running = state.type === 'running'
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
      sx={(theme) => ({
        position: 'sticky',
        bottom: 8,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        pl: 2,
        pr: 1,
        py: 1,
        borderRadius: 2,
        overflow: 'hidden',
        // the page's own surfaces (the cards'), raised a little: it floats over them while scrolling
        backgroundColor: alpha(theme.palette.contentLight.main, 0.97),
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(6px)',
      })}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {running ? (
          <RunProgress state={state} status={status} gender={gender} />
        ) : (
          <Typography
            variant="body2"
            noWrap
            color={blocked ? 'text.secondary' : 'text.primary'}
          >
            {blocked ??
              t('teamOpt.run.summary', {
                defaultValue: '{{count}} of {{total}} members optimized',
                count: optimizable.length,
                total: members.length,
              })}
          </Typography>
        )}
      </Box>

      <Button
        variant="contained"
        color={running ? 'error' : 'success'}
        startIcon={running ? <CloseIcon /> : <TrendingUpIcon />}
        disabled={!running && !!blocked}
        onClick={running ? onCancel : onRun}
        sx={!running && !blocked ? giCtaSx : undefined}
      >
        {running
          ? t('teamOpt.run.cancel', 'Cancel')
          : t('teamOpt.run.button', 'Optimize team')}
      </Button>
    </Box>
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
      <Typography
        variant="body2"
        noWrap
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
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
      <LinearProgress
        variant={total && done ? 'determinate' : 'indeterminate'}
        value={total && done ? Math.min(100, (done / total) * 100) : undefined}
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          backgroundColor: 'transparent',
        }}
      />
    </>
  )
}

/** The rotation's damage with the members' current builds, recomputed shortly after a change */
function useCurrentEvaluation(
  teamId: string,
  teamOpt: TeamOpt,
  teamData: TeamData | undefined,
  /** `alwaysUp`: with every buff up on every hit (the timeline ignored); `off`: not computed */
  mode: 'rotation' | 'alwaysUp' | 'off' = 'rotation'
) {
  const database = useDatabase()
  const gender = useDBGender()
  const [evaluation, setEvaluation] = useState<TeamOptEvaluation>()
  useEffect(() => {
    if (!teamData || mode === 'off') return setEvaluation(undefined)
    const timer = setTimeout(
      () => {
        const members = teamOptMembers(database, teamId)
        // with what the team's energy weapons save each member
        const statFilters = teamStatFilters(
          Object.fromEntries(
            members.map((m) => [
              m.characterKey,
              database.optConfigs.get(m.teamChar.optConfigId)?.statFilters ??
                {},
            ])
          ),
          teamOptCurrentWeapons(database, members),
          teamOpt
        )
        setEvaluation(
          evaluateTeamRotation(database, teamId, gender, {
            arts: {},
            attacks:
              mode === 'alwaysUp' ? teamOpt.attacks : rotationAttacks(teamOpt),
            mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
            statFilters,
            onField: teamOpt.onField,
            bonusStats: teamOptBonusStats(
              teamOpt,
              members.map((m) => m.characterKey)
            ),
          })
        )
      },
      mode === 'alwaysUp' ? 400 : 120
    )
    return () => clearTimeout(timer)
  }, [database, teamId, gender, teamOpt, teamData, mode])
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
  const gender = useDBGender()
  const best = builds[0].after.total
  const alternatives = builds[0].alternatives ?? []
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
        px: 0.5,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {t('teamOpt.result.builds', 'Team builds')}
      </Typography>
      <SolidToggleButtonGroup
        quiet
        exclusive
        size="small"
        value={value}
        onChange={(_, v: number | null) => v !== null && onChange(v)}
      >
        {builds.map((build, i) => {
          const changed = i > 0 ? alternatives[i - 1]?.changed : undefined
          return (
            <ToggleButton
              // biome-ignore lint/suspicious/noArrayIndexKey: builds are ranked, by position
              key={i}
              value={i}
              sx={{ gap: 0.75, fontVariantNumeric: 'tabular-nums' }}
            >
              <Tooltip
                title={
                  changed ? (
                    <>
                      {t(
                        'teamOpt.result.buildChanges',
                        'The best build, with other artifacts on'
                      )}{' '}
                      <CharacterName characterKey={changed} gender={gender} />
                    </>
                  ) : (
                    t('teamOpt.result.buildBest', 'The best build found')
                  )
                }
              >
                <span>
                  #{i + 1} {formatRate(build.after.total, rotationTime)}
                  {i > 0 && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {/* (the difference itself: next best builds are often within 0.1%) */}{' '}
                      −{formatRate(best - build.after.total, rotationTime)}
                    </Box>
                  )}
                </span>
              </Tooltip>
            </ToggleButton>
          )
        })}
      </SolidToggleButtonGroup>
    </Box>
  )
}
