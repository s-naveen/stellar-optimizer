import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptEnergyCalculator } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmResult,
  KqmTeamOption,
  TeamData,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  KQM_TALENT_DEFAULT,
  kqmConstellation,
  KQM_ER_DEFAULT,
  kqmEnergyRequirement,
  kqmHasEnergyRequirement,
  kqmMemberConstellation,
  kqmTalentLevel,
  kqmWeapons,
  syncEnergyCalculator,
} from '@genshin-optimizer/gi/ui'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import CloseIcon from '@mui/icons-material/Close'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  type SxProps,
  TextField,
  type Theme,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatRate } from './format'
import {
  KqmSetChooser,
  KqmWeaponChooser,
  kqmChooserCounts,
} from './KqmChoosers'
import { KqmGearIcons, KqmRollLine } from './KqmBuildView'
import { KqmCompare, setKqmPicks } from './KqmComparison'
import { KqmEnergyCalculator, kqmEnergyEstimate } from './KqmEnergyCalculator'
import { KqmTopTeams } from './KqmTopTeams'
import { MemberAvatar } from './MemberAvatar'
import {
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  selectedSx,
  tokens,
  type,
} from './ui'
import { useKqmProgress } from './useKqmRun'
import type { TeamOptUpdate } from './useTeamOpt'

/** A member row's columns: name, build, constellation, minimum ER (one line from `sm`) */
const memberGrid = {
  display: 'grid',
  alignItems: 'center',
  columnGap: { xs: 1, sm: 1.5 },
  rowGap: 1,
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr) 76px 104px',
    sm: 'minmax(140px, 1fr) 84px 128px',
  },
  gridTemplateAreas: { xs: '"name cons er"', sm: '"name cons er"' },
} as const

/** A compact outlined field: 36 px tall, tabular numbers */
const compactFieldSx = {
  '& .MuiInputBase-root': { fontSize: 14 },
  '& .MuiInputBase-input': { py: 0.875, ...numSx },
  '& .MuiSelect-select': { py: 0.875, ...numSx },
} as const

/**
 * The ER calculator's settings for the team as it is now: members added since get the starting
 * assumptions, at their KQM constellation (see `syncEnergyCalculator`)
 */
function teamCalculator(
  members: TeamOptMember[],
  teamOpt: TeamOpt,
  saved: TeamOptEnergyCalculator | undefined
) {
  const keys = members.map((m) => m.characterKey)
  return syncEnergyCalculator(
    keys,
    saved,
    teamOpt.rotationTime ?? 20,
    teamOpt.onField ?? keys[0],
    Object.fromEntries(
      keys.map((key) => [key, kqmMemberConstellation(key, teamOpt.kqm)])
    )
  )
}

