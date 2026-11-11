import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useBoolState } from '@genshin-optimizer/common/react-util'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
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
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          textAlign: 'left',
          gap: 1,
          minWidth: 0,
          minHeight: 48,
          px: 1.5,
          borderRadius: 2,
          opacity: disabled ? 0.6 : 1,
          border: `1px solid ${
            excluded.length
              ? alpha(theme.palette.warning.main, 0.45)
              : alpha(theme.palette.text.primary, 0.1)
          }`,
          backgroundColor: excluded.length
            ? alpha(theme.palette.warning.main, 0.06)
            : alpha(theme.palette.text.primary, 0.02),
          '&:hover': { borderColor: alpha(theme.palette.text.primary, 0.3) },
        })}
      >
        <ExcludeIcon
          fontSize="small"
          sx={{ color: excluded.length ? 'warning.main' : 'text.secondary' }}
        />
        <Typography
          variant="body2"
          sx={{ flexGrow: 1, fontWeight: 600, lineHeight: 1.3 }}
        >
          {t('teamOpt.pool.excluded', 'Excluded artifacts')}
        </Typography>
        {/* the count, and what a click does: it reads as a button */}
        <Box
          component="span"
          sx={(theme) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            pl: 1,
            pr: 0.5,
            py: 0.25,
            borderRadius: 1.5,
            fontSize: theme.typography.body2.fontSize,
            fontWeight: 600,
            color: excluded.length ? 'warning.main' : 'text.secondary',
            border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
            '.MuiButtonBase-root:hover &': {
              borderColor: alpha(theme.palette.text.primary, 0.4),
              color: 'text.primary',
            },
          })}
        >
          {excluded.length || null}
          {excluded.length ? ' · ' : null}
          {t('teamOpt.pool.edit', 'Edit')}
          <ChevronRightIcon sx={{ fontSize: 18 }} />
        </Box>
      </ButtonBase>

      <ModalWrapper
        open={show}
        onClose={onClose}
        containerProps={{ maxWidth: 'lg' }}
      >
        <CardThemed>
          <CardHeader
            title={t('teamOpt.pool.excludedTitle', 'Excluded artifacts')}
            subheader={t(
              'teamOpt.pool.excludedHelp',
              'This team is never optimized with these. Find one below, or press ⊘ on an artifact in a result.'
            )}
            action={
              <IconButton onClick={onClose} aria-label={t('close', 'Close')}>
                <CloseIcon />
              </IconButton>
            }
          />
          <Divider />
          <CardContent>
            {excluded.length ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                }}
              >
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
                    <Button size="small" onClick={() => putBack([id])}>
                      {t('teamOpt.result.include', 'Use it again')}
                    </Button>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('teamOpt.pool.excludedEmpty', 'Nothing is excluded yet.')}
              </Typography>
            )}
            {excluded.length > 1 && (
              <Button
                size="small"
                color="warning"
                onClick={() => putBack(excluded)}
                sx={{ mt: 1.5 }}
              >
                {t('teamOpt.pool.excludedClear', 'Use all again')}
              </Button>
            )}
            <Divider sx={{ my: 2 }} />
            {show && (
              <FindToExclude
                excluded={excludedSet}
                onToggle={(id) =>
                  excludedSet.has(id) ? putBack([id]) : exclude(id)
                }
              />
            )}
          </CardContent>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}

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
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t('teamOpt.pool.findTitle', 'Find artifacts to exclude')}
      </Typography>
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
          sx={{ minWidth: 240, flexGrow: 1, maxWidth: 360 }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={slotKey}
          onChange={(_, v: ArtifactSlotKey | '' | null) => {
            setSlotKey(v ?? '')
            setShown(PAGE)
          }}
        >
          <ToggleButton value="">
            {t('teamOpt.pool.anySlot', 'All')}
          </ToggleButton>
          {allArtifactSlotKeys.map((k) => (
            <ToggleButton key={k} value={k} aria-label={k}>
              <SlotIcon slotKey={k} />
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          select
          size="small"
          label={t('teamOpt.pool.mainStat', 'Main stat')}
          value={mainStat}
          onChange={(e) => {
            setMainStat(e.target.value as MainStatKey | '')
            setShown(PAGE)
          }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">{t('teamOpt.pool.anyMain', 'Any')}</MenuItem>
          {allMainStatKeys.map((k) => (
            <MenuItem key={k} value={k}>
              {statName(k)}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {t('teamOpt.pool.found', {
            defaultValue: '{{count}} artifacts',
            count: found.length,
          })}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t(
          'teamOpt.pool.findHelp',
          'Click an artifact to exclude it; click it again to use it again.'
        )}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
        }}
      >
        {found.slice(0, shown).map((a) => {
          const off = excluded.has(a.id)
          return (
            <Box
              key={a.id}
              sx={(theme) => ({
                position: 'relative',
                borderRadius: 1,
                outline: off
                  ? `2px solid ${theme.palette.warning.main}`
                  : undefined,
              })}
            >
              <Box sx={{ opacity: off ? 0.45 : 1 }}>
                <ArtifactCardNano
                  artifactId={a.id}
                  slotKey={a.slotKey}
                  showLocation
                  onClick={() => onToggle(a.id)}
                />
              </Box>
              {off && (
                <ExcludeIcon
                  fontSize="small"
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    color: 'warning.main',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </Box>
          )
        })}
      </Box>
      {shown < found.length && (
        <Button
          onClick={() => setShown((n) => n + PAGE)}
          sx={{ alignSelf: 'center' }}
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
