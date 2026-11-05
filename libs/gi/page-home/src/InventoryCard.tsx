import {
  useDataManagerKeys,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { AnvilIcon } from '@genshin-optimizer/common/svgicons'
import { CardThemed, ImgIcon } from '@genshin-optimizer/common/ui'
import { objKeyMap } from '@genshin-optimizer/common/util'
import { imgAssets } from '@genshin-optimizer/gi/assets'
import {
  allArtifactSlotKeys,
  allElementKeys,
  allWeaponTypeKeys,
} from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { getCharEle, getWeaponStat } from '@genshin-optimizer/gi/stats'
import {
  ElementIcon,
  FlowerIcon,
  SlotIcon,
} from '@genshin-optimizer/gi/svgicons'
import { TeamCardCompact, TeamIcon } from '@genshin-optimizer/gi/ui'
import PeopleIcon from '@mui/icons-material/People'
import { Box, Button, CardActionArea, Grid, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'

/** Inventory at a glance: one tile per collection (count + breakdown) and the latest teams. */
export default function InventoryCard() {
  const { t } = useTranslation(['page_home', 'ui'])
  const navigate = useNavigate()
  const database = useDatabase()
  const charKeys = useDataManagerKeys(database.chars)
  const weapons = useDataManagerValues(database.weapons)
  const arts = useDataManagerValues(database.arts)
  // values: re-render when a team is edited, so "recent" stays current
  const teams = useDataManagerValues(database.teams)
  const teamIds = useDataManagerKeys(database.teams)
  const numLoadouts = useDataManagerKeys(database.teamChars).length

  const charTally = objKeyMap(allElementKeys, () => 0)
  charKeys.forEach((ck) => charTally[getCharEle(ck)]++)
  const weaponTally = objKeyMap(allWeaponTypeKeys, () => 0)
  weapons.forEach((w) => weaponTally[getWeaponStat(w.key).weaponType]++)
  const slotTally = objKeyMap(allArtifactSlotKeys, () => 0)
  arts.forEach((art) => slotTally[art.slotKey]++)

  const recentTeamIds =
    teams &&
    teamIds
      .map((id) => [id, database.teams.get(id)?.lastEdit ?? 0] as const)
      .sort(([, a], [, b]) => b - a)
      .map(([id]) => id)
      .slice(0, 6)

  return (
    <Box component="section" aria-labelledby="inventory-title">
      <SectionTitle id="inventory-title">
        {t('inventoryCard.title')}
      </SectionTitle>
      <Grid container spacing={1.5} columns={{ xs: 1, sm: 2, xl: 4 }}>
        <Grid item xs={1}>
          <StatTile
            to="/characters"
            icon={<PeopleIcon />}
            label={t('ui:tabs.characters')}
            count={charKeys.length}
            breakdown={allElementKeys.map(
              (ele) =>
                !!charTally[ele] && (
                  <Breakdown key={ele} icon={<ElementIcon ele={ele} />}>
                    {charTally[ele]}
                  </Breakdown>
                )
            )}
          />
        </Grid>
        <Grid item xs={1}>
          <StatTile
            to="/teams"
            icon={<TeamIcon />}
            label={t('ui:tabs.teams')}
            count={teamIds.length}
            breakdown={
              <Typography variant="body2" color="text.secondary">
                {t('inventoryCard.loadouts', { count: numLoadouts })}
              </Typography>
            }
          />
        </Grid>
        <Grid item xs={1}>
          <StatTile
            to="/artifacts"
            icon={<FlowerIcon />}
            label={t('ui:tabs.artifacts')}
            count={arts.length}
            breakdown={allArtifactSlotKeys.map(
              (slot) =>
                !!slotTally[slot] && (
                  <Breakdown key={slot} icon={<SlotIcon slotKey={slot} />}>
                    {slotTally[slot]}
                  </Breakdown>
                )
            )}
          />
        </Grid>
        <Grid item xs={1}>
          <StatTile
            to="/weapons"
            icon={<AnvilIcon />}
            label={t('ui:tabs.weapons')}
            count={weapons.length}
            breakdown={allWeaponTypeKeys.map(
              (wt) =>
                !!weaponTally[wt] && (
                  <Breakdown
                    key={wt}
                    icon={<ImgIcon src={imgAssets.weaponTypes[wt]} />}
                  >
                    {weaponTally[wt]}
                  </Breakdown>
                )
            )}
          />
        </Grid>
      </Grid>
      {recentTeamIds.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <SectionTitle>{t('inventoryCard.recentTeams')}</SectionTitle>
            <Button
              size="small"
              variant="text"
              color="inherit"
              component={RouterLink}
              to="/teams"
              sx={{ color: 'text.secondary' }}
            >
              {t('inventoryCard.allTeams')}
            </Button>
          </Box>
          <Grid container spacing={1.5} columns={{ xs: 1, md: 2 }}>
            {recentTeamIds.map((teamId) => (
              <Grid item key={teamId} xs={1}>
                <TeamCardCompact
                  teamId={teamId}
                  onClick={(ck) =>
                    navigate(ck ? `/teams/${teamId}/${ck}` : `/teams/${teamId}`)
                  }
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  )
}

export function SectionTitle({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <Typography
      variant="h6"
      component="h2"
      id={id}
      sx={{ mb: 1.25, fontSize: '1.0625rem' }}
    >
      {children}
    </Typography>
  )
}

function StatTile({
  to,
  icon,
  label,
  count,
  breakdown,
}: {
  to: string
  icon: ReactNode
  label: string
  count: number
  breakdown: ReactNode
}) {
  return (
    <CardThemed sx={{ height: '100%' }}>
      <CardActionArea
        component={RouterLink}
        to={to}
        sx={{
          height: '100%',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'text.secondary',
            '& .MuiSvgIcon-root': { fontSize: 20 },
          }}
        >
          {icon}
          <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
        </Box>
        <Typography sx={{ fontSize: '2rem', fontWeight: 650, lineHeight: 1.1 }}>
          {count}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            minHeight: 22,
            color: 'text.secondary',
          }}
        >
          {breakdown}
        </Box>
      </CardActionArea>
    </CardThemed>
  )
}

function Breakdown({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        fontSize: '0.875rem',
        fontWeight: 600,
        '& svg, & img': { width: 16, height: 16 },
      }}
    >
      {icon}
      {children}
    </Box>
  )
}
