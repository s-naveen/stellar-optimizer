import {
  BootstrapTooltip,
  CardThemed,
  ImgIcon,
  StarsDisplay,
} from '@genshin-optimizer/common/ui'
import { clamp, getUnitStr, objPathValue } from '@genshin-optimizer/common/util'
import {
  artifactAsset,
  imgAssets,
  weaponAsset,
} from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  getLevelString,
} from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon, TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { getWeaponStat, weaponHasRefinement } from '@genshin-optimizer/gi/stats'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import type {
  TeamData,
  TeamOptMember,
  TeamOptResult,
  TeamOptShortfall,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactCardPico,
  ArtifactSetName,
  ArtifactSetTooltip,
  CharacterName,
  ExcludeIcon,
  GetCalcDisplay,
  resolveInfo,
  statName,
  WeaponName,
  WeaponPassiveDesc,
  WeaponPassiveName,
} from '@genshin-optimizer/gi/ui'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import {
  artDisplayValue,
  getMainStatDisplayStr,
} from '@genshin-optimizer/gi/util'
import { dataObjForWeapon, uiInput as input } from '@genshin-optimizer/gi/wr'
import BoltIcon from '@mui/icons-material/Bolt'
import CheckIcon from '@mui/icons-material/Check'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SaveIcon from '@mui/icons-material/Save'
import UndoIcon from '@mui/icons-material/Undo'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  FormControlLabel,
  IconButton,
  Snackbar,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changedMembers, equipTeamResult, saveTeamResult } from './apply'
