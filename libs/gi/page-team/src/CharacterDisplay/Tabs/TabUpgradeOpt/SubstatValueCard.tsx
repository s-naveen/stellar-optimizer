import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import { SolidToggleButtonGroup } from '@genshin-optimizer/common/ui'
import { getUnitStr, objMap, toPercent } from '@genshin-optimizer/common/util'
import type {
  ArtifactRarity,
  ArtifactSlotKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import type {
  MainStatPiece,
  MainStatValueResult,
  RollSize,
  SubstatGain,
  SubstatValueResult,
} from '@genshin-optimizer/gi/ui'
import {
  computeMainStatValue,
  computeSubstatValue,
  DataContext,
  getTeamDataCalc,
  StatWithUnit,
  statName,
} from '@genshin-optimizer/gi/ui'
import { artDisplayValue } from '@genshin-optimizer/gi/util'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import {
  alpha,
  Box,
  IconButton,
  Skeleton,
  ToggleButton,
  Typography,
} from '@mui/material'
import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../TabOptimize/Components/SettingsCard'

const ROLL_CHOICES = [1, 2, 5, 10] as const

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 3,
})
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
/** +4.9K / +962 / +0.4 */
function signed(n: number) {
  const s =
    Math.abs(n) < 10_000
      ? plain.format(Math.abs(n))
      : compact.format(Math.abs(n))
  return `${n < 0 ? '−' : '+'}${s}`
}

type Mode = 'sub' | 'main'

const NO_PICKS: Partial<Record<SubstatKey, number>> = {}

/**
 * The stat values of the member's current build (see `computeSubstatValue` and
 * `computeMainStatValue`), recomputed a moment after the build or the target changes; the
 * previous result stays meanwhile, so lists do not flicker. `result` is `undefined` until first
 * computed and `null` when there is nothing to show.
 */