/** KQM assumptions and equipment, saved with the team as they change. */
export function KqmSettings({
  disabled = false,
  active = true,
  hasResult = false,
  canRun,
  onStart,
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
}: {
  disabled?: boolean
  active?: boolean
  /** There are results: its action runs again */
  hasResult?: boolean
  canRun: boolean
  onStart: (settings: TeamOpt) => void
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const titleId = useId()
  const [tab, setTab] = useState(0)
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const counts = kqmChooserCounts(members, teamOpt)
  // every member gets a KQM build (the KQM standard is for the whole team)
  const optimized = members
  const [calculatorInputs, setCalculatorDraft] = useState(() =>
    structuredClone(
      teamCalculator(members, teamOpt, teamOpt.kqm?.energyCalculator)
    )
  )
  // The rotation length above is shared by both workflows and the ER calculator.
  const rotationTime = teamOpt.rotationTime ?? 20
  const calculatorDraft = useMemo(
    () => ({
      ...teamCalculator(members, teamOpt, calculatorInputs),
      rotationTime,
    }),
    [members, teamOpt, calculatorInputs, rotationTime]
  )
  const [calculatorDirty, setCalculatorDirty] = useState(false)
  // (recomputed when the calculator or the KQM weapons change, not on every keystroke; the same
  // estimate as the calculator shows)
  const calculatorEstimate = useMemo(
    () =>
      kqmEnergyEstimate(
        members.map((m) => m.characterKey),
        calculatorDraft,
        kqm
      ),
    [members, calculatorDraft, kqm]
  )
  const applyCalculator = () => {
    setTeamOpt((o) => {
      o.kqm = {
        ...(o.kqm ?? defaultTeamOptKqm),
        energySource: 'calculator',
        energyCalculator: structuredClone(calculatorDraft),
        energyRecharge: { ...calculatorEstimate.targets },
      }
    })
    setCalculatorDirty(false)
    setTab(0)
  }
  const leaveCalculator = () => {
    setCalculatorDraft(
      structuredClone(teamCalculator(members, teamOpt, kqm.energyCalculator))
    )
    setCalculatorDirty(false)
    setTab(0)
  }
  const missingWeapons = optimized.filter(
    (m) => !kqmWeapons(m.characterKey, kqm).length
  )
  const [erText, setErText] = useState<Partial<Record<CharacterKey, string>>>(
    () =>
      Object.fromEntries(
        members.map(({ characterKey }) => [
          characterKey,
          kqmEnergyRequirement(teamOpt.kqm, characterKey).toString(),
        ])
      )
  )
  // a target typed below 100% (an empty field is the 100% default, no requirement)
  const erTextInvalid = (text = '') =>
    !!text.trim() && !kqmHasEnergyRequirement(Number(text.replace(',', '.')))
  const missingEr = members.filter((m) => erTextInvalid(erText[m.characterKey]))
  const blocked =
    !optimized.length || !!missingWeapons.length || !!missingEr.length
  const setEr = (characterKey: CharacterKey, text: string) => {
    setErText((previous) => ({ ...previous, [characterKey]: text }))
    const value = text.trim() ? Number(text.replace(',', '.')) : undefined
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      settings.energySource = 'manual'
      const requirements = (settings.energyRecharge ??= {})
      if (kqmHasEnergyRequirement(value)) requirements[characterKey] = value
      else delete requirements[characterKey]
    })
  }
  useEffect(() => {
    if (teamOpt.kqm?.energySource === 'calculator')
      setErText(
        Object.fromEntries(
          members.map(({ characterKey }) => [
            characterKey,
            kqmEnergyRequirement(teamOpt.kqm, characterKey).toString(),
          ])
        )
      )
  }, [teamOpt.kqm?.energyRecharge, teamOpt.kqm?.energySource, members])
  // Keep applied ER targets current when the common rotation length changes.
  useEffect(() => {
    const applied = teamOpt.kqm?.energyCalculator
    const rotationTime = teamOpt.rotationTime ?? 20
    if (
      teamOpt.kqm?.energySource !== 'calculator' ||
      !applied ||
      applied.rotationTime === rotationTime
    )
      return
    const energyCalculator = {
      ...teamCalculator(members, teamOpt, applied),
      rotationTime,
    }
    const estimate = kqmEnergyEstimate(
      members.map((m) => m.characterKey),
      energyCalculator,
      teamOpt.kqm
    )
    setTeamOpt((o) => {
      o.kqm = {
        ...(o.kqm ?? defaultTeamOptKqm),
        energyCalculator,
        energyRecharge: estimate.targets,
      }
    })
  }, [teamOpt, members, setTeamOpt])
  const problem = !canRun
    ? t('teamOpt.kqm.addAttacks', 'Add rotation attacks above')
    : !optimized.length
      ? t('teamOpt.empty.title', 'Add the team’s members first')
      : missingWeapons.length
        ? t('teamOpt.kqm.noWeaponsShort', 'Select weapons')
        : calculatorDirty
          ? t('teamOpt.kqm.calc.review', 'Apply ER changes')
          : missingEr.length
            ? t('teamOpt.kqm.erInvalidShort', {
                defaultValue: '{{count}} ER targets below 100%',
                count: missingEr.length,
              })
            : ''
  // the first problem is ER targets below 100%: one click sets them to 100% (no requirement)
  const problemIsEr =
    !!canRun &&
    !!optimized.length &&
    !missingWeapons.length &&
    !calculatorDirty &&
    !!missingEr.length
  const fillMissingEr = () => {
    for (const { characterKey } of missingEr) setEr(characterKey, '100')
  }
  const closePanel = () => (tab === 3 ? leaveCalculator() : setTab(0))
  // (the drawer keeps its content while it slides out)
  const lastTab = useRef(tab || 1)
  if (tab) lastTab.current = tab
  const panelTab = tab || lastTab.current
  const panelTitle =
    panelTab === 1
      ? t('teamOpt.kqm.weaponsList', 'Weapons')
      : panelTab === 2
        ? t('teamOpt.kqm.sets', 'Artifact sets')
        : t('teamOpt.kqm.calc.tab', 'ER calculator')
  const panelInfo =
    panelTab === 1
      ? t(
          'teamOpt.kqm.weaponHelp',
          'Select weapons to compare. Adjust refinement, effects and energy contribution below each weapon.'
        )
      : panelTab === 2
        ? t(
            'teamOpt.kqm.setHelp',
            'Choose sets and configure their effects for each member. Their existing set rules still apply. Clear all to compare without a set bonus.'
          )
        : t(
            'teamOpt.kqm.calc.intro',
            'Confirm skill uses, particle catching and field time for one rotation. ER is calculated for the whole team, then applied to KQM. Extra energy from abilities or effects goes in Bonus flat energy.'
          )
  const weaponsLabel = t('teamOpt.kqm.weaponsCount', {
    defaultValue: '{{count}} weapons',
    count: counts.weapons.allowed,
  })
  const setsLabel = t('teamOpt.kqm.setsCount', {
    defaultValue: '{{count}} artifact sets',
    count: counts.sets.allowed,
  })
  const calculated = kqm.energySource === 'calculator' && !calculatorDirty
  return (
    <Box
      component="fieldset"
      id={`kqm-settings-${teamId}`}
      disabled={disabled}
      aria-labelledby={titleId}
      sx={{
        border: 0,
        m: 0,
        p: { xs: 1, sm: 2 },
        minWidth: 0,
        scrollMarginTop: 88,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? 'none' : undefined,
        transition: 'opacity .18s',
      }}
    >
      {/* the title and its rules; the one main action, with what still blocks it */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1.5,
          mb: 2,
        }}
      >
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <Typography id={titleId} component="h2" sx={type.section}>
            {hasResult
              ? t('teamOpt.kqm.setup', 'KQM setup')
              : t('teamOpt.kqm.tab', 'KQM Theorycrafting')}
          </Typography>
          <KqmAssumptions talents={kqmTalentLevel(kqm)} />
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            ml: 'auto',
          }}
        >
          {!!problem && (
            <Box
              role="status"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                fontSize: 13,
                color: 'warning.main',
              }}
            >
              <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
              <span>{problem}</span>
              {problemIsEr && (
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  onClick={fillMissingEr}
                  sx={{ minWidth: 0, px: 1, py: 0.25, ml: 0.25 }}
                >
                  {t('teamOpt.kqm.erFill', 'Set 100%')}
                </Button>
              )}
            </Box>
          )}
          <Button
            variant="contained"
            disabled={disabled || !canRun || blocked || calculatorDirty}
            endIcon={<ArrowForwardIcon />}
            sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
            onClick={() => {
              setTab(0)
              onStart(teamOpt)
            }}
          >
            {hasResult
              ? t('teamOpt.result.runAgain', 'Run again')
              : t('teamOpt.kqm.generateShort', 'Generate builds')}
          </Button>
        </Box>
      </Box>

      {/* one row per member: its build, constellation and the Energy Recharge it needs */}
      <Box sx={{ ...insetSx, overflow: 'hidden' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            pl: 1.5,
            pr: 1,
            py: 0.75,
            minHeight: 48,
            borderBottom: hairline,
          }}
        >
          <Typography
            component="h3"
            sx={{
              ...type.title,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexGrow: 1,
            }}
          >
            {t('teamOpt.kqm.membersAll', 'Members')}
            <InfoTooltipInline
              title={t(
                'teamOpt.kqm.membersAllHelp',
                'Every member gets a KQM Standards build at the constellation shown: level 90, the talent levels set here, five +20 artifacts with 2 fixed rolls per substat and 20 rolls placed for damage.'
              )}
            />
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 0.5 }}>
            <FieldLabel
              tip={t(
                'teamOpt.kqm.talentsTip',
                'Every member’s talent levels (normal attack, skill, burst; constellations add theirs on top). KQM’s guides compare at 9/9/9; 10/10/10 is with Crowns.'
              )}
            >
              {t('teamOpt.kqm.talents', 'Talents')}
            </FieldLabel>
            <Segmented
              size="small"
              value={kqmTalentLevel(kqm)}
              aria-label={t('teamOpt.kqm.talents', 'Talents')}
              options={[9, 10].map((level) => ({
                value: level as 9 | 10,
                label: `${level}/${level}/${level}`,
              }))}
              onChange={(level) =>
                setTeamOpt((o) => {
                  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
                  settings.talents =
                    level === KQM_TALENT_DEFAULT ? undefined : level
                })
              }
            />
          </Box>
          {calculated && (
            <FieldLabel
              tip={t(
                'teamOpt.kqm.calc.active',
                'Calculator targets applied. ER is recalculated for each weapon choice during optimization. Editing a target switches back to manual ER requirements.'
              )}
            >
              {t('teamOpt.kqm.erFromCalc', 'ER from the calculator')}
            </FieldLabel>
          )}
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<CalculateOutlinedIcon />}
            onClick={() => setTab(3)}
          >
            {t('teamOpt.kqm.calc.open', 'Calculate ER')}
          </Button>
        </Box>
        {/* column labels (phones: each field says what it is) */}
        <Box
          sx={{
            ...memberGrid,
            display: { xs: 'none', sm: 'grid' },
            px: 1.5,
            pt: 1,
          }}
        >
          <FieldLabel
            sx={{ gridArea: 'cons' }}
            tip={t(
              'teamOpt.kqm.consTip',
              'Constellation of this KQM build. KQM standard: C6 for 4★, C0 for 5★.'
            )}
          >
            {t('teamOpt.kqm.consColumn', 'Constellation')}
          </FieldLabel>
          <FieldLabel
            sx={{ gridArea: 'er', justifySelf: 'end' }}
            tip={t(
              'teamOpt.kqm.erHelp',
              'Total ER% each member needs, or calculate it for this rotation. 100% (the default) means no extra ER. The optimizer meets ER first, then uses the remaining rolls for damage.'
            )}
          >
            {t('teamOpt.kqm.minEr', 'Min ER')}
          </FieldLabel>
        </Box>
        {members.map(({ characterKey }, index) => {
          const text = erText[characterKey] ?? ''
          const invalid = erTextInvalid(text)
          // (marked only when the invalid targets are what blocks Generate)
          const missing =
            problemIsEr &&
            missingEr.some((m) => m.characterKey === characterKey)
          const cons = kqmMemberConstellation(characterKey, kqm)
          const standard = kqmConstellation(characterKey)
          return (
            <Box
              key={characterKey}
              sx={{
                ...memberGrid,
                px: 1.5,
                py: 1,
                borderTop: index > 0 ? hairline : undefined,
              }}
            >
              <Box
                sx={{
                  gridArea: 'name',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  minWidth: 0,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={32} />
                <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </Typography>
              </Box>
              <Box sx={{ gridArea: 'cons', minWidth: 0 }}>
                <KqmConstellationSelect
                  value={cons}
                  standard={standard}
                  characterKey={characterKey}
                  onChange={(value) =>
                    setTeamOpt((o) => {
                      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
                      const next = { ...(settings.constellations ?? {}) }
                      if (value === standard) delete next[characterKey]
                      else next[characterKey] = value
                      settings.constellations = Object.keys(next).length
                        ? next
                        : undefined
                    })
                  }
                />
              </Box>
              <Box sx={{ gridArea: 'er', minWidth: 0 }}>
                <Tooltip
                  arrow
                  title={
                    invalid
                      ? t('teamOpt.kqm.erInvalid', 'Enter 100 or more')
                      : ''
                  }
                >
                  <TextField
                    size="small"
                    fullWidth
                    value={text}
                    error={invalid}
                    placeholder={`${KQM_ER_DEFAULT}`}
                    onChange={(e) => setEr(characterKey, e.target.value)}
                    inputProps={{
                      inputMode: 'decimal',
                      'aria-label': t('teamOpt.kqm.erInput', {
                        defaultValue: '{{character}} minimum ER (%)',
                        character: characterKey,
                      }),
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment
                          position="start"
                          sx={{ display: { sm: 'none' } }}
                        >
                          <Box component="span" sx={type.label}>
                            {t('teamOpt.kqm.erShort', 'ER')}
                          </Box>
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">%</InputAdornment>
                      ),
                    }}
                    sx={(theme) => ({
                      ...compactFieldSx,
                      '& .MuiInputBase-root': { fontSize: 14, px: 1.25 },
                      '& .MuiInputBase-input': {
                        py: 0.875,
                        textAlign: 'right',
                        ...numSx,
                      },
                      ...(missing && {
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: alpha(theme.palette.warning.main, 0.55),
                        },
                      }),
                    })}
                  />
                </Tooltip>
              </Box>
            </Box>
          )
        })}
      </Box>
      {/* what the builds may use: each opens its drawer */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          mt: 1.5,
        }}
      >
        <FieldLabel
          sx={{ mr: 0.5 }}
          tip={t(
            'teamOpt.kqm.compareScopeTip',
            'The weapons and artifact sets the builds may use. Each one is ranked in the results.'
          )}
        >
          {t('teamOpt.kqm.compareScope', 'Compare')}
        </FieldLabel>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<TuneOutlinedIcon />}
          onClick={() => setTab(1)}
        >
          {weaponsLabel}
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<TuneOutlinedIcon />}
          onClick={() => setTab(2)}
        >
          {setsLabel}
        </Button>
      </Box>
      <Drawer
        anchor="right"
        open={active && !disabled && tab !== 0}
        onClose={closePanel}
        PaperProps={{
          role: 'dialog',
          'aria-modal': true,
          'aria-label': panelTitle,
          sx: {
            width: { xs: '100%', md: 880 },
            maxWidth: '100%',
            bgcolor: tokens.panel,
            backgroundImage: 'none',
            borderLeft: hairline,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: { xs: 2, sm: 2.5 },
            pr: 1.25,
            minHeight: 60,
            borderBottom: hairline,
            flexShrink: 0,
          }}
        >
          <Typography
            component="h2"
            sx={{
              ...type.section,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flex: 1,
              minWidth: 0,
            }}
          >
            {panelTitle}
            <InfoTooltipInline title={panelInfo} />
          </Typography>
          <IconButton
            onClick={closePanel}
            aria-label={t('teamOpt.editor.close', 'Close')}
            sx={{ ...quickSx, ...focusSx }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: { xs: 1.5, sm: 2.5 }, overflowY: 'auto', flex: 1 }}>
          {panelTab === 1 && (
            <>
              <KqmWeaponChooser
                embedded
                teamId={teamId}
                members={members}
                teamData={teamData}
                teamOpt={teamOpt}
                setTeamOpt={setTeamOpt}
                onClose={closePanel}
              />
            </>
          )}
          {panelTab === 2 && (
            <KqmSetChooser
              embedded
              teamId={teamId}
              members={members}
              teamData={teamData}
              teamOpt={teamOpt}
              setTeamOpt={setTeamOpt}
              onClose={closePanel}
            />
          )}
          {panelTab === 3 && (
            <KqmEnergyCalculator
              members={members}
              kqm={kqm}
              settings={calculatorDraft}
              setSettings={(update) => {
                setCalculatorDraft((previous) =>
                  update(teamCalculator(members, teamOpt, previous))
                )
                setCalculatorDirty(true)
              }}
            />
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
            borderTop: hairline,
            flexShrink: 0,
          }}
        >
          {panelTab === 3 ? (
            <>
              <Typography
                role="status"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  color: 'warning.main',
                }}
              >
                {calculatorEstimate.errors[0] ?? ''}
              </Typography>
              <Button
                variant="contained"
                sx={giCtaSx}
                disabled={!!calculatorEstimate.errors.length}
                onClick={applyCalculator}
              >
                {t('teamOpt.kqm.calc.apply', 'Apply ER targets')}
              </Button>
            </>
          ) : (
            <>
              <Typography sx={{ ...type.label, ...numSx, flex: 1 }}>
                {panelTab === 1 ? weaponsLabel : setsLabel}
              </Typography>
              <Button variant="contained" sx={giCtaSx} onClick={closePanel}>
                {t('teamOpt.kqm.done', 'Done')}
              </Button>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}

