import {
  BootstrapTooltip,
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
  CharacterKey,
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
import {
  getCharEle,
  getWeaponStat,
  weaponHasRefinement,
} from '@genshin-optimizer/gi/stats'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
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
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  FormControlLabel,
  IconButton,
  Snackbar,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { Fragment, memo, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changedMembers, equipTeamResult, saveTeamResult } from './apply'
import { formatGain, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'
import type { ResultDetailsData } from './ResultDetails'
import { MemberDetails, useResultDetails } from './ResultDetails'
import { TeamCardButton } from './TeamCardButton'
import {
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  quickSx,
  tokens,
  type,
} from './ui'
import { useTeamOpt } from './useTeamOpt'

/** Open and close: the design's quick Collapse */
const COLLAPSE_MS = 180

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
  // the toggles answer at once; the cards' stats and damage render after, in the background
  const detailsShown = useDeferredValue(showDetails)
  // the members' changes against their equipped builds: off by default (less to read)
  const [compare, setCompare] = useState(false)
  const details = useResultDetails(
    teamId,
    runTeamOpt,
    result,
    showDetails,
    applied
  )
  // a result below the current builds: says so (even when not comparing), and why
  const belowNow = after.total < before.total * (1 - 1e-4)
  const discardLabel = t('teamOpt.result.discard', 'Discard')

  return (
    <Panel>
      {/* the headline (the rotation's damage), the actions, and discard in the corner */}
      <Box
        sx={(theme) => ({
          display: 'grid',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1.5,
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gridTemplateAreas: '"head close" "actions actions"',
          [theme.breakpoints.up('md')]: {
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            gridTemplateAreas: '"head actions close"',
          },
        })}
      >
        <Box sx={{ gridArea: 'head', minWidth: 0 }}>
          <FieldLabel>
            {rotationTime
              ? t('teamOpt.result.dps', 'Team DPS')
              : t('teamOpt.result.total', 'Rotation damage')}
          </FieldLabel>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              columnGap: 1,
            }}
          >
            <Typography component="p" sx={type.figure}>
              {formatRate(after.total, rotationTime, true)}
            </Typography>
            {compare && (
              <>
                <Typography
                  component="span"
                  sx={{
                    ...numSx,
                    fontSize: 15,
                    fontWeight: 650,
                    color: gain > 0.0005 ? 'success.main' : 'text.secondary',
                  }}
                >
                  {formatGain(gain)}
                </Typography>
                <Typography component="span" sx={{ ...type.label, ...numSx }}>
                  {t('teamOpt.result.from', {
                    defaultValue: 'from {{value}}',
                    value: formatRate(before.total, rotationTime, true),
                  })}
                </Typography>
              </>
            )}
          </Box>
          <Typography
            sx={{ ...type.label, ...numSx, fontWeight: 400, mt: 0.25 }}
          >
            {t('teamOpt.result.meta', {
              defaultValue: 'Found in {{seconds}} s, {{count}} rounds',
              seconds: seconds < 10 ? seconds.toFixed(1) : Math.round(seconds),
              count: result.rounds,
            })}
          </Typography>
        </Box>

        <Box
          sx={{
            gridArea: 'actions',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.5,
            rowGap: 1,
          }}
        >
          <FormControlLabel
            sx={{
              m: 0,
              gap: 0.75,
              flexBasis: { xs: '100%', md: 'auto' },
              '& .MuiSwitch-root': { ml: -0.75 },
            }}
            control={
              <Switch
                size="small"
                checked={compare}
                onChange={() => setCompare((c) => !c)}
              />
            }
            label={
              <Typography
                component="span"
                sx={{
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: compare ? 'text.primary' : 'text.secondary',
                  ...quickSx,
                }}
              >
                {t('teamOpt.result.compare', 'Compare with equipped')}
              </Typography>
            }
          />
          <Box
            aria-hidden
            sx={{
              display: { xs: 'none', md: 'block' },
              width: '1px',
              height: 24,
              bgcolor: tokens.hairlineStrong,
            }}
          />
          {/* on phones: one row, the buttons sharing it (their icons dropped to fit) */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flex: { xs: '1 1 100%', md: '0 0 auto' },
              '& > *': { flex: { xs: '1 1 auto', md: '0 0 auto' } },
              '& .MuiButton-root': {
                whiteSpace: 'nowrap',
                px: { xs: 1.25, sm: 2 },
              },
              // (the tooltip's wrapper takes the room; its button fills it)
              '& > span > .MuiButton-root': { width: '100%' },
              '& .MuiButton-startIcon': {
                display: { xs: 'none', sm: 'inherit' },
              },
            }}
          >
            <TeamCardButton
              teamId={teamId}
              result={result}
              runTeamOpt={runTeamOpt}
              rotationTime={rotationTime}
            />
            {applied ? (
              <Typography
                role="status"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.5,
                  minHeight: 36,
                  px: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'success.main',
                }}
              >
                <CheckIcon sx={{ fontSize: 18 }} />
                {applied === 'equip'
                  ? t('teamOpt.result.equipped', 'Equipped')
                  : t('teamOpt.result.saved', 'Saved as builds')}
              </Typography>
            ) : (
              <>
                <Tooltip
                  arrow
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
                  aria-expanded={confirm}
                  onClick={() => setConfirm((c) => !c)}
                >
                  {t('teamOpt.result.equip', 'Equip')}
                </Button>
              </>
            )}
          </Box>
        </Box>

        <Tooltip arrow title={discardLabel}>
          <IconButton
            onClick={onDiscard}
            aria-label={discardLabel}
            sx={{
              gridArea: 'close',
              alignSelf: { xs: 'start', md: 'center' },
              justifySelf: 'end',
              mr: -0.5,
              color: 'text.secondary',
              ...quickSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* what to know before using it (each opens and closes smoothly) */}
      <Collapse in={!!stale} timeout={COLLAPSE_MS} unmountOnExit>
        <Notice
          tone="warning"
          actions={
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
        </Notice>
      </Collapse>
      {belowNow && (
        <Notice tone="warning">
          {t('teamOpt.result.belowNow', {
            defaultValue: 'Below your current builds ({{value}})',
            value: formatRate(before.total, rotationTime, true),
          })}
          {!!result.startBreaksSetRules?.length && (
            <>
              {': '}
              <Names keys={result.startBreaksSetRules} gender={gender} />{' '}
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
              <Names keys={result.startUntickedWeapons} gender={gender} />{' '}
              {t('teamOpt.result.belowNowWeapons', {
                count: result.startUntickedWeapons.length,
                defaultValue:
                  'can’t keep their current weapon: it isn’t ticked in Weapons to choose from',
              })}
            </>
          )}
        </Notice>
      )}
      <Collapse in={confirm && !applied} timeout={COLLAPSE_MS} unmountOnExit>
        <Notice
          icon={<CheckroomIcon />}
          actions={
            <>
              <Button
                size="small"
                variant="text"
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
            </>
          }
        >
          {t('teamOpt.result.equipWarn', {
            defaultValue:
              'Equips the new builds on {{count}} members (saved builds are updated instead). Artifacts move from whoever wears them now.',
            count: changed.length,
          })}
        </Notice>
      </Collapse>
      {noChange && !applied && (
        <Typography
          sx={{
            ...type.label,
            fontWeight: 400,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.75,
            mt: 1.25,
          }}
        >
          <CheckIcon
            sx={{
              fontSize: 16,
              mt: '1px',
              flexShrink: 0,
              color: 'success.main',
            }}
          />
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
              gridTemplateColumns: `repeat(${detailsShown ? 2 : 4}, minmax(0, 1fr))`,
            },
            // expanded: four in a row only where each artifact's stats stay readable
            ...(detailsShown && {
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
              showDetails={detailsShown}
              detailsToggled={showDetails}
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
        // above the page's run bar (it sticks to the bottom)
        sx={{ bottom: { xs: 132, sm: 96 } }}
        onClose={(_, reason) =>
          reason !== 'clickaway' && setLastExcluded(undefined)
        }
      >
        {/* a toast floats: raised, with a shadow */}
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.25,
            rowGap: 0.5,
            maxWidth: 560,
            minHeight: 44,
            pl: 1.5,
            pr: 1,
            py: 0.75,
            borderRadius: 2.5,
            bgcolor: tokens.raised,
            border: `1px solid ${tokens.hairlineStrong}`,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
            fontSize: 13.5,
          }}
        >
          <ExcludeIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Box component="span" sx={{ flex: '1 1 220px', minWidth: 0 }}>
            {t(
              'teamOpt.result.excludedToast',
              'Excluded from this team. Run again to find builds without it.'
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto' }}>
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => lastExcluded && toggleExcluded(lastExcluded)}
            >
              {t('teamOpt.result.undo', 'Undo')}
            </Button>
            {onRunAgain && (
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  setLastExcluded(undefined)
                  onRunAgain()
                }}
              >
                {t('teamOpt.result.runAgain', 'Run again')}
              </Button>
            )}
          </Box>
        </Box>
      </Snackbar>
    </Panel>
  )
}

