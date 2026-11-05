import {
  CardThemed,
  ColorText,
  InfoTooltipInline,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import type { TeamCharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import { TeamCharacterContext, useTeam } from '@genshin-optimizer/gi/db-ui'
import type { IResonance } from '@genshin-optimizer/gi/sheets'
import {
  getMoonsignSheet,
  hexereiSheet,
  reactionConditionals,
  resonanceSheets,
} from '@genshin-optimizer/gi/sheets'
import type { dataContextObj } from '@genshin-optimizer/gi/ui'
import { DataContext, DocumentDisplay } from '@genshin-optimizer/gi/ui'
import { input, one, tally } from '@genshin-optimizer/gi/wr'
import {
  Box,
  CardContent,
  CardHeader,
  Divider,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The team-wide buffs (elemental resonance, Moonsign, Hexerei, elemental reactions), stacked for the
 * Team Settings sidebar. A group that does not apply to this lineup collapses to its title row, so
 * empty groups no longer take a full card.
 */
export function ResonanceDisplay({
  teamId,
  team,
  dataContextValue,
}: {
  teamId: string
  team: Team
  dataContextValue: dataContextObj
}) {
  // This context is only used by the ResonanceDisplay, which needs to attach conditional values to team data.
  const teamCharContextObj = useMemo(
    () =>
      ({
        teamId,
        team,
        teamCharId: '', // can be left blank since its only modifying team conditional
        teamChar: {},
      }) as TeamCharacterContextObj,
    [team, teamId]
  )

  return (
    <DataContext.Provider value={dataContextValue}>
      <TeamCharacterContext.Provider value={teamCharContextObj}>
        <ElementalResonance teamId={teamId} />
        <Moonsign />
        <Hexerei />
        <Reactions />
      </TeamCharacterContext.Provider>
    </DataContext.Provider>
  )
}

/** A buff group: its title (with a count or tip), and its content only while it applies. */
function BuffGroup({
  title,
  active,
  children,
}: {
  title: ReactNode
  active: boolean
  children?: ReactNode
}) {
  return (
    <CardThemed bgt="light" sx={{ width: '100%', opacity: active ? 1 : 0.6 }}>
      <CardHeader
        title={title}
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        sx={{ py: 1.25, px: 1.5 }}
      />
      {active && children && (
        <>
          <Divider />
          <CardContent
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              p: 1,
              '&:last-child': { pb: 1 },
            }}
          >
            {children}
          </CardContent>
        </>
      )}
    </CardThemed>
  )
}

function ElementalResonance({ teamId }: { teamId: string }) {
  const { t } = useTranslation(['page_character', 'page_team'])
  const { data } = useContext(DataContext)
  const { loadoutData } = useTeam(teamId)!
  const teamCount = loadoutData.reduce((a, t) => a + (t ? 1 : 0), 0)
  const active = resonanceSheets.filter((res) => res.canShow(data))

  return (
    <BuffGroup
      active
      title={
        <span>
          {t('tabTeambuff.team_reso')}{' '}
          <strong>
            <ColorText color={teamCount >= 4 ? 'success' : 'warning'}>
              ({teamCount}/4)
            </ColorText>
          </strong>{' '}
          <InfoTooltipInline
            title={<Typography>{t('tabTeambuff.resonance_tip')}</Typography>}
          />
        </span>
      }
    >
      {active.length ? (
        <ResonanceList resonances={active} />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
          {t('page_team:teamSettings.noResonance')}
        </Typography>
      )}
    </BuffGroup>
  )
}

function Moonsign() {
  const { t } = useTranslation('sheet_gen')

  const { data, teamData } = useContext(DataContext)
  const moonsignCondChar = data.get(input.nonStacking.moonsignascend).value
  const moonsignCondCharData =
    moonsignCondChar !== undefined
      ? teamData[moonsignCondChar as CharacterKey]?.target
      : undefined
  const moonsignCount = data.get(tally.moonsign).value

  return (
    <BuffGroup
      active={moonsignCount >= 1}
      title={
        <span>
          {t('moonsign')}{' '}
          <strong>
            <ColorText color={moonsignCount >= 2 ? 'success' : 'warning'}>
              ({moonsignCount}/2)
            </ColorText>
          </strong>
        </span>
      }
    >
      <ResonanceList resonances={[getMoonsignSheet(moonsignCondCharData)]} />
    </BuffGroup>
  )
}

function Hexerei() {
  const { t } = useTranslation('sheet_gen')

  const { data } = useContext(DataContext)
  const hexereiCount = data.get(tally.hexerei).value

  return (
    <BuffGroup
      active={hexereiCount >= 2}
      title={
        <span>
          {t('hexerei')}{' '}
          <strong>
            <ColorText color={hexereiCount >= 2 ? 'success' : 'warning'}>
              ({hexereiCount}/2)
            </ColorText>
          </strong>
        </span>
      }
    >
      <ResonanceList resonances={[hexereiSheet]} />
    </BuffGroup>
  )
}

/** Each resonance as a small card; one that does not apply shows its title only, dimmed. */
function ResonanceList({ resonances }: { resonances: IResonance[] }) {
  const { data } = useContext(DataContext)
  return (
    <>
      {resonances.map((res, i) => {
        const show = res.canShow(data)
        return (
          <CardThemed key={i} sx={{ opacity: show ? 1 : 0.5, width: '100%' }}>
            <CardHeader
              title={
                <span>
                  {res.name}{' '}
                  <InfoTooltipInline
                    title={<Typography>{res.desc}</Typography>}
                  />
                </span>
              }
              action={res.icon}
              titleTypographyProps={{ variant: 'subtitle2' }}
              sx={{
                py: 1,
                px: 1.25,
                '& .MuiCardHeader-action': { m: 0, alignSelf: 'center' },
              }}
            />
            {show && <Divider />}
            {show && (
              // the resonance's stats and toggle as one body: no nested cards, and no second
              // header repeating the resonance's name
              <Box sx={{ p: 1.25, '&:empty': { display: 'none' } }}>
                <DocumentDisplay
                  sections={res.sections}
                  teamBuffOnly
                  hideHeader
                  flat
                />
              </Box>
            )}
          </CardThemed>
        )
      })}
    </>
  )
}

function Reactions() {
  const { data } = useContext(DataContext)
  const { t } = useTranslation('sheet')
  const show = reactionConditionals.some(
    (cond) => data.get(cond.canShow ?? one).value
  )
  return (
    <BuffGroup active={show} title={t('elementalReaction.name')}>
      <DocumentDisplay sections={reactionConditionals} teamBuffOnly compact />
    </BuffGroup>
  )
}
