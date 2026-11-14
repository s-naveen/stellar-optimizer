import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allMainStatKeys,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  ArtifactCardNano,
  ArtifactSetAutocomplete,
  ExcludeIcon,
  statName,
} from '@genshin-optimizer/gi/ui'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DialogHead,
  floatSx,
  stackedBackdrop,
  TileAction,
  tileSx,
} from './OptionTile'
import { EmptyLine, numSx, quickSx, Segmented, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * The artifacts this team's optimization leaves out, as one list: the ones excluded here (from a
 * result) and the ones excluded in a member's own Optimize tab. A tile with their count opens it;
 * each can be put back.
 */
export function ExcludedArtsTile({
  members,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const [show, onOpen, onClose] = useBoolState(false)
  const excluded = useMemo(() => {
    const ids = [...teamOpt.excludedArts]
    // (the members' own lists count unless the team was set to use them)
    if (!teamOpt.useExcludedArts)
      for (const m of members)
        ids.push(
          ...(database.optConfigs.get(m.teamChar.optConfigId)?.artExclusion ??
            [])
        )
    // (artifacts that no longer exist are not shown)
    return [...new Set(ids)].filter((id) => database.arts.get(id))
  }, [database, members, teamOpt.excludedArts, teamOpt.useExcludedArts])

  const excludedSet = useMemo(() => new Set(excluded), [excluded])
  const exclude = (id: string) =>
    setTeamOpt((o) => {
      o.excludedArts = [...new Set([...o.excludedArts, id])]
    })

  /** Put it back: off the team's list and the members' lists */
  const putBack = (ids: string[]) => {
    setTeamOpt((o) => {
      o.excludedArts = o.excludedArts.filter((id) => !ids.includes(id))
    })
    for (const m of members) {
      const id = m.teamChar.optConfigId
      const list = database.optConfigs.get(id)?.artExclusion
      if (list?.some((x) => ids.includes(x)))
        database.optConfigs.set(id, {
          artExclusion: list.filter((x) => !ids.includes(x)),
        })
    }
  }

  return (
    <>
      <ButtonBase
        onClick={onOpen}
        disabled={disabled}
        aria-haspopup="dialog"
        sx={[
          tileSx,
          { justifyContent: 'flex-start', opacity: disabled ? 0.55 : 1 },
        ]}
      >
        <Box
          component="span"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {t('teamOpt.pool.excluded', 'Excluded artifacts')}
        </Box>
        {/* the count, and what a click does: it reads as a button */}
        <TileAction as="span" tone={excluded.length ? 'warning' : undefined}>
          {excluded.length ? `${excluded.length} · ` : null}
          {t('teamOpt.pool.edit', 'Edit')}
        </TileAction>
      </ButtonBase>

      <ModalWrapper
        open={show}
        onClose={onClose}
        containerProps={{ maxWidth: 'lg' }}
        slotProps={stackedBackdrop}
      >
        <CardThemed sx={floatSx}>
          <DialogHead
            title={t('teamOpt.pool.excludedTitle', 'Excluded artifacts')}
            info={t(
              'teamOpt.pool.excludedHelp',
              'This team is never optimized with these. Find one below, or press ⊘ on an artifact in a result.'
            )}
            onClose={onClose}
          />
          {show && (
            <ExcludedBody
              excluded={excluded}
              excludedSet={excludedSet}
              putBack={putBack}
              exclude={exclude}
            />
          )}
        </CardThemed>
      </ModalWrapper>
    </>
  )
}

/**
 * The dialog's two views: the excluded artifacts (each can be put back), and finding more (a click
 * excludes one or puts it back). Opens on the list when there is one, else on finding.
 */
function ExcludedBody({
  excluded,
  excludedSet,
  putBack,
  exclude,
}: {
  excluded: string[]
  excludedSet: ReadonlySet<string>
  putBack: (ids: string[]) => void
  exclude: (id: string) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const [view, setView] = useState<'excluded' | 'find'>(() =>
    excluded.length ? 'excluded' : 'find'
  )
  return (
    <Box
      sx={{
        px: { xs: 1.5, sm: 2.5 },
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        // (the title bar stays; the cards scroll)
        maxHeight: { xs: 'calc(100dvh - 90px)', sm: 'calc(100dvh - 140px)' },
        overflowY: 'auto',
        '& > *': { flexShrink: 0 },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Segmented
          aria-label={t('teamOpt.pool.excludedTitle', 'Excluded artifacts')}
          value={view}
          onChange={setView}
          options={[
            {
              value: 'excluded',
              label: (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                  }}
                >
                  {t('teamOpt.pool.excludedView', 'Excluded')}
                  <Box
                    component="span"
                    sx={(theme) => ({
                      minWidth: 20,
                      px: 0.5,
                      borderRadius: 1,
                      fontSize: 12,
                      lineHeight: 1.6,
                      textAlign: 'center',
                      ...numSx,
                      color: excluded.length
                        ? 'warning.main'
                        : 'text.secondary',
                      bgcolor: alpha(
                        excluded.length
                          ? theme.palette.warning.main
                          : theme.palette.text.primary,
                        0.12
                      ),
                    })}
                  >
                    {excluded.length}
                  </Box>
                </Box>
              ),
            },
            {
              value: 'find',
              label: t('teamOpt.pool.findView', 'Find artifacts'),
            },
          ]}
        />
        {view === 'excluded' && excluded.length > 1 && (
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            onClick={() => putBack(excluded)}
            sx={{ ml: 'auto', minHeight: 30, py: 0, color: 'text.secondary' }}
          >
            {t('teamOpt.pool.excludedClear', 'Use all again')}
          </Button>
        )}
      </Box>
      {view === 'excluded' &&
        (excluded.length ? (
          <Box sx={cardGridSx}>
            {excluded.map((id) => (
              <Box
                key={id}
                sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
              >
                <ArtifactCardNano
                  artifactId={id}
                  slotKey={database.arts.get(id)!.slotKey}
                  showLocation
                />
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => putBack([id])}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {t('teamOpt.result.include', 'Use it again')}
                </Button>
              </Box>
            ))}
          </Box>
        ) : (
          <EmptyLine
            sx={{ minHeight: 56 }}
            action={
              <Button
                size="small"
                color="inherit"
                variant="outlined"
                onClick={() => setView('find')}
                sx={{ ml: 1, minHeight: 28, py: 0 }}
              >
                {t('teamOpt.pool.findView', 'Find artifacts')}
              </Button>
            }
          >
            {t('teamOpt.pool.excludedEmpty', 'Nothing is excluded yet.')}
          </EmptyLine>
        ))}
      {view === 'find' && (
        <FindToExclude
          excluded={excludedSet}
          onToggle={(id) => (excludedSet.has(id) ? putBack([id]) : exclude(id))}
        />
      )}
    </Box>
  )
}

/** Text for screen readers only */
const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const
const slotNames: Record<ArtifactSlotKey, string> = {
  flower: 'Flower',
  plume: 'Plume',
  sands: 'Sands',
  goblet: 'Goblet',
  circlet: 'Circlet',
}

/** The artifact cards' grid */
const cardGridSx = {
  display: 'grid',
  gap: 1,
  // (two side by side on phones)
  gridTemplateColumns: {
    xs: 'repeat(2, minmax(0, 1fr))',
    sm: 'repeat(auto-fill, minmax(175px, 1fr))',
  },
} as const

const PAGE = 40

/**
 * Finding artifacts to exclude: a few filters (set, slot, main stat) and small cards; a click
 * excludes one (or puts it back)
 */
function FindToExclude({
  excluded,
  onToggle,
}: {
  excluded: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const arts = useDataManagerValues(database.arts)
  const [setKey, setSetKey] = useState<ArtifactSetKey | ''>('')
  const [slotKey, setSlotKey] = useState<ArtifactSlotKey | ''>('')
  const [mainStat, setMainStat] = useState<MainStatKey | ''>('')
  const [shown, setShown] = useState(PAGE)
  const found = useMemo(
    () =>
      arts
        .filter(
          (a) =>
            (!setKey || a.setKey === setKey) &&
            (!slotKey || a.slotKey === slotKey) &&
            (!mainStat || a.mainStatKey === mainStat)
        )
        .sort((a, b) => b.level - a.level || b.rarity - a.rarity),
    [arts, setKey, slotKey, mainStat]
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          alignItems: 'center',
        }}
      >
        <ArtifactSetAutocomplete
          size="small"
          artSetKey={setKey}
          setArtSetKey={(k) => {
            setSetKey(k)
            setShown(PAGE)
          }}
          sx={{ minWidth: 220, flex: '1 1 220px', maxWidth: { sm: 340 } }}
        />
        <Segmented
          aria-label={t('teamOpt.pool.slot', 'Slot')}
          value={slotKey}
          onChange={(v) => {
            setSlotKey(v)
            setShown(PAGE)
          }}
          options={[
            { value: '' as const, label: t('teamOpt.pool.anySlot', 'All') },
            ...allArtifactSlotKeys.map((k) => ({
              value: k,
              label: (
                <>
                  <SlotIcon slotKey={k} iconProps={{ sx: { fontSize: 18 } }} />
                  <Box component="span" sx={srOnly}>
                    {t(`teamOpt.slot.${k}`, slotNames[k])}
                  </Box>
                </>
              ),
            })),
          ]}
        />
        <TextField
          select
          size="small"
          label={t('teamOpt.pool.mainStat', 'Main stat')}
          value={mainStat}
          onChange={(e) => {
            setMainStat(e.target.value as MainStatKey | '')
            setShown(PAGE)
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">{t('teamOpt.pool.anyMain', 'Any')}</MenuItem>
          {allMainStatKeys.map((k) => (
            <MenuItem key={k} value={k}>
              {statName(k)}
            </MenuItem>
          ))}
        </TextField>
        <Typography
          sx={{
            ...type.label,
            ...numSx,
            ml: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {t('teamOpt.pool.found', {
            defaultValue: '{{count}} artifacts',
            count: found.length,
          })}
          <InfoTooltipInline
            title={t(
              'teamOpt.pool.findHelp',
              'Click an artifact to exclude it; click it again to use it again.'
            )}
          />
        </Typography>
      </Box>
      <Box sx={cardGridSx}>
        {found.slice(0, shown).map((a) => {
          const off = excluded.has(a.id)
          return (
            <Box
              key={a.id}
              sx={(theme) => ({
                position: 'relative',
                borderRadius: '12px',
                // (a ring over the card, inside its edge)
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '12px',
                  pointerEvents: 'none',
                  boxShadow: off
                    ? `inset 0 0 0 2px ${theme.palette.warning.main}`
                    : 'none',
                  ...quickSx,
                },
              })}
            >
              <Box
                sx={{
                  opacity: off ? 0.4 : 1,
                  ...quickSx,
                  transition: 'opacity .12s',
                }}
              >
                <ArtifactCardNano
                  artifactId={a.id}
                  slotKey={a.slotKey}
                  showLocation
                  onClick={() => onToggle(a.id)}
                />
              </Box>
              {off && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    display: 'flex',
                    p: 0.25,
                    borderRadius: '50%',
                    bgcolor: alpha('#000', 0.7),
                    pointerEvents: 'none',
                  }}
                >
                  <ExcludeIcon sx={{ fontSize: 18, color: 'warning.main' }} />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
      {shown < found.length && (
        <Button
          color="inherit"
          variant="outlined"
          onClick={() => setShown((n) => n + PAGE)}
          sx={{ alignSelf: 'center', color: 'text.secondary', ...numSx }}
        >
          {t('teamOpt.pool.showMore', {
            defaultValue: 'Show more ({{count}} left)',
            count: found.length - shown,
          })}
        </Button>
      )}
    </Box>
  )
}