import { formatGain, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'
import { useTeamOpt } from './useTeamOpt'
import type { ResultDetailsData } from './ResultDetails'
import { MemberDetails, useResultDetails } from './ResultDetails'
import { TeamCardButton } from './TeamCardButton'

/** What Team Optimize found: the rotation's damage before and after, and each member's build */
export function TeamOptResults({
  teamId,
  members,
  result,
  seconds,
  runTeamOpt,
  rotationTime,
  onDiscard,
  teamData,
  stale,
  onRunAgain,
}: {
  teamId: string
  members: TeamOptMember[]
  result: TeamOptResult
  seconds: number
  /** The team's data now: what names the members' requirements */
  teamData: TeamData | undefined
  /** The rotation or the settings changed since the run: the result does not include it */
  stale?: boolean
  onRunAgain?: () => void
  /** The settings the result was found with (its rotation) */
  runTeamOpt: TeamOpt
  /** How long one rotation takes (seconds): damage is then shown per second */
  rotationTime?: number
  onDiscard: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  const { before, after } = result
  const { gender } = useDBMeta()
  const gain = before.total > 0 ? after.total / before.total - 1 : 0
  // recomputed with the database: an applied result has no changes left
  const changed = useMemo(
    () => changedMembers(database, teamId, result),
    [database, teamId, result, team]
  )
  const [confirm, setConfirm] = useState(false)
  const [applied, setApplied] = useState<'equip' | 'save'>()
  // artifacts excluded from this team's optimization (from here or the settings)
  const [liveTeamOpt, setTeamOpt] = useTeamOpt(teamId)
  const excludedArts = useMemo(
    () => new Set(liveTeamOpt.excludedArts),
    [liveTeamOpt.excludedArts]
  )
  const [lastExcluded, setLastExcluded] = useState<string>()
  const toggleExcluded = (id: string) => {
    const exclude = !excludedArts.has(id)
    setTeamOpt((o) => {
      o.excludedArts = exclude
        ? [...o.excludedArts, id]
        : o.excludedArts.filter((x) => x !== id)
    })
    setLastExcluded(exclude ? id : undefined)
  }
  const noChange = !changed.length
  // every card opens at once (side by side, the members' stats line up)
  const [showDetails, setShowDetails] = useState(false)
  // the members' changes against their equipped builds: off by default (less to read)
  const [compare, setCompare] = useState(false)
  const details = useResultDetails(
    teamId,
    runTeamOpt,
    result,
    showDetails,
    applied
  )

  return (
    <CardThemed
      bgt="light"
      sx={(theme) => ({
        p: { xs: 1.5, md: 2 },
        border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
      })}
    >
      {/* the headline: the rotation's damage */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 3,
          rowGap: 1,
        }}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            {rotationTime
              ? t('teamOpt.result.dps', 'Team DPS')
              : t('teamOpt.result.total', 'Rotation damage')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography
              sx={{
                fontSize: '1.5rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatRate(after.total, rotationTime, true)}
            </Typography>
            {compare && (
              <>
                <Typography
                  sx={{
                    fontWeight: 700,
                    color: gain > 0.0005 ? 'success.main' : 'text.secondary',
                  }}
                >
                  {formatGain(gain)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('teamOpt.result.from', {
                    defaultValue: 'from {{value}}',
                    value: formatRate(before.total, rotationTime, true),
                  })}
                </Typography>
              </>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('teamOpt.result.meta', {
              defaultValue: 'Found in {{seconds}} s, {{count}} rounds',
              seconds: seconds < 10 ? seconds.toFixed(1) : Math.round(seconds),
              count: result.rounds,
            })}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <FormControlLabel
            sx={{ m: 0, mr: 0.5, gap: 0.5 }}
            control={
              <Switch
                size="small"
                checked={compare}
                onChange={() => setCompare((c) => !c)}
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                {t('teamOpt.result.compare', 'Compare with equipped')}
              </Typography>
            }
          />
          <TeamCardButton
            teamId={teamId}
            result={result}
            runTeamOpt={runTeamOpt}
            rotationTime={rotationTime}
          />
          {applied ? (
            <Typography
              color="success.main"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontWeight: 600,
              }}
            >
              <CheckIcon fontSize="small" />
              {applied === 'equip'
                ? t('teamOpt.result.equipped', 'Equipped')
                : t('teamOpt.result.saved', 'Saved as builds')}
            </Typography>
          ) : (
            <>
              <Tooltip
                title={t(
                  'teamOpt.result.saveHint',
                  'A new build per member, used by this team. Nothing moves between characters.'
                )}
              >
                <span>
                  <Button
                    variant="contained"
                    color="secondary"
                    startIcon={<SaveIcon />}
                    disabled={noChange}
                    onClick={() => {
                      saveTeamResult(
                        database,
                        teamId,
                        result,
                        t('teamOpt.result.buildName', {
                          defaultValue: '{{team}} (team optimized)',
                          team: team?.name ?? '',
                        })
                      )
                      setApplied('save')
                    }}
                  >
                    {t('teamOpt.result.save', 'Save as builds')}
                  </Button>
                </span>
              </Tooltip>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<CheckroomIcon />}
                disabled={noChange}
                onClick={() => setConfirm(true)}
              >
                {t('teamOpt.result.equip', 'Equip')}
              </Button>
            </>
          )}
          <Tooltip title={t('teamOpt.result.discard', 'Discard')}>
            <IconButton
              onClick={onDiscard}
              aria-label={t('teamOpt.result.discard', 'Discard')}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {stale && (
        <Alert
          severity="warning"
          sx={{ mt: 1.5 }}
          action={
            onRunAgain && (
              <Button size="small" color="inherit" onClick={onRunAgain}>
                {t('teamOpt.result.runAgain', 'Run again')}
              </Button>
            )
          }
        >
          {t(
            'teamOpt.result.stale',
            'Found with an earlier rotation or settings: what changed since is not in it.'
          )}
        </Alert>
      )}
      {/* a result below the current builds: says so (even when not comparing), and why */}
      {after.total < before.total * (1 - 1e-4) && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {t('teamOpt.result.belowNow', {
            defaultValue: 'Below your current builds ({{value}})',
            value: formatRate(before.total, rotationTime, true),
          })}
          {!!result.startBreaksSetRules?.length && (
            <>
              {': '}
              {result.startBreaksSetRules.map((ck, i) => (
                <Fragment key={ck}>
                  {i > 0 && ', '}
                  <strong>
                    <CharacterName characterKey={ck} gender={gender} />
                  </strong>
                </Fragment>
              ))}{' '}
              {t('teamOpt.result.belowNowSets', {
                count: result.startBreaksSetRules.length,
                defaultValue:
                  'can’t keep their current build: it breaks their allowed sets (Requirements → Artifact sets)',
              })}
            </>
          )}
          {!!result.startUntickedWeapons?.length && (
            <>
              {result.startBreaksSetRules?.length ? '; ' : ': '}
              {result.startUntickedWeapons.map((ck, i) => (
                <Fragment key={ck}>
                  {i > 0 && ', '}
                  <strong>
                    <CharacterName characterKey={ck} gender={gender} />
                  </strong>
                </Fragment>
              ))}{' '}
              {t('teamOpt.result.belowNowWeapons', {
                count: result.startUntickedWeapons.length,
                defaultValue:
                  'can’t keep their current weapon: it isn’t ticked in Weapons to choose from',
              })}
            </>
          )}
        </Alert>
      )}
      {confirm && !applied && (
        <Alert
          severity="info"
          sx={{ mt: 1.5 }}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                color="inherit"
                onClick={() => setConfirm(false)}
              >
                {t('teamOpt.result.cancel', 'Cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  equipTeamResult(database, teamId, result)
                  setConfirm(false)
                  setApplied('equip')
                }}
              >
                {t('teamOpt.result.equipConfirm', 'Equip')}
              </Button>
            </Box>
          }
        >
          {t('teamOpt.result.equipWarn', {
            defaultValue:
              'Equips the new builds on {{count}} members (saved builds are updated instead). Artifacts move from whoever wears them now.',
            count: changed.length,
          })}
        </Alert>
      )}
      {noChange && !applied && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t(
            'teamOpt.result.noChange',
            'The current builds are already the best ones found for this rotation.'
          )}
        </Typography>
      )}

      {/* each member: its build and its own damage */}
      <Box sx={{ containerType: 'inline-size', mt: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: 'minmax(0, 1fr)',
            '@container (min-width: 520px)': {
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            },
            '@container (min-width: 1040px)': {
              gridTemplateColumns: `repeat(${showDetails ? 2 : 4}, minmax(0, 1fr))`,
            },
            // expanded: four in a row only where each artifact's stats stay readable
            ...(showDetails && {
              '@container (min-width: 1600px)': {
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              },
            }),
          }}
        >
          {members.map((member) => (
            <MemberResult
              key={member.characterKey}
              member={member}
              result={result}
              teamData={teamData}
              rotationTime={rotationTime}
              runTeamOpt={runTeamOpt}
              showDetails={showDetails}
              onToggleDetails={() => setShowDetails((v) => !v)}
              details={details}
              compare={compare}
              excludedArts={excludedArts}
              onToggleExcluded={toggleExcluded}
            />
          ))}
        </Box>
      </Box>
      <Snackbar
        open={!!lastExcluded}
        autoHideDuration={8000}
        onClose={(_, reason) =>
          reason !== 'clickaway' && setLastExcluded(undefined)
        }
      >
        <Alert
          severity="info"
          variant="outlined"
          icon={<ExcludeIcon fontSize="inherit" />}
          sx={{ bgcolor: 'background.paper', alignItems: 'center' }}
          action={
            <>
              <Button
                size="small"
                color="inherit"
                onClick={() => lastExcluded && toggleExcluded(lastExcluded)}
              >
                {t('teamOpt.result.undo', 'Undo')}
              </Button>
              {onRunAgain && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    setLastExcluded(undefined)
                    onRunAgain()
                  }}
                >
                  {t('teamOpt.result.runAgain', 'Run again')}
                </Button>
              )}
            </>
          }
        >
          {t(
            'teamOpt.result.excludedToast',
            'Excluded from this team. Run again to find builds without it.'
          )}
        </Alert>
      </Snackbar>
    </CardThemed>
  )
}

