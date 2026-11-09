import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { ArtifactSlotKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamCharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeam,
} from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import { CharacterName, teamOptPool } from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import {
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import MainStatSelectionCard from '../CharacterDisplay/Tabs/TabOptimize/Components/MainStatSelectionCard'
import { formatDamage } from './format'
import { MemberAvatar } from './MemberAvatar'
import { PoolSettings } from './TeamOptSettings'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * Before a run: what it searches. Each member's main stats (all by default; fewer make its
 * search smaller, so the run faster), whether it is optimized, the inventory and weapons, and how
 * many team builds to find. Then Start.
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
  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
    >
      <CardThemed>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            px: 2.5,
            pt: 2,
            pb: 1.5,
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" component="h2">
              {t('teamOpt.runDialog.title', 'Optimize team')}
            </Typography>
          </Box>
          <IconButton
            onClick={onClose}
            aria-label={t('teamOpt.editor.close', 'Close')}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />
        <Box
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            maxHeight: '70vh',
            overflowY: 'auto',
            // a card clips its content: in a scrolling column it would shrink to its header
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {members.map((member) => (
              <MemberRunRow
                key={member.characterKey}
                teamId={teamId}
                member={member}
                members={members}
                teamOpt={teamOpt}
                setTeamOpt={setTeamOpt}
              />
            ))}
          </Box>
        </Box>
        <Divider />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2.5,
            py: 1.5,
          }}
        >
          <Tooltip
            placement="top"
            title={t(
              'teamOpt.run.buildsInfo',
              'How many team builds to find: the best one, then the next best ones (each changes one member’s artifacts).'
            )}
          >
            <TextField
              select
              size="small"
              label={t('teamOpt.run.buildsLabel', 'Builds')}
              value={builds}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTeamOpt((o) => {
                  if (n > 1) o.topN = n
                  else delete o.topN
                })
              }}
              sx={{ width: 84, flexShrink: 0 }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
          </Tooltip>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" onClick={onClose}>
            {t('teamOpt.runDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<TrendingUpIcon />}
            onClick={() => {
              onClose()
              onStart()
            }}
            sx={giCtaSx}
          >
            {t('teamOpt.runDialog.start', 'Start')}
          </Button>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/**
 * A member's line: optimized or kept, the size of its search, and its main stats, chosen as on
 * its Optimize page (the same card and settings: what is unticked here is unticked there)
 */
function MemberRunRow({
  teamId,
  member,
  members,
  teamOpt,
  setTeamOpt,
}: {
  teamId: string
  member: TeamOptMember
  members: TeamOptMember[]
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

  return (
    <Box
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          md: '200px minmax(0, 1fr)',
        },
        gap: 1.5,
        p: 1.25,
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MemberAvatar characterKey={characterKey} />
          <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
          <Typography variant="body2" color="text.secondary">
            {isTc
              ? t('teamOpt.member.tc', 'TC build: kept as it is')
              : t('teamOpt.member.optimize', 'Optimize artifacts')}
          </Typography>
        </Box>
        {!kept && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {t('teamOpt.runDialog.size', {
              defaultValue: '≈ {{size}} builds to search',
              size: formatDamage(size),
            })}
          </Typography>
        )}
      </Box>
      {teamCharContext && (
        <TeamCharacterContext.Provider value={teamCharContext}>
          <MainStatSelectionCard
            filteredArtIdMap={filteredArtIdMap}
            disabled={kept}
          />
        </TeamCharacterContext.Provider>
      )}
    </Box>
  )
}