export function useStatValues({
  rollsAll = 1,
  rollsByKey = NO_PICKS,
  rarity = 5,
  rollSize = 'mid',
  pieces: piecesProp,
  delay = 120,
}: {
  rollsAll?: number
  rollsByKey?: Partial<Record<SubstatKey, number>>
  rarity?: ArtifactRarity
  rollSize?: RollSize
  pieces?: Partial<Record<ArtifactSlotKey, MainStatPiece>>
  /** How long the build must stay the same before computing (ms) */
  delay?: number
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const {
    teamId,
    teamCharId,
    teamChar: { key: characterKey, optConfigId },
    loadoutDatum,
  } = useContext(TeamCharacterContext)
  const { optimizationTarget } = useOptConfig(optConfigId) ?? {}
  // The displayed build's data: when it changes, so do the values
  const dataContext = useContext(DataContext)
  const [result, setResult] = useState<{
    sub: SubstatValueResult | undefined
    main: MainStatValueResult | undefined
  } | null>()
  useEffect(() => {
    if (!optimizationTarget || !dataContext) {
      setResult(null)
      return
    }
    // Settle first (editing a theorycraft build changes it on every keystroke); the previous
    // result stays up meanwhile, so the list does not flicker
    const id = setTimeout(() => {
      const pieces =
        piecesProp ??
        objMap(
          database.teams.getLoadoutArtifacts(loadoutDatum),
          (art) =>
            art && {
              statKey: art.mainStatKey,
              rarity: art.rarity,
              level: art.level,
            }
        )
      // each computation folds the build into its own copy of the team data
      const teamData = () =>
        getTeamDataCalc(database, teamId, gender, teamCharId)
      const subData = teamData()
      const sub =
        subData &&
        computeSubstatValue(
          subData,
          characterKey,
          optimizationTarget,
          rollsAll,
          rarity,
          rollSize,
          rollsByKey
        )
      const mainData = teamData()
      const main =
        mainData &&
        computeMainStatValue(mainData, characterKey, optimizationTarget, pieces)
      setResult(sub || main ? { sub, main } : null)
    }, delay)
    return () => clearTimeout(id)
  }, [
    database,
    teamId,
    gender,
    teamCharId,
    characterKey,
    loadoutDatum,
    optimizationTarget,
    rollsAll,
    rollsByKey,
    rarity,
    rollSize,
    piecesProp,
    dataContext,
    delay,
  ])
  return { result, optimizationTarget }
}

/**
 * Which stats raise the optimization target the most, exactly (the target formula is evaluated
 * with the stats changed), on top of the current build (a real or theorycraft build):
 * - Substats: the gain from a few extra rolls of each.
 * - Main stats: each sands / goblet / circlet main stat at 5★ +20 in place of the current one.
 * Recomputed when the build or the target changes.
 */
export function SubstatValueCard({
  rarity = 5,
  rollSize = 'mid',
  pieces: piecesProp,
}: {
  /** Rarity of the rolls (the theorycraft build's substat rarity) */
  rarity?: ArtifactRarity
  /** Size of one roll (the theorycraft build's roll size; on real builds an average roll) */
  rollSize?: RollSize
  /** The build's main stats (a theorycraft build's slots); by default the loadout's artifacts */
  pieces?: Partial<Record<ArtifactSlotKey, MainStatPiece>>
}) {
  const { t } = useTranslation('page_character_optimize')
  const [mode, setMode] = useState<Mode>('sub')
  /** Extra rolls of every substat, unless picked per substat */
  const [rollsAll, setRollsAll] = useState<number>(1)
  const [rollsByKey, setRollsByKey] =
    useState<Partial<Record<SubstatKey, number>>>(NO_PICKS)
  const { result, optimizationTarget } = useStatValues({
    rollsAll,
    rollsByKey,
    rarity,
    rollSize,
    pieces: piecesProp,
  })

  return (
    <SettingsCard
      title={t('statValue.title', 'Stat value')}
      info={t(
        'statValue.info',
        'The exact gain of the optimization target from better stats on this build: a few more rolls of each substat, or another main stat on sands, goblet and circlet. Use it to pick what to farm, level, roll or reshape.'
      )}
      action={
        <SolidToggleButtonGroup
          quiet
          exclusive
          size="small"
          value={mode}
          onChange={(_, v: Mode | null) => v && setMode(v)}
          aria-label={t('statValue.mode', 'Stats to compare')}
        >
          <ToggleButton value="sub">
            {t('statValue.substats', 'Substats')}
          </ToggleButton>
          <ToggleButton value="main">
            {t('statValue.mainStats', 'Main stats')}
          </ToggleButton>
        </SolidToggleButtonGroup>
      }
    >
      {result === null ? (
        <Typography variant="body2" color="text.secondary">
          {optimizationTarget
            ? t(
                'substatValue.unavailable',
                'Substat value is not available for this target.'
              )
            : t(
                'substatValue.noTarget',
                'Choose an optimization target to see which substats raise it the most.'
              )}
        </Typography>
      ) : result === undefined ? (
        <Skeleton variant="rounded" height={160} />
      ) : mode === 'main' ? (
        result.main && <MainStatList result={result.main} />
      ) : (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 1,
              mt: -0.5,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('substatValue.rollsAll', 'Extra rolls, all substats')}
            </Typography>
            <SolidToggleButtonGroup
              quiet
              exclusive
              size="small"
              value={rollsAll}
              onChange={(_, v: number | null) => {
                if (!v) return
                setRollsAll(v)
                setRollsByKey({})
              }}
              aria-label={t('substatValue.rolls', 'Extra rolls')}
            >
              {ROLL_CHOICES.map((n) => (
                <ToggleButton key={n} value={n}>
                  +{n}
                </ToggleButton>
              ))}
            </SolidToggleButtonGroup>
          </Box>
          {result.sub && (
            <GainList
              result={result.sub}
              rollsAll={rollsAll}
              rarity={rarity}
              rollSize={rollSize}
              onSetRolls={(key, n) =>
                setRollsByKey((picked) => ({
                  ...picked,
                  [key]: Math.min(30, Math.max(1, n)),
                }))
              }
            />
          )}
        </>
      )}
    </SettingsCard>
  )
}

/** +2.31% / −0.40% */
function pct(share: number) {
  return `${share >= 0 ? '+' : '−'}${Math.abs(share).toFixed(2)}%`
}

/** The table's columns: substat, rolls, bar, total, next roll (the bar goes under the name when narrow) */
const gainRowSx = {
  display: 'grid',
  gridTemplateColumns:
    'minmax(8.5rem, 1.4fr) auto minmax(2.5rem, 1fr) 4.75rem 4.75rem',
  alignItems: 'center',
  columnGap: 1.25,
  '@container (max-width: 460px)': {
    gridTemplateColumns: 'minmax(0, 1fr) auto 4.75rem 4.75rem',
    '& .sv-bar': { gridColumn: '1 / -1', gridRow: 2, mt: 0.5 },
  },
} as const

/**
 * The substats: for each, the rolls picked (all the same, or set per row), what they add in total,
 * and what one more roll adds after them, with the best of each called out. The order is the value
 * of a single roll, so rows stay put while their rolls change.
 */