/**
 * The requirements a member's build does not meet, each with its stat, what the build reaches and
 * what it needs. Why, on hover: no build of the member gets there with its settings (this is the
 * closest one), or it was kept as it is.
 */
function Shortfalls({
  shortfalls,
  data,
  optimized,
}: {
  shortfalls: TeamOptShortfall[]
  /** The member's data: what names its requirements */
  data: UIData | undefined
  optimized: boolean
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      placement="top"
      title={
        optimized
          ? t(
              'teamOpt.result.unmetWhy',
              'No build reaches it with this member’s settings: its main stats, the sets it may use, the artifact levels and the weapons ticked. This build gets the closest. Lower the requirement, or allow more.'
            )
          : t(
              'teamOpt.result.unmetKept',
              'Kept as it is: its build does not reach it.'
            )
      }
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'flex-start',
          cursor: 'help',
        }}
      >
        {shortfalls.map(({ path, value, min }) => {
          const node =
            data &&
            (objPathValue(data.getDisplay(), path) as CalcResult | undefined)
          const info = node?.info && resolveInfo(node.info)
          const percent = info?.unit === '%'
          // (the user's own figures: 130%, not 130.0000001%)
          const format = (x: number) =>
            percent
              ? `${+(x * 100).toFixed(1)}%`
              : `${+x.toFixed(Math.abs(x) >= 100 ? 0 : 1)}`
          return (
            <Typography
              key={path.join('.')}
              variant="caption"
              color="warning.main"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {info?.name ?? path.at(-1)}{' '}
              {t('teamOpt.result.reachesNeeds', {
                defaultValue: '{{value}}, needs {{min}}',
                value: format(value),
                min: format(min),
              })}
            </Typography>
          )
        })}
      </Box>
    </Tooltip>
  )
}