/** The build rules under the title, in one muted line (the full rule in its tooltip) */
function KqmAssumptions({ talents }: { talents: 9 | 10 }) {
  const { t } = useTranslation('page_team')
  const labels = [
    t('teamOpt.kqm.ruleLevel', 'Lv. 90'),
    t('teamOpt.kqm.ruleCons', '4★ C6 · 5★ C0'),
    t('teamOpt.kqm.ruleTalentsLevel', {
      defaultValue: 'Talents {{level}}/{{level}}/{{level}}',
      level: talents,
    }),
    t('teamOpt.kqm.ruleArtifacts', '+20 artifacts'),
    t('teamOpt.kqm.ruleRolls', '2 fixed + 20 rolls'),
  ]
  return (
    <FieldLabel
      sx={{ mt: 0.5, lineHeight: 1.5 }}
      tip={t(
        'teamOpt.kqm.subtitle',
        'Standard KQM builds for this rotation: level 90, 4★ C6 / 5★ C0, the talent levels set below, five +20 artifacts with 2 fixed rolls per substat and 20 rolls placed for damage.'
      )}
    >
      {labels.join('  ·  ')}
    </FieldLabel>
  )
}

/**
 * What a KQM run is set up with, or was run with: each member's constellation and minimum ER,
 * the weapons and sets it compares, where its ER comes from. With `now`, what has changed since
 * is shown as it is now (→).
 */
