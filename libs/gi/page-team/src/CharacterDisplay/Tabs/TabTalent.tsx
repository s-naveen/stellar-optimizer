import { CardThemed, ConditionalWrapper } from '@genshin-optimizer/common/ui'
import { range } from '@genshin-optimizer/common/util'
import { maxConstellationCount } from '@genshin-optimizer/gi/consts'
import {
  CharacterContext,
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
} from '@genshin-optimizer/gi/db-ui'
import { isTalentKey } from '@genshin-optimizer/gi/good'
import {
  type DocumentSection,
  getCharSheet,
  type TalentSheetElementKey,
} from '@genshin-optimizer/gi/sheets'
import {
  DataContext,
  DocumentDisplay,
  HitModeToggle,
  NodeFieldDisplay,
  ReactionToggle,
  TalentDropdown,
} from '@genshin-optimizer/gi/ui'
import type { CalcResult } from '@genshin-optimizer/gi/uidata'
import { uiInput as input } from '@genshin-optimizer/gi/wr'
import CheckIcon from '@mui/icons-material/Check'
import LockIcon from '@mui/icons-material/Lock'
import {
  alpha,
  Box,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BuildTcContext } from '../../BuildTcContext'

const talentSpacing = {
  xs: 12,
  sm: 6,
  md: 4,
}

export default function CharacterTalentPane() {
  const { t } = useTranslation('sheet_gen')
  // Load tooltip translations
  useTranslation('tooltips_gen')
  const {
    character: { key: characterKey },
  } = useContext(CharacterContext)
  const { gender } = useDBMeta()
  const characterSheet = getCharSheet(characterKey, gender)
  const { data } = useContext(DataContext)
  const { buildTc, setBuildTc } = useContext(BuildTcContext)
  const database = useDatabase()
  const skillBurstList = [
    ['auto', t('talents.auto')],
    ['skill', t('talents.skill')],
    ['burst', t('talents.burst')],
  ] as [TalentSheetElementKey, string][]
  const passivesList: [
    tKey: TalentSheetElementKey,
    tText: string,
    asc: number,
  ][] = [
    ['passive1', t('unlockPassive1'), 1],
    ['passive2', t('unlockPassive2'), 4],
    ['passive3', t('unlockPassive3'), 0],
    ['lockedPassive', t('unlockLockedPassive'), 0],
  ]
  const ascension = data.get(input.asc).value
  const constellation = data.get(input.constellation).value

  const theme = useTheme()
  const grlg = useMediaQuery(theme.breakpoints.up('lg'))
  const constellationCards = useMemo(
    () =>
      range(1, maxConstellationCount).map((i) => (
        <SkillDisplayCard
          key={i}
          talentKey={`constellation${i}` as TalentSheetElementKey}
          subtitle={t('constellationLvl', { level: i })}
          badge={`C${i}`}
          status={constellation >= i ? 'active' : 'locked'}
          onClickTitle={() =>
            buildTc?.character
              ? setBuildTc((buildTc) => {
                  if (buildTc.character) buildTc.character.constellation = i
                })
              : database.chars.set(characterKey, {
                  constellation: i === constellation ? i - 1 : i,
                })
          }
        />
      )),
    [
      t,
      buildTc?.character,
      setBuildTc,
      database.chars,
      characterKey,
      constellation,
    ]
  )

  return (
    <>
      <CardThemed bgt="light">
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <HitModeToggle size="small" />
            <ReactionToggle size="small" />
          </Box>
        </CardContent>
      </CardThemed>

      <ReactionDisplay />
      <Grid container spacing={1}>
        {/* constellations for 4column */}
        {grlg && (
          <Grid
            item
            xs={12}
            md={12}
            lg={3}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              // cards clip their overflow, which would otherwise let the column squeeze them
              '& > *': { flexShrink: 0 },
            }}
          >
            <ConstellationHeader />
            {/* plain wrappers: the cards' height: 100% must not stretch to the column */}
            {constellationCards.map((c, i) => (
              <Box key={i}>{c}</Box>
            ))}
          </Grid>
        )}
        <Grid item xs={12} md={12} lg={9} container spacing={1}>
          {/* auto, skill, burst */}
          {skillBurstList.map(([tKey, tText]) => (
            <Grid item key={tKey} {...talentSpacing}>
              <SkillDisplayCard talentKey={tKey} subtitle={tText} />
            </Grid>
          ))}
          {!!characterSheet.getTalentOfKey('sprint') && (
            <Grid item {...talentSpacing}>
              <SkillDisplayCard
                talentKey="sprint"
                subtitle={t('talents.altSprint')}
              />
            </Grid>
          )}
          {!!characterSheet.getTalentOfKey('passive') && (
            <Grid item {...talentSpacing}>
              <SkillDisplayCard talentKey="passive" subtitle="Passive" />
            </Grid>
          )}
          {/* passives */}
          {passivesList.map(([tKey, tText, asc]) => {
            const enabled = ascension >= asc
            if (!characterSheet.getTalentOfKey(tKey)) return null
            return (
              <Grid item key={tKey} {...talentSpacing}>
                <SkillDisplayCard
                  talentKey={tKey}
                  subtitle={tText}
                  status={enabled ? undefined : 'locked'}
                />
              </Grid>
            )
          })}
        </Grid>
        {/* constellations for < 4 columns */}
        {!grlg && (
          <Grid item xs={12} md={12} lg={3} container spacing={1}>
            <Grid item xs={12}>
              <ConstellationHeader />
            </Grid>
            {constellationCards.map((c, i) => (
              <Grid item key={i} {...talentSpacing}>
                {c}
              </Grid>
            ))}
          </Grid>
        )}
      </Grid>
    </>
  )
}
function ReactionDisplay() {
  const { data } = useContext(DataContext)
  const reaction = data.getDisplay()['reaction'] as Record<string, CalcResult>
  // Add Nicole projections here, idk where else
  const nicole = data.getDisplay()['nicole'] as Record<string, CalcResult>
  return (
    <CardThemed bgt="light">
      <CardContent>
        <Grid container spacing={1}>
          {[...Object.entries(reaction), ...Object.entries(nicole)]
            .filter(([_, node]) => !node.isEmpty)
            .map(([key, node]) => {
              return (
                <Grid item key={key}>
                  <CardThemed>
                    <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                      <NodeFieldDisplay calcRes={node} />
                    </CardContent>
                  </CardThemed>
                </Grid>
              )
            })}
        </Grid>
      </CardContent>
    </CardThemed>
  )
}