function MemberResult({
  member,
  result,
  teamData,
  rotationTime,
  runTeamOpt,
  showDetails,
  onToggleDetails,
  details,
  compare,
  excludedArts,
  onToggleExcluded,
}: {
  member: TeamOptMember
  result: TeamOptResult
  teamData: TeamData | undefined
  rotationTime?: number
  runTeamOpt: TeamOpt
  /** Its final stats and each attack's damage are shown */
  showDetails: boolean
  onToggleDetails: () => void
  details: ResultDetailsData | undefined
  /** Its changes against its equipped build are shown */
  compare: boolean
  /** Artifacts excluded from the team's optimization, and the toggle */
  excludedArts: ReadonlySet<string>
  onToggleExcluded: (id: string) => void
}) {
  const {
    characterKey,
    artifactIds,
    weaponId: currentWeaponId,
    isTc,
    loadoutDatum,
  } = member
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const constellation = isTc
    ? database.buildTcs.get(loadoutDatum.buildTcId)?.character?.constellation
    : database.chars.get(characterKey)?.constellation
  const build = result.builds[characterKey]
  const optimized = result.optimized.includes(characterKey)
  const before = result.before.members[characterKey] ?? 0
  const after = result.after.members[characterKey] ?? 0
  const sets = useMemo(() => {
    const count: Partial<Record<ArtifactSetKey, number>> = {}
    for (const id of Object.values(build ?? {})) {
      const setKey = id ? database.arts.get(id)?.setKey : undefined
      if (setKey) count[setKey] = (count[setKey] ?? 0) + 1
    }
    return Object.entries(count)
      .filter(([, n]) => n >= 2)
      .sort(([, a], [, b]) => b - a) as [ArtifactSetKey, number][]
  }, [build, database])
  // no build of its artifacts keeps to its set rules: it kept the one it had
  const unmet = result.after.unmet[characterKey]
  const shortfalls = result.after.shortfalls?.[characterKey]
  const weaponId = result.weapons?.[characterKey]
  const weapon = weaponId ? database.weapons.get(weaponId) : undefined
  const newWeapon =
    compare && optimized && !!weaponId && weaponId !== currentWeaponId
  // none of the ticked weapons was free for it: it kept one that is not ticked
  const unticked = !!result.untickedWeapons?.includes(characterKey)
  /** What the team's energy weapons lowered its Energy Recharge requirement by */
  const energy = result.energy?.[characterKey]
  /** Its part of the team's damage */
  const share = result.after.total > 0 ? after / result.after.total : 0

  return (
    <Box
      sx={(theme) => ({
        p: 1.25,
        borderRadius: 2,
        backgroundColor: alpha(theme.palette.text.primary, 0.03),
        border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      })}
    >
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MemberAvatar characterKey={characterKey} />
          <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
          {constellation !== undefined && (
            <Tooltip
              title={t('teamOpt.result.constellation', {
                defaultValue: 'Constellation {{value}}',
                value: constellation,
              })}
            >
              <Box
                component="span"
                sx={(theme) => ({
                  flexShrink: 0,
                  px: 0.625,
                  borderRadius: 1,
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  lineHeight: 1.6,
                  color: theme.palette.primary.light,
                  backgroundColor: alpha(theme.palette.primary.main, 0.14),
                })}
              >
                C{constellation}
              </Box>
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {!optimized && (
            <Typography variant="caption" color="text.secondary">
              {isTc
                ? t('teamOpt.result.tc', 'TC build, kept')
                : t('teamOpt.result.kept', 'Kept')}
            </Typography>
          )}
          <Tooltip
            title={
              rotationTime
                ? t('teamOpt.result.shareDps', 'Its share of the team’s DPS')
                : t('teamOpt.result.share', 'Its share of the team’s damage')
            }
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(share * 100)}%
            </Typography>
          </Tooltip>
        </Box>
        {/* its part of the team, as in the rotation's columns */}
        <Box
          sx={(theme) => ({
            mt: 0.75,
            height: 3,
            borderRadius: 2,
            overflow: 'hidden',
            backgroundColor: alpha(theme.palette.text.primary, 0.08),
          })}
        >
          <Box
            sx={(theme) => ({
              height: '100%',
              width: `${Math.max(0, Math.min(1, share)) * 100}%`,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.primary.main, 0.7),
            })}
          />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
        >
          {formatRate(after, rotationTime)}
        </Typography>
        {compare && before > 0 && Math.abs(after / before - 1) >= 0.0005 && (
          <Typography
            variant="body2"
            sx={{
              color: after > before ? 'success.main' : 'warning.main',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatGain(after / before - 1)}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {rotationTime
            ? t('teamOpt.result.ownDps', 'own DPS')
            : t('teamOpt.result.own', 'own damage')}
        </Typography>
      </Box>
      {build && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 0.5,
          }}
        >
          {allArtifactSlotKeys.map((slotKey) => {
            const id = build[slotKey]
            const isNew = compare && optimized && id !== artifactIds[slotKey]
            const excluded = !!id && excludedArts.has(id)
            return (
              <Box
                key={slotKey}
                sx={(theme) => ({
                  position: 'relative',
                  minWidth: 0,
                  // the exclude button: on hover or focus, always on touch screens and once excluded
                  '& .exclude-art': { opacity: excluded ? 1 : 0 },
                  '&:hover .exclude-art, &:focus-within .exclude-art': {
                    opacity: 1,
                  },
                  '@media (hover: none)': { '& .exclude-art': { opacity: 1 } },
                  borderRadius: 1.5,
                  outline: isNew
                    ? `2px solid ${alpha(theme.palette.primary.main, 0.8)}`
                    : undefined,
                  outlineOffset: 1,
                  // expanded: one tile, the icon over its stats
                  ...(showDetails && {
                    overflow: 'hidden',
                    border: `1px solid ${theme.palette.divider}`,
                    backgroundColor: alpha(theme.palette.text.primary, 0.03),
                  }),
                })}
              >
                <Box
                  sx={{
                    opacity: excluded ? 0.35 : 1,
                    filter: excluded ? 'grayscale(1)' : undefined,
                    transition: 'opacity 120ms, filter 120ms',
                  }}
                >
                  <ArtifactCardPico
                    artifactObj={id ? database.arts.get(id) : undefined}
                    slotKey={slotKey}
                  />
                </Box>
                {excluded && (
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      textAlign: 'center',
                      fontWeight: 600,
                      lineHeight: 1.1,
                      pointerEvents: 'none',
                      textShadow: '0 0 4px rgba(0,0,0,0.9)',
                    }}
                  >
                    {t('teamOpt.result.excluded', 'Excluded')}
                  </Typography>
                )}
                {id && (
                  <Tooltip
                    title={
                      excluded
                        ? t('teamOpt.result.include', 'Use it again')
                        : t(
                            'teamOpt.result.exclude',
                            "Exclude from this team's optimization"
                          )
                    }
                  >
                    <IconButton
                      className="exclude-art"
                      size="small"
                      aria-label={
                        excluded
                          ? t('teamOpt.result.include', 'Use it again')
                          : t(
                              'teamOpt.result.exclude',
                              "Exclude from this team's optimization"
                            )
                      }
                      aria-pressed={excluded}
                      onClick={() => onToggleExcluded(id)}
                      sx={(theme) => ({
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        p: 0.25,
                        zIndex: 1,
                        transition: 'opacity 120ms',
                        color: excluded ? 'warning.main' : 'text.primary',
                        backgroundColor: alpha(
                          theme.palette.background.paper,
                          0.85
                        ),
                        '&:hover': {
                          backgroundColor: theme.palette.background.paper,
                        },
                      })}
                    >
                      {excluded ? (
                        <UndoIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <ExcludeIcon sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
                {showDetails && id && <ArtifactStats artifactId={id} />}
              </Box>
            )
          })}
        </Box>
      )}
      {weapon && (
        <BootstrapTooltip
          placement="top"
          disableInteractive
          title={<WeaponDetails weapon={weapon} />}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              alignSelf: 'flex-start',
              maxWidth: '100%',
              cursor: 'default',
            }}
          >
            <WeaponThumb weapon={weapon} highlight={newWeapon} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                <WeaponName weaponKey={weapon.key} />
              </Typography>
              <Typography
                variant="caption"
                color={unticked ? 'warning.main' : 'text.secondary'}
              >
                {unticked
                  ? t(
                      'teamOpt.result.untickedWeapon',
                      'Not ticked: kept, no ticked weapon was free'
                    )
                  : !compare
                    ? t('teamOpt.weapons.levelRef', {
                        defaultValue: 'Lv. {{level}} · R{{refinement}}',
                        level: weapon.level,
                        refinement: weapon.refinement,
                      })
                    : newWeapon
                      ? t('teamOpt.result.newWeapon', 'New weapon')
                      : t('teamOpt.result.sameWeapon', 'Same weapon')}
              </Typography>
            </Box>
          </Box>
        </BootstrapTooltip>
      )}
      {!!sets.length && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {sets.map(([setKey, n]) => (
            <ArtifactSetTooltip key={setKey} setKey={setKey} numInSet={n}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  alignSelf: 'flex-start',
                  maxWidth: '100%',
                  cursor: 'default',
                }}
              >
                <Box
                  component="img"
                  src={artifactAsset(setKey, 'flower')}
                  alt=""
                  sx={{ width: 18, height: 18, flexShrink: 0 }}
                />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {n >= 4 ? 4 : 2}× <ArtifactSetName setKey={setKey} />
                </Typography>
              </Box>
            </ArtifactSetTooltip>
          ))}
        </Box>
      )}
      {energy && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
        >
          <BoltIcon
            sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }}
          />
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t('teamOpt.result.energy', {
              defaultValue: 'ER requirement −{{value}}%',
              value: energy.relief,
            })}
            {' · '}
            {energy.weaponIds.map((id, j) => {
              const energyWeapon = database.weapons.get(id)
              return (
                energyWeapon && (
                  <Fragment key={id}>
                    {j ? ', ' : ''}
                    <WeaponName weaponKey={energyWeapon.key} />
                  </Fragment>
                )
              )
            })}
          </Box>
        </Typography>
      )}
      {shortfalls?.length ? (
        <Shortfalls
          shortfalls={shortfalls}
          data={teamData?.[characterKey]?.target}
          optimized={optimized}
        />
      ) : (
        // (a result saved before the requirements were detailed)
        !!unmet?.length && (
          <Typography variant="caption" color="warning.main">
            {t('teamOpt.result.unmet', {
              defaultValue: '{{count}} requirement not met',
              count: unmet.length,
            })}
          </Typography>
        )
      )}
      {showDetails && (
        <MemberDetails
          characterKey={characterKey}
          details={details}
          teamOpt={runTeamOpt}
          rotationTime={rotationTime}
          compare={compare}
        />
      )}
      {/* pushed to the card's foot: the cards' toggles line up */}
      <Box sx={{ flexGrow: 1 }} />
      <ButtonBase
        onClick={onToggleDetails}
        aria-expanded={showDetails}
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          mx: -1.25,
          mb: -1.25,
          py: 0.75,
          borderTop: `1px solid ${theme.palette.divider}`,
          borderBottomLeftRadius: 'inherit',
          borderBottomRightRadius: 'inherit',
          color: 'text.secondary',
          fontSize: '0.75rem',
          fontWeight: 600,
          '&:hover': {
            color: 'text.primary',
            backgroundColor: alpha(theme.palette.text.primary, 0.05),
          },
        })}
      >
        {showDetails
          ? t('teamOpt.result.hideDetails', 'Hide stats and damage')
          : t('teamOpt.result.showDetails', 'Stats and damage')}
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            transform: showDetails ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
          }}
        />
      </ButtonBase>
    </Box>
  )
}