export function KqmSetupSummary({
  members,
  settings,
  now,
  rotation,
  stalls,
  sx,
}: {
  members: TeamOptMember[]
  settings: TeamOpt
  /** The setup as it is now */
  now?: TeamOpt
  /** Its rotation's attacks: the written rotation as KQM played it, or the attacks entered */
  rotation?: 'played' | 'entered'
  /** What each rotation waited for to be ready (seconds) */
  stalls?: { label: string; seconds: number }[]
  sx?: SxProps<Theme>
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const kqm = settings.kqm ?? defaultTeamOptKqm
  const nowKqm = now ? (now.kqm ?? defaultTeamOptKqm) : undefined
  const counts = kqmChooserCounts(members, settings)
  const nowCounts = now ? kqmChooserCounts(members, now) : undefined
  const fromCalculator = kqm.energySource === 'calculator'
  const rotationChanged =
    !!now && JSON.stringify(now.attacks) !== JSON.stringify(settings.attacks)
  /** What it is now, if that changed */
  const nowIs = (value: ReactNode) => (
    <Box component="span" sx={{ color: tokens.gold, fontWeight: 600 }}>
      {' → '}
      {value}
    </Box>
  )
  const item = { display: 'inline-flex', alignItems: 'center', gap: 0.75 }
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.75,
          fontSize: 13,
          color: 'text.secondary',
          ...numSx,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {members.map(({ characterKey }) => {
        const cons = kqmMemberConstellation(characterKey, kqm)
        const nowCons = nowKqm && kqmMemberConstellation(characterKey, nowKqm)
        const er = kqmEnergyRequirement(kqm, characterKey)
        const nowEr = nowKqm && kqmEnergyRequirement(nowKqm, characterKey)
        return (
          <Tooltip
            key={characterKey}
            arrow
            title={
              <>
                <CharacterName characterKey={characterKey} gender={gender} />
                {`: C${cons}, ${t('teamOpt.kqm.minEr', 'Min ER')} ${er}%`}
              </>
            }
          >
            <Box component="span" sx={item}>
              <MemberAvatar characterKey={characterKey} size={22} />
              <Box component="span" sx={{ color: 'text.primary' }}>
                C{cons}
              </Box>
              {nowCons !== undefined &&
                nowCons !== cons &&
                nowIs(`C${nowCons}`)}
              <Box component="span">
                {t('teamOpt.kqm.erShort', 'ER')} {er}%
              </Box>
              {nowKqm && nowEr !== er && nowIs(`${nowEr}%`)}
            </Box>
          </Tooltip>
        )
      })}
      <Box component="span" sx={item}>
        {t('teamOpt.kqm.ruleTalentsLevel', {
          defaultValue: 'Talents {{level}}/{{level}}/{{level}}',
          level: kqmTalentLevel(kqm),
        })}
        {nowKqm &&
          kqmTalentLevel(nowKqm) !== kqmTalentLevel(kqm) &&
          nowIs(
            `${kqmTalentLevel(nowKqm)}/${kqmTalentLevel(nowKqm)}/${kqmTalentLevel(nowKqm)}`
          )}
      </Box>
      <Box component="span" sx={item}>
        {t('teamOpt.kqm.weaponsCount', {
          defaultValue: '{{count}} weapons',
          count: counts.weapons.allowed,
        })}
        {nowCounts &&
          JSON.stringify(nowKqm?.excludedWeapons) !==
            JSON.stringify(kqm.excludedWeapons) &&
          nowIs(nowCounts.weapons.allowed)}
      </Box>
      <Box component="span" sx={item}>
        {t('teamOpt.kqm.setsCount', {
          defaultValue: '{{count}} artifact sets',
          count: counts.sets.allowed,
        })}
        {nowCounts &&
          JSON.stringify(nowKqm?.excludedSets) !==
            JSON.stringify(kqm.excludedSets) &&
          nowIs(nowCounts.sets.allowed)}
      </Box>
      {(fromCalculator ||
        (nowKqm && nowKqm.energySource !== kqm.energySource)) && (
        <Box component="span" sx={item}>
          {fromCalculator
            ? t('teamOpt.kqm.erFromCalc', 'ER from the calculator')
            : t('teamOpt.kqm.erManual', 'ER entered')}
          {nowKqm &&
            nowKqm.energySource !== kqm.energySource &&
            nowIs(
              nowKqm.energySource === 'calculator'
                ? t('teamOpt.kqm.erCalcShort', 'calculator')
                : t('teamOpt.kqm.erManualShort', 'entered')
            )}
        </Box>
      )}
      {rotation === 'played' && (
        <Tooltip
          arrow
          title={t(
            'teamOpt.kqm.rotationPlayedTip',
            'The written rotation played for these builds: at these constellations, with their weapons and artifact sets, 4 rotations in a row with the last 2 averaged, at the pace it can keep.'
          )}
        >
          <Box component="span" sx={item}>
            {t('teamOpt.kqm.rotationAtKqm', 'Rotation played for these builds')}
          </Box>
        </Tooltip>
      )}
      {!!stalls?.length && (
        <Tooltip
          arrow
          title={
            <Box>
              {t(
                'teamOpt.kqm.stallsTip',
                'Played several times in a row, the rotation reaches these before they are ready again, and waits each time (its time and DPS include the wait). Write them with a ? to use them only when ready ("Sucrose N1 E? D"), or use something else there (a Charged Attack).'
              )}
              {stalls.map(({ label, seconds }) => (
                <Box key={label} sx={{ mt: 0.5, ...numSx }}>
                  {stallLabel(label)}: {seconds.toFixed(1)} s
                </Box>
              ))}
            </Box>
          }
        >
          <Box
            component="span"
            sx={{ ...item, color: 'warning.main', cursor: 'help' }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />
            {t('teamOpt.kqm.stalls', {
              defaultValue: 'Waits {{seconds}} s per rotation',
              seconds: stalls.reduce((n, s) => n + s.seconds, 0).toFixed(1),
            })}
            {' · '}
            {stallLabel(stalls[0].label)}
          </Box>
        </Tooltip>
      )}
      {rotationChanged && (
        <Box component="span" sx={{ ...item, color: tokens.gold }}>
          {t('teamOpt.kqm.rotationChanged', 'Rotation changed')}
        </Box>
      )}
    </Box>
  )
}

/** A wait's label: `<member> <action>` (the member's name, then the action) or `swap <member>` */
function StallLabel({ label }: { label: string }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [first, ...rest] = label.split(' ')
  const swap = first === 'swap'
  const characterKey = (swap ? rest[0] : first) as CharacterKey
  return (
    <>
      {swap && `${t('teamOpt.kqm.stallSwap', 'swap to')} `}
      <CharacterName characterKey={characterKey} gender={gender} />
      {!swap && ` ${rest.join(' ')}`}
    </>
  )
}
const stallLabel = (label: string) => <StallLabel label={label} />

/** A member's KQM constellation: the standard one (marked) or any other, C0–C6 */
function KqmConstellationSelect({
  value,
  standard,
  disabled,
  characterKey,
  onChange,
}: {
  value: number
  standard: number
  disabled?: boolean
  characterKey: CharacterKey
  onChange: (value: number) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Select
      size="small"
      fullWidth
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      inputProps={{
        'aria-label': t('teamOpt.kqm.consLabel', {
          defaultValue: '{{character}} constellation',
          character: characterKey,
        }),
      }}
      renderValue={(v) => `C${v}`}
      MenuProps={{ PaperProps: { sx: { minWidth: 180 } } }}
      sx={(theme) => ({
        ...compactFieldSx,
        // (another constellation than the standard one: an edited value)
        ...(value !== standard && {
          color: 'primary.main',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(theme.palette.primary.main, 0.6),
          },
        }),
      })}
    >
      {[0, 1, 2, 3, 4, 5, 6].map((c) => (
        <MenuItem key={c} value={c} sx={numSx}>
          C{c}
          {c === standard && (
            <Box component="span" sx={{ ...type.label, ml: 'auto', pl: 2 }}>
              {t('teamOpt.kqm.consStandard', 'KQM standard')}
            </Box>
          )}
        </MenuItem>
      ))}
    </Select>
  )
}