type SkillDisplayCardProps = {
  talentKey: TalentSheetElementKey
  subtitle: string
  onClickTitle?: () => void
  /** Constellations / passives: unlocked ("active") or not yet ("locked"). */
  status?: 'active' | 'locked'
  /** Short label on the icon, e.g. "C2". */
  badge?: string
}
function SkillDisplayCard({
  talentKey,
  subtitle,
  onClickTitle,
  status,
  badge,
}: SkillDisplayCardProps) {
  const database = useDatabase()
  const {
    teamChar: { key: characterKey },
  } = useContext(TeamCharacterContext)
  const { buildTc, setBuildTc } = useContext(BuildTcContext)

  const { gender } = useDBMeta()
  const characterSheet = getCharSheet(characterKey, gender)
  const actionWrapperFunc = useCallback(
    (children: ReactNode) => (
      <CardActionArea onClick={onClickTitle}>{children}</CardActionArea>
    ),
    [onClickTitle]
  )

  let header: ReactNode = null

  if (isTalentKey(talentKey)) {
    header = (
      <TalentDropdown
        talentKey={talentKey}
        dropDownButtonProps={{
          sx: {
            borderRadius: 0,
            color: buildTc?.character ? 'yellow' : undefined,
          },
        }}
        setTalent={(talent) =>
          buildTc?.character
            ? setBuildTc((buildTc) => {
                if (buildTc.character?.talent[talentKey])
                  buildTc.character.talent[talentKey] = talent
              })
            : database.chars.set(characterKey, (char) => {
                char.talent[talentKey] = talent
              })
        }
      />
    )
  }
  const talentSheet = characterSheet.getTalentOfKey(talentKey)

  // Hide header if the header matches the current talent
  const hideHeader = (section: DocumentSection): boolean => {
    const headerAction = section.header?.action
    if (
      headerAction &&
      typeof headerAction !== 'string' &&
      typeof headerAction !== 'number' &&
      typeof headerAction !== 'boolean' &&
      'props' in headerAction
    ) {
      const key: string = headerAction.props.children.props.key18
      return key.includes(talentKey)
    }
    return false
  }

  const locked = status === 'locked'
  const titleBlock = status ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Box
          component="img"
          src={talentSheet?.img}
          alt=""
          sx={{
            display: 'block',
            width: 52,
            height: 52,
            p: 0.5,
            borderRadius: '50%',
            border: 2,
            borderColor: locked ? 'divider' : 'primary.main',
            bgcolor: locked ? 'transparent' : 'contentDark.main',
            // locked: a grey, faded icon; the text below stays readable
            filter: locked ? 'grayscale(1)' : undefined,
            opacity: locked ? 0.5 : 1,
          }}
        />
        {badge && (
          <Box
            component="span"
            sx={{
              position: 'absolute',
              right: -6,
              bottom: -4,
              px: 0.625,
              borderRadius: 1,
              fontSize: '0.6875rem',
              fontWeight: 700,
              lineHeight: '18px',
              ...(locked
                ? {
                    bgcolor: 'contentNormal.main',
                    color: 'text.secondary',
                    border: 1,
                    borderColor: 'divider',
                  }
                : { bgcolor: 'primary.main', color: '#17181f' }),
            }}
          >
            {badge}
          </Box>
        )}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            lineHeight: 1.3,
            color: locked ? 'text.secondary' : 'text.primary',
          }}
        >
          {talentSheet?.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
      <StatusTag locked={locked} />
    </Box>
  ) : (
    <Grid container sx={{ flexWrap: 'nowrap' }}>
      <Grid item>
        <Box
          component="img"
          src={talentSheet?.img}
          sx={{ width: 60, height: 'auto' }}
        />
      </Grid>
      <Grid item flexGrow={1} sx={{ pl: 1 }}>
        <Typography variant="h6">{talentSheet?.name}</Typography>
        <Typography variant="subtitle1">{subtitle}</Typography>
      </Grid>
    </Grid>
  )

  return (
    <CardThemed
      bgt="light"
      sx={{
        height: '100%',
        ...(status && {
          border: 1,
          borderColor: (theme) =>
            locked
              ? theme.palette.divider
              : alpha(theme.palette.primary.main, 0.35),
          // a locked one is an empty, dashed slot instead of a raised card
          ...(locked && { borderStyle: 'dashed', bgcolor: 'transparent' }),
        }),
      }}
    >
      {header}
      <CardContent>
        <ConditionalWrapper
          condition={!!onClickTitle}
          wrapper={actionWrapperFunc}
        >
          {titleBlock}
        </ConditionalWrapper>
        {/* Display document sections */}
        {talentSheet?.sections ? (
          <Box sx={{ opacity: locked ? 0.7 : 1 }}>
            <DocumentDisplay
              sections={talentSheet.sections}
              hideDesc
              hideHeader={hideHeader}
              collapse
            />
          </Box>
        ) : null}
      </CardContent>
    </CardThemed>
  )
}