/**
 * Under an artifact's icon in an expanded result: its main stat, then its substats (in their roll
 * colors), icons left and values right so the five tiles read as one table. A line's stat is named
 * on hover.
 */
function ArtifactStats({ artifactId }: { artifactId: string }) {
  const database = useDatabase()
  const art = database.arts.get(artifactId)
  if (!art) return null
  const { mainStatKey, rarity, level, substats, unactivatedSubstats } = art
  const mainVariant = KeyMap.getVariant(mainStatKey)
  return (
    <Box
      sx={{
        // (sized to the tile: narrow when four results share the row)
        containerType: 'inline-size',
        px: 0.625,
        pt: 0.75,
        pb: 0.875,
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <StatLine
        statKey={mainStatKey}
        value={getMainStatDisplayStr(mainStatKey, rarity, level)}
        color={mainVariant ? `${mainVariant}.main` : 'text.primary'}
        main
      />
      <Box sx={{ height: '1px', bgcolor: 'divider', my: '2px' }} />
      {substats.map(
        ({ key, value, rolls }) =>
          !!(key && value) && (
            <StatLine
              key={key}
              statKey={key}
              value={`${artDisplayValue(value, getUnitStr(key))}${getUnitStr(key)}`}
              color={`roll${clamp(rolls.length, 1, 6)}.main`}
            />
          )
      )}
      {unactivatedSubstats?.map(
        ({ key, value }) =>
          !!(key && value) && (
            <StatLine
              key={key}
              statKey={key}
              value={`${artDisplayValue(value, getUnitStr(key))}${getUnitStr(key)}`}
              color="text.disabled"
            />
          )
      )}
    </Box>
  )
}

/**
 * A stat line of an artifact tile, styled as in the artifact's tooltip: icon and value in the
 * line's color (bold, "+" on substats). A narrow tile gets smaller type. Named in a hover title.
 */
function StatLine({
  statKey,
  value,
  color,
  main = false,
}: {
  statKey: MainStatKey | SubstatKey
  value: string
  color: string
  main?: boolean
}) {
  return (
    <Box
      title={statName(statKey)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '4px',
        minWidth: 0,
        color,
        // the tooltip's sizes (16 / 13 px) where the tile has room; smaller to fit a narrow tile
        fontSize: main
          ? 'clamp(10px, calc((100cqi - 4px) / 5), 1rem)'
          : 'clamp(10px, calc((100cqi - 4px) / 5.4), 0.8125rem)',
        fontWeight: 700,
        lineHeight: main ? 1.3 : 1.4,
        whiteSpace: 'nowrap',
        letterSpacing: 0,
        '& svg': { fontSize: '1.1em', flexShrink: 0 },
        '@container (max-width: 56px)': { '& .plus': { display: 'none' } },
      }}
    >
      <StatIcon statKey={statKey} />
      <span>
        {!main && <span className="plus">+</span>}
        {value}
      </span>
    </Box>
  )
}

/** A weapon's icon, with its refinement (outlined when it is new to the member) */
function WeaponThumb({
  weapon,
  highlight,
}: {
  weapon: ICachedWeapon
  highlight: boolean
}) {
  const { rarity } = getWeaponStat(weapon.key)
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: 1.5,
        overflow: 'hidden',
        outline: highlight
          ? `2px solid ${alpha(theme.palette.primary.main, 0.8)}`
          : undefined,
        outlineOffset: 1,
      })}
      className={`grad-${rarity}star`}
    >
      <Box
        component="img"
        src={weaponAsset(weapon.key, weapon.ascension >= 2)}
        alt=""
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {weaponHasRefinement(weapon.key) && (
        <Typography
          component="span"
          sx={{
            position: 'absolute',
            right: 2,
            bottom: 0,
            fontSize: '0.625rem',
            fontWeight: 700,
            textShadow:
              '0 0 3px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8)',
          }}
        >
          R{weapon.refinement}
        </Typography>
      )}
    </Box>
  )
}