const compactCount = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * A KQM run's progress in the run bar: the round, the member and what is being searched for it
 * (weapons, then artifacts), then the rankings; the members done; the estimated progress line
 */
export function KqmProgress({
  teamId,
  members,
  startTime,
}: {
  teamId: string
  members: CharacterKey[]
  startTime: number
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const step = useKqmProgress(teamId)
  const [, rerender] = useState(0)
  // the elapsed time ticks on its own
  useInterval(() => rerender((n) => n + 1), 1000)
  const seconds = Math.round((performance.now() - startTime) / 1000)
  const percent = Math.round((step?.progress ?? 0) * 100)
  const ranking = step?.phase === 'ranking'
  const at = step ? members.indexOf(step.characterKey) : -1
  const memberState = (i: number) =>
    !step
      ? 'pending'
      : ranking
        ? i < step.step
          ? 'done'
          : 'pending'
        : i < at
          ? 'done'
          : i === at
            ? 'current'
            : 'pending'
  const counts =
    step?.total !== undefined && step.total > 0
      ? ` ${Math.min(step.done ?? 0, step.total)}/${step.total}`
      : ''
  const what = !step
    ? t('teamOpt.kqm.progress.start', 'Building the team')
    : ranking
      ? `${t('teamOpt.kqm.progress.ranking', 'Ranking sets and weapons')}${counts}`
      : step.stage === 'artifacts'
        ? `${t('teamOpt.kqm.progress.artifacts', 'searching artifacts')}${counts}`
        : `${t('teamOpt.kqm.progress.weapons', 'trying weapons')}${counts}`
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          minWidth: 0,
          flexGrow: 1,
        }}
        role="status"
        aria-live="polite"
      >
        <Box
          sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5, flexShrink: 0 }}
          aria-hidden
        >
          {members.map((ck, i) => {
            const state = memberState(i)
            return (
              <Box
                key={ck}
                sx={{
                  display: 'flex',
                  borderRadius: '50%',
                  opacity: state === 'pending' ? 0.4 : 1,
                  boxShadow:
                    state === 'current' ? `0 0 0 2px ${tokens.gold}` : 'none',
                  transition: 'opacity .2s, box-shadow .2s',
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                  },
                }}
              >
                <MemberAvatar characterKey={ck} size={26} />
              </Box>
            )
          })}
        </Box>
        {step && !ranking && (
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}>
            <MemberAvatar characterKey={step.characterKey} size={24} />
          </Box>
        )}
        <Typography noWrap sx={{ ...type.body, ...numSx, minWidth: 0 }}>
          {step && !ranking && (
            <>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {t('teamOpt.kqm.progress.round', {
                  defaultValue: 'Round {{round}}',
                  round: step.round,
                })}
                {' · '}
                <CharacterName
                  characterKey={step.characterKey}
                  gender={gender}
                />
              </Box>
              {' · '}
            </>
          )}
          <Box
            component="span"
            sx={{ fontWeight: ranking || !step ? 600 : 400 }}
          >
            {what}
          </Box>
        </Typography>
        <Tooltip
          title={t('teamOpt.kqm.progress.tried', {
            defaultValue: '{{count}} builds tried',
            count: step?.tried ?? 0,
          })}
        >
          <Box
            component="span"
            sx={{
              ...type.label,
              ...numSx,
              flexShrink: 0,
              ml: 'auto',
              pl: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {percent}%
            <Box
              component="span"
              sx={{ display: { xs: 'none', md: 'inline' } }}
            >
              {' · '}
              {t('teamOpt.kqm.progress.builds', {
                defaultValue: '{{n}} builds',
                n: compactCount.format(step?.tried ?? 0),
                count: step?.tried ?? 0,
              })}
            </Box>
            {' · '}
            {seconds} s
          </Box>
        </Tooltip>
      </Box>
      <LinearProgress
        aria-hidden
        variant="determinate"
        value={percent}
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          bgcolor: 'transparent',
        }}
      />
    </>
  )
}