/** Characters' names, bold, separated by commas */
function Names({
  keys,
  gender,
}: {
  keys: readonly CharacterKey[]
  gender: 'F' | 'M'
}) {
  return (
    <>
      {keys.map((ck, i) => (
        <Fragment key={ck}>
          {i > 0 && ', '}
          <strong>
            <CharacterName characterKey={ck} gender={gender} />
          </strong>
        </Fragment>
      ))}
    </>
  )
}

/**
 * A line to read before using the result: an icon, the words, and its actions on the right.
 * Warning: something to fix or know (amber); otherwise a neutral raised strip (a confirmation).
 */
function Notice({
  tone = 'neutral',
  icon,
  actions,
  children,
}: {
  tone?: 'warning' | 'neutral'
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    // (the top space is inside: a Collapse opens it with the line, without a jump)
    <Box sx={{ pt: 1.25 }}>
      <Box
        role={tone === 'warning' ? 'alert' : undefined}
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.75,
          minHeight: 40,
          px: 1.5,
          py: 0.875,
          borderRadius: tokens.radius.inset,
          fontSize: 13.5,
          lineHeight: 1.45,
          ...(tone === 'warning'
            ? {
                bgcolor: alpha(theme.palette.warning.main, 0.07),
                border: `1px solid ${alpha(theme.palette.warning.main, 0.28)}`,
              }
            : {
                bgcolor: tokens.raised,
                border: `1px solid ${tokens.hairlineStrong}`,
              }),
        })}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            flex: '1 1 280px',
            minWidth: 0,
            '& > svg': {
              fontSize: 18,
              mt: '1px',
              flexShrink: 0,
              color: tone === 'warning' ? 'warning.main' : 'text.secondary',
            },
          }}
        >
          {icon ?? <WarningAmberRoundedIcon />}
          <Box component="span" sx={{ minWidth: 0 }}>
            {children}
          </Box>
        </Box>
        {actions && (
          <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto' }}>{actions}</Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * The requirements a member's build does not meet, each with its stat, what the build reaches and
 * what it needs. Why, on hover: no build of the member gets there with its settings (this is the
 * closest one), or it was kept as it is.
 */
export function Shortfalls({
  shortfalls,
  data,
  optimized,
  why,
}: {
  shortfalls: TeamOptShortfall[]
  /** The member's data: what names its requirements */
  data: UIData | undefined
  optimized: boolean
  /** Why no build reaches them (default: Team Optimize's reasons) */
  why?: string
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      arrow
      placement="top"
      title={
        why ??
        (optimized
          ? t(
              'teamOpt.result.unmetWhy',
              'No build reaches it with this member’s settings: its main stats, the sets it may use, the artifact levels and the weapons ticked. This build gets the closest. Lower the requirement, or allow more.'
            )
          : t(
              'teamOpt.result.unmetKept',
              'Kept as it is: its build does not reach it.'
            ))
      }
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.75,
          alignSelf: 'flex-start',
          maxWidth: '100%',
          cursor: 'help',
          color: 'warning.main',
        }}
      >
        <WarningAmberRoundedIcon
          sx={{ fontSize: 16, mt: '1px', flexShrink: 0 }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
                sx={{ ...numSx, fontSize: 12.5, lineHeight: 1.5 }}
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
      </Box>
    </Tooltip>
  )
}

/** A member's colour: its element's, from the theme */
const elementColor = (theme: Theme, characterKey: CharacterKey) =>
  (theme.palette as unknown as Record<string, { main?: string } | undefined>)[
    getCharEle(characterKey)
  ]?.main ?? theme.palette.text.secondary

/** A small neutral tag next to a name (constellation, "Kept") */
const tagSx: SxProps<Theme> = {
  flexShrink: 0,
  px: 0.625,
  borderRadius: 1,
  fontSize: 11.5,
  fontWeight: 650,
  lineHeight: 1.6,
  color: 'text.secondary',
  bgcolor: alpha(giTokens.parchment, 0.07),
  ...numSx,
}

function MemberResult({
  member,
  result,
  teamData,
  rotationTime,
  runTeamOpt,
  showDetails,
  detailsToggled,
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
  /** ...or are about to be (its toggle's state, at once) */
  detailsToggled: boolean
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
  const ownChange = before > 0 ? after / before - 1 : 0

  return (
    <Box
      sx={{
        ...insetSx,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      {/* who, its own damage, and its share of the team's (the bar, in its element's colour) */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <MemberAvatar characterKey={characterKey} size={36} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Typography sx={{ ...type.title, minWidth: 0 }} noWrap>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              {constellation !== undefined && (
                <Tooltip
                  arrow
                  title={t('teamOpt.result.constellation', {
                    defaultValue: 'Constellation {{value}}',
                    value: constellation,
                  })}
                >
                  <Box component="span" sx={tagSx}>
                    C{constellation}
                  </Box>
                </Tooltip>
              )}
              {!optimized && (
                <Box component="span" sx={tagSx}>
                  {isTc
                    ? t('teamOpt.result.tc', 'TC build, kept')
                    : t('teamOpt.result.kept', 'Kept')}
                </Box>
              )}
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                columnGap: 0.75,
                ...numSx,
              }}
            >
              <Typography
                component="span"
                sx={{ ...numSx, fontSize: 13.5, fontWeight: 650 }}
              >
                {formatRate(after, rotationTime)}
              </Typography>
              {compare && before > 0 && Math.abs(ownChange) >= 0.0005 && (
                <Typography
                  component="span"
                  sx={{
                    ...numSx,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: after > before ? 'success.main' : 'warning.main',
                  }}
                >
                  {formatGain(ownChange)}
                </Typography>
              )}
              <Typography component="span" sx={type.label}>
                {rotationTime
                  ? t('teamOpt.result.ownDps', 'own DPS')
                  : t('teamOpt.result.own', 'own damage')}
              </Typography>
            </Box>
          </Box>
          <Tooltip
            arrow
            title={
              rotationTime
                ? t('teamOpt.result.shareDps', 'Its share of the team’s DPS')
                : t('teamOpt.result.share', 'Its share of the team’s damage')
            }
          >
            <Box sx={{ flexShrink: 0, textAlign: 'right', cursor: 'default' }}>
              <Typography
                sx={{
                  ...numSx,
                  fontSize: 15,
                  fontWeight: 650,
                  lineHeight: 1.3,
                }}
              >
                {Math.round(share * 100)}%
              </Typography>
              <Typography sx={{ ...type.label, lineHeight: 1.3 }}>
                {t('teamOpt.result.shareLabel', 'of team')}
              </Typography>
            </Box>
          </Tooltip>
        </Box>
        <Box
          sx={{
            mt: 1,
            height: 3,
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: alpha(giTokens.parchment, 0.07),
          }}
        >
          <Box
            sx={(theme) => ({
              height: '100%',
              width: `${clamp(share, 0, 1) * 100}%`,
              borderRadius: 2,
              bgcolor: alpha(elementColor(theme, characterKey), 0.85),
            })}
          />
        </Box>
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
            const excludeLabel = excluded
              ? t('teamOpt.result.include', 'Use it again')
              : t(
                  'teamOpt.result.exclude',
                  "Exclude from this team's optimization"
                )
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
                  // new to the member (comparing): a gold ring
                  outline: isNew
                    ? `2px solid ${alpha(theme.palette.primary.main, 0.8)}`
                    : undefined,
                  outlineOffset: 1,
                  // expanded: one tile, the icon over its stats
                  ...(showDetails && {
                    overflow: 'hidden',
                    border: hairline,
                    bgcolor: alpha(giTokens.parchment, 0.025),
                  }),
                })}
              >
                <Box sx={{ position: 'relative' }}>
                  <Box
                    sx={{
                      opacity: excluded ? 0.35 : 1,
                      filter: excluded ? 'grayscale(1)' : undefined,
                      transition: 'opacity .12s, filter .12s',
                    }}
                  >
                    <ArtifactCardPico
                      artifactObj={id ? database.arts.get(id) : undefined}
                      slotKey={slotKey}
                    />
                  </Box>
                  {excluded && (
                    <Typography
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 650,
                        lineHeight: 1.1,
                        pointerEvents: 'none',
                        textShadow: '0 0 4px rgba(0,0,0,0.9)',
                      }}
                    >
                      {t('teamOpt.result.excluded', 'Excluded')}
                    </Typography>
                  )}
                </Box>
                {id && (
                  <Tooltip arrow title={excludeLabel}>
                    <IconButton
                      className="exclude-art"
                      size="small"
                      aria-label={excludeLabel}
                      aria-pressed={excluded}
                      onClick={() => onToggleExcluded(id)}
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        p: 0.25,
                        zIndex: 1,
                        transition:
                          'opacity .12s, color .12s, background-color .12s',
                        color: excluded ? 'warning.main' : 'text.primary',
                        bgcolor: alpha(tokens.raised, 0.88),
                        '&:hover': { bgcolor: tokens.hover },
                        ...focusSx,
                        '@media (prefers-reduced-motion: reduce)': {
                          transition: 'none',
                        },
                      }}
                    >
                      {excluded ? (
                        <UndoIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <ExcludeIcon sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
                {id && (
                  <Collapse
                    in={showDetails}
                    timeout={COLLAPSE_MS}
                    unmountOnExit
                  >
                    <ArtifactStats artifactId={id} />
                  </Collapse>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {/* the weapon (details on hover), the sets, the energy weapons' help */}
      {(weapon || !!sets.length || energy) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
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
                  <Typography
                    sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}
                    noWrap
                  >
                    <WeaponName weaponKey={weapon.key} />
                  </Typography>
                  <Typography
                    sx={{
                      ...type.label,
                      ...numSx,
                      fontWeight: 400,
                      lineHeight: 1.35,
                      color: unticked ? 'warning.main' : 'text.secondary',
                    }}
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
                <Typography
                  sx={{ ...type.label, fontWeight: 400, ...numSx }}
                  noWrap
                >
                  {n >= 4 ? 4 : 2}× <ArtifactSetName setKey={setKey} />
                </Typography>
              </Box>
            </ArtifactSetTooltip>
          ))}
          {energy && (
            <Typography
              sx={{
                ...type.label,
                fontWeight: 400,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <BoltIcon
                sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }}
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
        </Box>
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
          <Typography
            sx={{
              fontSize: 12.5,
              color: 'warning.main',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
            {t('teamOpt.result.unmet', {
              defaultValue: '{{count}} requirement not met',
              count: unmet.length,
            })}
          </Typography>
        )
      )}
      <Collapse in={showDetails} timeout={COLLAPSE_MS} unmountOnExit>
        <Box sx={{ pt: 1.25, borderTop: hairline }}>
          <MemberDetails
            characterKey={characterKey}
            details={details}
            teamOpt={runTeamOpt}
            rotationTime={rotationTime}
            compare={compare}
          />
        </Box>
      </Collapse>
      {/* pushed to the card's foot: the cards' toggles line up */}
      <Box sx={{ flexGrow: 1, mt: -1.25 }} />
      <ButtonBase
        onClick={onToggleDetails}
        aria-expanded={detailsToggled}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          mx: -1.25,
          mb: -1.25,
          minHeight: 36,
          borderTop: hairline,
          borderBottomLeftRadius: 'inherit',
          borderBottomRightRadius: 'inherit',
          color: detailsToggled ? 'text.primary' : 'text.secondary',
          fontSize: 12.5,
          fontWeight: 600,
          ...quickSx,
          '&:hover': {
            color: 'text.primary',
            bgcolor: alpha(giTokens.parchment, 0.04),
          },
          ...focusSx,
        }}
      >
        {detailsToggled
          ? t('teamOpt.result.hideDetails', 'Hide stats and damage')
          : t('teamOpt.result.showDetails', 'Stats and damage')}
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            transform: detailsToggled ? 'rotate(180deg)' : 'none',
            transition: `transform .18s ${tokens.ease}`,
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
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
const ArtifactStats = memo(function ArtifactStats({
  artifactId,
}: {
  artifactId: string
}) {
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
})

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
export function WeaponThumb({
  weapon,
  highlight,
  size = 44,
}: {
  weapon: ICachedWeapon
  highlight: boolean
  size?: number
}) {
  const { rarity } = getWeaponStat(weapon.key)
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width: size,
        height: size,
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

/**
 * A weapon at a glance (its tooltip): art and name, rarity, type, level and refinement, its two
 * stats, then its passive at that refinement
 */
export function WeaponDetails({ weapon }: { weapon: ICachedWeapon }) {
  const sheet = getWeaponSheet(weapon.key)
  const uiData = useMemo(
    () => sheet && computeUIData([sheet.data, dataObjForWeapon(weapon)]),
    [sheet, weapon]
  )
  const { rarity, weaponType } = getWeaponStat(weapon.key)
  const stats = uiData
    ? [uiData.get(input.weapon.main), uiData.get(input.weapon.sub)].filter(
        (node) => !node.isEmpty && !!node.value
      )
    : []
  return (
    <Box
      sx={{
        width: 320,
        maxWidth: '100%',
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          className={`grad-${rarity}star`}
          sx={{
            width: 52,
            height: 52,
            flexShrink: 0,
            borderRadius: 1.5,
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={weaponAsset(weapon.key, weapon.ascension >= 2)}
            alt=""
            sx={{ width: '100%', height: '100%', display: 'block' }}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3 }}
          >
            <WeaponName weaponKey={weapon.key} />
          </Typography>
          <Box
            sx={{
              mt: 0.375,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              color: 'text.secondary',
              fontSize: '0.75rem',
              ...numSx,
            }}
          >
            <StarsDisplay stars={rarity} colored />
            <ImgIcon src={imgAssets.weaponTypes[weaponType]} size={1.1} />
            <span>
              Lv. {getLevelString(weapon.level, weapon.ascension)}
              {weaponHasRefinement(weapon.key) && ` · R${weapon.refinement}`}
            </span>
          </Box>
        </Box>
      </Box>
      {!!stats.length && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
            gap: 1.5,
          }}
        >
          {stats.map((node, i) => {
            const { name, icon } = resolveInfo(node.info)
            return (
              <Box key={i} sx={{ minWidth: 0 }}>
                <Typography
                  component="div"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    '& svg': { fontSize: '1.05em' },
                  }}
                >
                  {icon}
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </Box>
                </Typography>
                <Typography
                  sx={{ fontSize: '0.9375rem', fontWeight: 600, ...numSx }}
                >
                  {GetCalcDisplay(node).valueString}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
      {weaponHasRefinement(weapon.key) && (
        <Box sx={{ pt: 1.25, borderTop: hairline }}>
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
            sx={{
              mt: 0.375,
              fontSize: '0.8125rem',
              lineHeight: 1.55,
              // (the translated text's own Typography would reset it to the body size)
              '& .MuiTypography-root': {
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
            }}
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