function GainList({
  result: { base, gains, unused },
  rollsAll,
  rarity,
  rollSize,
  onSetRolls,
}: {
  result: SubstatValueResult
  rollsAll: number
  rarity: ArtifactRarity
  rollSize: RollSize
  onSetRolls: (key: SubstatKey, rolls: number) => void
}) {
  const { t } = useTranslation('page_character_optimize')
  const totalShare = (g: SubstatGain) => (base > 0 ? (g.gain / base) * 100 : 0)
  // vs the target at that point, after the picked rolls
  const nextShare = (g: SubstatGain) =>
    base + g.gain > 0 ? (g.next / (base + g.gain)) * 100 : 0
  const bestBy = (score: (g: SubstatGain) => number) =>
    gains
      .filter((g) => score(g) > 0)
      .reduce<SubstatGain | undefined>(
        (best, g) => (!best || score(g) > score(best) ? g : best),
        undefined
      )
  const bestTotal = bestBy((g) => g.gain)
  const bestNext = bestBy(nextShare)
  const top = Math.max(0, ...gains.map((g) => g.gain))
  const noGain = (key: SubstatKey) =>
    key === 'critRate_'
      ? t('substatValue.capped', 'capped')
      : t('substatValue.noGain', 'No gain')
  const sizeName = {
    max: t('substatValue.size.max', 'max'),
    mid: t('substatValue.size.mid', 'average'),
    min: t('substatValue.size.min', 'min'),
  }[rollSize]
  return (
    <Box
      // exact numbers, for tests and tools (the text is rounded)
      data-substat-value-base={base}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      {(bestNext || bestTotal) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {bestNext && (
            <BestChip
              label={t('substatValue.bestNext', 'Best next roll')}
              statKey={bestNext.key}
              detail={`#${bestNext.rolls + 1}`}
              value={pct(nextShare(bestNext))}
            />
          )}
          {bestTotal && (
            <BestChip
              label={t('substatValue.bestTotal', 'Best total')}
              statKey={bestTotal.key}
              detail={`+${bestTotal.rolls}`}
              value={pct(totalShare(bestTotal))}
            />
          )}
        </Box>
      )}
      {gains.length ? (
        <Box sx={{ containerType: 'inline-size' }}>
          <Box
            aria-hidden
            sx={{
              ...gainRowSx,
              px: 1,
              pb: 0.5,
              color: 'text.secondary',
              fontSize: '0.75rem',
              '& > :nth-of-type(n+4)': { textAlign: 'right' },
              '@container (max-width: 460px)': {
                ...gainRowSx['@container (max-width: 460px)'],
                '& .sv-bar': { display: 'none' },
              },
            }}
          >
            <span>{t('substatValue.colStat', 'Substat')}</span>
            <span>{t('substatValue.colRolls', 'Rolls')}</span>
            <span className="sv-bar" />
            <span>{t('substatValue.colTotal', 'Total')}</span>
            <span
              title={t(
                'substatValue.colNextHint',
                'What one more roll adds after the rolls picked, as a share of the target at that point'
              )}
            >
              {t('substatValue.colNext', 'Next roll')}
            </span>
          </Box>
          <Box
            component="ol"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.5 }}
          >
            {gains.map((g) => {
              const { key, added, gain, next, rolls } = g
              const unit = getUnitStr(key)
              const isBestTotal = bestTotal?.key === key
              const isBestNext = bestNext?.key === key
              return (
                <Box
                  component="li"
                  key={key}
                  data-stat={key}
                  data-rolls={rolls}
                  data-gain={gain}
                  data-next={next}
                  sx={(theme) => ({
                    ...gainRowSx,
                    px: 1,
                    py: 0.75,
                    borderRadius: 1.5,
                    opacity: gain > 0 || next > 0 ? 1 : 0.55,
                    ...(isBestTotal && {
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`,
                    }),
                  })}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      component="div"
                      noWrap
                      sx={{ fontWeight: isBestTotal ? 600 : 500 }}
                    >
                      <StatWithUnit statKey={key} />
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      component="div"
                    >
                      {t('substatValue.perRoll', {
                        defaultValue: '+{{value}} total',
                        value: `${artDisplayValue(toPercent(added, key), unit)}${unit}`,
                      })}
                    </Typography>
                  </Box>
                  <RollStepper
                    rolls={rolls}
                    custom={rolls !== rollsAll}
                    onChange={(n) => onSetRolls(key, n)}
                  />
                  <Box
                    className="sv-bar"
                    sx={(theme) => ({
                      height: 6,
                      borderRadius: 3,
                      overflow: 'hidden',
                      bgcolor: alpha(theme.palette.text.primary, 0.08),
                    })}
                  >
                    <Box
                      sx={(theme) => ({
                        height: '100%',
                        width: `${top > 0 ? (Math.max(0, gain) / top) * 100 : 0}%`,
                        borderRadius: 3,
                        bgcolor: isBestTotal
                          ? theme.palette.primary.main
                          : alpha(theme.palette.primary.main, 0.5),
                        transition: 'width 200ms ease',
                      })}
                    />
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: isBestTotal ? 'primary.light' : 'text.primary',
                      }}
                    >
                      {gain > 0 ? pct(totalShare(g)) : noGain(key)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {gain > 0 ? signed(gain) : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: isBestNext ? 600 : 500,
                        fontVariantNumeric: 'tabular-nums',
                        color: isBestNext ? 'primary.light' : 'text.primary',
                      }}
                    >
                      {next > 0 ? pct(nextShare(g)) : noGain(key)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      #{rolls + 1}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t(
            'substatValue.noScaling',
            'This target does not depend on any substat.'
          )}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {t('substatValue.captionRolls', {
          defaultValue:
            '{{size}} {{rarity}}★ rolls on top of this build (target now {{base}}); set the rolls per substat with − and +.',
          size: sizeName.charAt(0).toUpperCase() + sizeName.slice(1),
          rarity,
          base: plain.format(base),
        })}
        {!!unused.length && (
          <>
            {' '}
            {t('substatValue.unused', 'Not used by this target:')}{' '}
            {unused.map((k) => `${statName(k)}${getUnitStr(k)}`).join(' · ')}
          </>
        )}
      </Typography>
    </Box>
  )
}

/** "Best next roll: Crit DMG #3 +2.10%" */
function BestChip({
  label,
  statKey,
  detail,
  value,
}: {
  label: string
  statKey: SubstatKey
  detail: string
  value: string
}) {
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.1),
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.3)}`,
      })}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
        {statName(statKey)}
        {getUnitStr(statKey)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {detail}
      </Typography>
      <Typography
        variant="body2"
        component="span"
        sx={{
          fontWeight: 600,
          color: 'primary.light',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

/** − +3 +, quiet; highlighted when the row's rolls differ from the "all substats" choice */
function RollStepper({
  rolls,
  custom,
  onChange,
}: {
  rolls: number
  custom: boolean
  onChange: (rolls: number) => void
}) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 28,
        borderRadius: 2,
        border: `1px solid ${alpha(custom ? theme.palette.primary.main : theme.palette.text.primary, custom ? 0.55 : 0.14)}`,
      })}
    >
      <IconButton
        size="small"
        sx={{ p: 0.25 }}
        disabled={rolls <= 1}
        onClick={() => onChange(rolls - 1)}
        aria-label={t('substatValue.fewer', 'Fewer rolls')}
      >
        <RemoveIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Typography
        variant="body2"
        sx={{
          minWidth: '2.4em',
          textAlign: 'center',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: custom ? 'primary.light' : 'text.primary',
        }}
      >
        +{rolls}
      </Typography>
      <IconButton
        size="small"
        sx={{ p: 0.25 }}
        disabled={rolls >= 30}
        onClick={() => onChange(rolls + 1)}
        aria-label={t('substatValue.more', 'More rolls')}
      >
        <AddIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  )
}

/**
 * Sands, goblet and circlet side by side: the best main stats for the target (and the current
 * one), as the change of the target with each at 5★ +20 in place of the current piece's.
 */
function MainStatList({
  result: { base, slots },
}: {
  result: MainStatValueResult
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifact'])
  return (
    <Box
      data-main-stat-value-base={base}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        }}
      >
        {slots.map(({ slotKey, current, options }) => {
          const shown = options.slice(0, 3)
          const now = options.find((o) => o.current)
          if (now && !shown.includes(now)) shown.push(now)
          return (
            <Box key={slotKey} data-slot={slotKey}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  mb: 0.5,
                }}
              >
                <SlotIcon slotKey={slotKey} iconProps={iconInlineProps} />
                {t(`artifact:slotName.${slotKey}`)}
                {!current && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                  >
                    {t('statValue.emptySlot', '(empty)')}
                  </Typography>
                )}
              </Typography>
              {shown.map((option) => {
                // the piece's current main stat is outlined; the list is already best first
                const current = !!option.current
                const share = base > 0 ? (option.gain / base) * 100 : Number.NaN
                const unchanged = Math.abs(share) < 0.005
                return (
                  <Box
                    key={option.key}
                    data-stat={option.key}
                    data-gain={option.gain}
                    sx={(theme) => ({
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 1,
                      px: 1,
                      py: 0.5,
                      borderRadius: 1.5,
                      ...(current && {
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`,
                      }),
                    })}
                  >
                    <Typography
                      variant="body2"
                      component="span"
                      noWrap
                      sx={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        fontWeight: current ? 600 : 500,
                      }}
                    >
                      <StatWithUnit statKey={option.key} />
                    </Typography>
                    {option.current && (
                      <Typography variant="caption" color="text.secondary">
                        {t('statValue.current', 'current')}
                      </Typography>
                    )}
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color:
                          !unchanged && option.gain > 0
                            ? 'text.primary'
                            : 'text.secondary',
                      }}
                    >
                      {unchanged || !Number.isFinite(share)
                        ? '±0%'
                        : `${share > 0 ? '+' : '−'}${Math.abs(share).toFixed(2)}%`}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