/** A weapon at a glance: name, rarity, level and refinement, stats, passive at its refinement */
function WeaponDetails({ weapon }: { weapon: ICachedWeapon }) {
  const sheet = getWeaponSheet(weapon.key)
  const uiData = useMemo(
    () => sheet && computeUIData([sheet.data, dataObjForWeapon(weapon)]),
    [sheet, weapon]
  )
  const { rarity, weaponType } = getWeaponStat(weapon.key)
  const stat = (node: CalcResult) => {
    const { icon } = resolveInfo(node.info)
    return (
      <Typography
        sx={{
          fontSize: '0.8125rem',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        {icon} {GetCalcDisplay(node).valueString}
      </Typography>
    )
  }
  return (
    <Box
      sx={{
        maxWidth: 300,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ImgIcon src={imgAssets.weaponTypes[weaponType]} size={1.25} />
        <Typography
          sx={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.3 }}
        >
          <WeaponName weaponKey={weapon.key} />
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: 'text.secondary',
          fontSize: '0.75rem',
        }}
      >
        <StarsDisplay stars={rarity} colored />
        <span>
          Lv. {getLevelString(weapon.level, weapon.ascension)}
          {weaponHasRefinement(weapon.key) && ` · R${weapon.refinement}`}
        </span>
      </Box>
      {uiData && (
        <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary' }}>
          {stat(uiData.get(input.weapon.main))}
          {stat(uiData.get(input.weapon.sub))}
        </Box>
      )}
      {weaponHasRefinement(weapon.key) && (
        <Box>
          <Typography
            component="div"
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'primary.light',
            }}
          >
            <WeaponPassiveName weaponKey={weapon.key} />
          </Typography>
          <Typography
            component="div"
            sx={{ mt: 0.25, fontSize: '0.8125rem', lineHeight: 1.5 }}
          >
            <WeaponPassiveDesc
              weaponKey={weapon.key}
              refineIndex={weapon.refinement - 1}
            />
          </Typography>
        </Box>
      )}
    </Box>
  )
}