function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const timer = setInterval(() => ref.current(), ms)
    return () => clearInterval(timer)
  }, [ms])
}

/** A compact team overview; the selected member is explored in a single inspector. */
/** A member's constellation as a pill: gold from C1, quiet at C0 */
function ConstellationPill({ value }: { value: number }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        px: 0.75,
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        ...numSx,
        ...(value > 0
          ? {
              color: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.5)}`,
            }
          : {
              color: 'text.secondary',
              bgcolor: alpha(theme.palette.text.primary, 0.07),
            }),
      })}
    >
      C{value}
    </Box>
  )
}

export function KqmResults({
  teamId,
  runSettings,
  members,
  result,
  seconds,
  rotationTime,
  stale,
  now,
  setup,
  rotation,
  stalls,
  running,
  onDiscard,
}: {
  teamId: string
  runSettings: TeamOpt
  /** The setup as it is now (what changed since the run is shown) */
  now?: TeamOpt
  /** The setup as it was set for the run (`runSettings` has the rotation it played) */
  setup?: TeamOpt
  /** The rotation's attacks: the written rotation as KQM played it, or the attacks entered */
  rotation?: 'played' | 'entered'
  /** What each rotation waited for to be ready, played as KQM plays it */
  stalls?: { label: string; seconds: number }[]
  members: TeamOptMember[]
  result: KqmResult
  seconds: number
  rotationTime?: number
  stale?: boolean
  running?: boolean
  onDiscard: () => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [shown, setShown] = useState<CharacterKey | undefined>(
    result.optimized[0]
  )
  const compared =
    shown && result.optimized.includes(shown) ? shown : result.optimized[0]
  // other equipment picked in the inspector: the team as it plays with it (the figures above follow)
  const [comparing, setComparing] = useState<KqmResult>()
  // (a new run starts from its own builds)
  useEffect(() => setComparing(undefined), [result])
  const view = comparing ?? result
  // a top team picked: its member's equipment, as picked in the inspector (the others the run's)
  const [picked, setPicked] = useState(0)
  const pickTeam = (option: KqmTeamOption) => {
    setKqmPicks(
      result,
      option.changed ? { [option.changed]: option.builds[option.changed]! } : {}
    )
    setComparing(undefined)
    if (option.changed) setShown(option.changed)
    // (the inspector reads the picks when it opens: open it again)
    setPicked((n) => n + 1)
  }
  const unit = rotationTime
    ? t('teamOpt.kqm.dpsUnit', 'DPS')
    : t('teamOpt.kqm.dmgUnit', 'DMG')
  return (
    <Box
      id={`kqm-results-${teamId}`}
      sx={{
        p: { xs: 1, sm: 2 },
        scrollMarginTop: 88,
        containerType: 'inline-size',
      }}
    >
      {/* the team's result, and what to do with it */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1.5,
          flexWrap: 'wrap',
          mb: 2,
        }}
      >
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <Typography component="h2" sx={type.section}>
            {t('teamOpt.kqm.teamBuilds', 'Team builds')}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              columnGap: 1,
              rowGap: 0.25,
              mt: 0.5,
              flexWrap: 'wrap',
            }}
          >
            <Typography sx={type.figure}>
              {formatRate(view.after.total, rotationTime, true)}
            </Typography>
            <Typography sx={type.label}>
              {rotationTime
                ? t('teamOpt.kqm.teamDps', 'team DPS')
                : t('teamOpt.kqm.teamDmg', 'team DMG')}
            </Typography>
            {comparing && (
              <Tooltip
                arrow
                title={t('teamOpt.kqm.vsBestTip', {
                  defaultValue: 'The run’s best builds: {{total}}',
                  total: formatRate(result.after.total, rotationTime, true),
                })}
              >
                <Typography
                  sx={{
                    ...type.label,
                    ...numSx,
                    cursor: 'help',
                    color:
                      comparing.after.total >= result.after.total
                        ? 'success.main'
                        : 'text.secondary',
                  }}
                >
                  {t('teamOpt.kqm.vsBest', {
                    defaultValue: '{{diff}} vs best',
                    diff: `${comparing.after.total >= result.after.total ? '+' : '−'}${Math.abs((comparing.after.total / result.after.total - 1) * 100).toFixed(1)}%`,
                  })}
                </Typography>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            ml: 'auto',
          }}
        >
          <Tooltip arrow title={t('teamOpt.result.discard', 'Discard')}>
            <span>
              <IconButton
                size="small"
                disabled={running}
                onClick={onDiscard}
                aria-label={t('teamOpt.result.discard', 'Discard')}
                sx={{ ...quickSx, ...focusSx }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
      {/* what these builds were run with; what has changed since (→ now) */}
      <Box
        sx={{
          ...insetSx,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.75,
          px: 1.5,
          py: 1,
          mt: -0.5,
          mb: 2,
        }}
      >
        <FieldLabel
          tip={t(
            'teamOpt.kqm.runWithTip',
            'The setup these builds were made with. A value after → is what it is now: run again to use it.'
          )}
        >
          {t('teamOpt.kqm.runWith', 'Run with')}
        </FieldLabel>
        <KqmSetupSummary
          members={members}
          settings={setup ?? runSettings}
          now={stale ? now : undefined}
          rotation={rotation}
          stalls={stalls}
          sx={{ flex: '1 1 auto' }}
        />
        {stale && (
          <Box
            role="status"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: 13,
              color: 'warning.main',
              ml: 'auto',
            }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
            {t(
              'teamOpt.kqm.staleShort',
              'Setup changed. Run again to refresh.'
            )}
          </Box>
        )}
      </Box>
      {/* one tile per member: pick whose build to inspect */}
      <Box
        role="tablist"
        aria-label={t('teamOpt.kqm.teamBuilds', 'Team builds')}
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
          },
          gap: 1,
          mb: 2,
        }}
      >
        {members.map(({ characterKey }) => {
          // (with the equipment picked in the inspector, when it is not the run's)
          const build = view.builds[characterKey]
          const er = view.energyRecharge[characterKey]
          const selected = compared === characterKey
          return (
            <ButtonBase
              key={characterKey}
              role="tab"
              aria-selected={selected}
              aria-label={characterKey}
              disabled={!build || running}
              onClick={() => setShown(characterKey)}
              sx={(theme) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                textAlign: 'left',
                gap: 1,
                p: { xs: 1.25, sm: 1.5 },
                borderRadius: tokens.radius.inset,
                minWidth: 0,
                border: `1px solid ${selected ? 'transparent' : tokens.hairlineStrong}`,
                ...(selected && selectedSx(theme)),
                ...quickSx,
                ...focusSx,
                '&:hover': {
                  bgcolor: selected
                    ? alpha(theme.palette.primary.main, 0.14)
                    : alpha(theme.palette.text.primary, 0.035),
                },
                '&.Mui-disabled': { opacity: build ? 0.6 : 0.5 },
              })}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  columnGap: 1,
                  rowGap: 0.75,
                  minWidth: 0,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={32} />
                <Box sx={{ minWidth: 0, flex: '1 1 0' }}>
                  <Typography
                    noWrap
                    sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}
                  >
                    <CharacterName
                      characterKey={characterKey}
                      gender={gender}
                    />
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      mt: 0.25,
                    }}
                  >
                    <ConstellationPill
                      value={result.constellations[characterKey] ?? 0}
                    />
                    {!build && (
                      <Typography
                        sx={{ ...type.label, fontSize: 12, lineHeight: 1.4 }}
                      >
                        {t('teamOpt.result.kept', 'Kept')}
                      </Typography>
                    )}
                  </Box>
                </Box>
                {build && (
                  <Box sx={{ ml: 'auto' }}>
                    <KqmGearIcons characterKey={characterKey} build={build} />
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  columnGap: 0.75,
                }}
              >
                <Typography sx={{ ...type.stat, fontSize: { xs: 16, sm: 18 } }}>
                  {formatRate(
                    view.after.members[characterKey],
                    rotationTime,
                    true
                  )}
                  <Box
                    component="span"
                    sx={{
                      display: { xs: 'none', sm: 'inline' },
                      ml: 0.5,
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'text.secondary',
                    }}
                  >
                    {unit}
                  </Box>
                </Typography>
                {er && (
                  <Typography
                    sx={{
                      fontSize: 12,
                      ...numSx,
                      color:
                        er.value + 1e-6 < er.minimum
                          ? 'warning.main'
                          : 'text.secondary',
                    }}
                  >
                    ER {er.value.toFixed(0)}%
                  </Typography>
                )}
              </Box>
              {/* where its substat rolls went (fixed + distributed) */}
              {build && <KqmRollLine build={build} />}
            </ButtonBase>
          )
        })}
      </Box>
      <KqmTopTeams
        result={result}
        view={view}
        rotationTime={rotationTime}
        disabled={stale || running}
        onPick={pickTeam}
      />
      {compared && (
        <KqmCompare
          key={`${compared}-${seconds}-${picked}`}
          teamId={teamId}
          runSettings={runSettings}
          disabled={stale || running}
          result={result}
          characterKey={compared}
          rotationTime={rotationTime}
          base={comparing}
          onView={setComparing}
        />
      )}
    </Box>
  )
}