/** "Active" (gold) or "Locked" (muted, with a lock) next to a constellation / passive name. */
function StatusTag({ locked }: { locked: boolean }) {
  const { t } = useTranslation('page_character')
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        flexShrink: 0,
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        ...(locked
          ? { color: 'text.secondary', border: 1, borderColor: 'divider' }
          : {
              color: 'primary.light',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
            }),
      }}
    >
      {locked ? (
        <LockIcon sx={{ fontSize: 14 }} />
      ) : (
        <CheckIcon sx={{ fontSize: 14 }} />
      )}
      {locked ? t('constellations.locked') : t('constellations.active')}
    </Box>
  )
}

/** "Constellations · C2 of 6" with a C0–C6 picker; levels already unlocked are tinted gold. */
function ConstellationHeader() {
  const { t } = useTranslation(['page_character', 'sheet_gen'])
  const {
    character: { key: characterKey },
  } = useContext(CharacterContext)
  const { data } = useContext(DataContext)
  const { buildTc, setBuildTc } = useContext(BuildTcContext)
  const database = useDatabase()
  const constellation = data.get(input.constellation).value as number
  const setLevel = (level: number) =>
    buildTc?.character
      ? setBuildTc((buildTc) => {
          if (buildTc.character) buildTc.character.constellation = level
        })
      : database.chars.set(characterKey, { constellation: level })

  return (
    <CardThemed bgt="light">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('constellations.title')}
          </Typography>
          {buildTc?.character && (
            <Chip size="small" label={t('constellations.tc')} />
          )}
          <Typography color="text.secondary">
            {t('constellations.level', {
              level: constellation,
              max: maxConstellationCount,
            })}
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={constellation}
          onChange={(_, level: number | null) =>
            level !== null && setLevel(level)
          }
          aria-label={t('constellations.setLevel')}
          sx={{
            // the current level is the strongest gold, unlocked ones below it a lighter gold
            '& .MuiToggleButton-root.Mui-selected': {
              color: 'primary.light',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.24),
              boxShadow: (theme) =>
                `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.6)}`,
            },
          }}
        >
          {range(0, maxConstellationCount).map((level) => (
            <ToggleButton
              key={level}
              value={level}
              aria-label={t('sheet_gen:constellationLvl', { level })}
              sx={
                // every level below the current one is reached, C0 included
                level < constellation
                  ? {
                      color: 'primary.light',
                      bgcolor: (theme) =>
                        alpha(theme.palette.primary.main, 0.1),
                    }
                  : undefined
              }
            >
              C{level}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </CardContent>
    </CardThemed>
  )
}
