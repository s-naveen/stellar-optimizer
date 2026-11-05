import { DropdownButton, SqBadge } from '@genshin-optimizer/common/ui'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import type { ButtonGroupProps } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  ButtonGroup,
  FormControlLabel,
  MenuItem,
  Switch,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { BuildNameWithSource } from '../BuildNameWithSource'

/**
 * The UI component that modifies the compare data in a TeamChar.
 * This is used in conjuction with useCompareData hook to supply a compareData to the compare UI.
 */

export default function CompareBtn({
  buttonGroupProps = {},
  quiet = false,
}: {
  buttonGroupProps?: ButtonGroupProps
  /** A switch and an outlined build picker with neutral badges, for the settings-card look */
  quiet?: boolean
}) {
  const { t } = useTranslation('build')
  const database = useDatabase()
  const {
    teamId,
    teamCharId,
    loadoutDatum,
    teamChar: { key: characterKey },
  } = useContext(TeamCharacterContext)
  const characterBuilds = database.builds.entriesForCharacter(
    characterKey,
    teamCharId
  )
  const characterTcBuilds = database.buildTcs.entriesForCharacter(
    characterKey,
    teamCharId
  )
  const {
    buildType,
    buildId,
    buildTcId,
    compare,
    compareType,
    compareBuildId,
    compareBuildTcId,
  } = loadoutDatum
  const badge = (text: ReactNode) =>
    quiet ? (
      <QuietBadge>{text}</QuietBadge>
    ) : (
      <SqBadge color="info" sx={{ ml: 1 }}>
        {text}
      </SqBadge>
    )
  const selectedName =
    compareType === 'real'
      ? (database.builds.get(compareBuildId)?.name ?? '')
      : compareType === 'tc'
        ? (database.buildTcs.get(compareBuildTcId)?.name ?? '')
        : t('compareBtn.equipped').trim()
  const current =
    (compareType === 'equipped' && buildType === 'equipped') ||
    (compareType === 'real' &&
      buildType === 'real' &&
      buildId === compareBuildId) ||
    (compareType === 'tc' &&
      buildType === 'tc' &&
      buildTcId === compareBuildTcId)
  const toggleCompare = () =>
    database.teams.setLoadoutDatum(teamId, teamCharId, {
      compare: !compare,
    })
  const pickerDisabled =
    !compare || (!characterBuilds.length && !characterTcBuilds.length)
  const menuItems = [
    <MenuItem
      key="equipped"
      onClick={() =>
        database.teams.setLoadoutDatum(teamId, teamCharId, {
          compareType: 'equipped',
        })
      }
    >
      {t('compareBtn.equipped')}
      {buildType === 'equipped' && badge(t('compareBtn.crrBadge'))}
    </MenuItem>,
    ...characterBuilds.map(([bId, { name, weaponId, srcTeamCharId }]) => (
      <MenuItem
        disabled={!weaponId}
        key={bId}
        onClick={() =>
          database.teams.setLoadoutDatum(teamId, teamCharId, {
            compareType: 'real',
            compareBuildId: bId,
          })
        }
      >
        <BuildNameWithSource
          name={name}
          srcTeamCharId={srcTeamCharId}
          suffix={
            buildType === 'real' &&
            bId === buildId &&
            badge(t('compareBtn.crrBadge'))
          }
        />
      </MenuItem>
    )),
    ...characterTcBuilds.map(([bTcId, { name, srcTeamCharId }]) => (
      <MenuItem
        key={bTcId}
        onClick={() =>
          database.teams.setLoadoutDatum(teamId, teamCharId, {
            compareType: 'tc',
            compareBuildTcId: bTcId,
          })
        }
      >
        <BuildNameWithSource
          name={name}
          srcTeamCharId={srcTeamCharId}
          suffix={
            <>
              {badge(t('compareBtn.tcBadge'))}
              {buildType === 'tc' &&
                bTcId === buildTcId &&
                badge(t('compareBtn.crrBadge'))}
            </>
          }
        />
      </MenuItem>
    )),
  ]

  if (quiet)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <FormControlLabel
          sx={{ m: 0, gap: 0.5 }}
          control={
            <Switch size="small" checked={compare} onChange={toggleCompare} />
          }
          label={
            <Typography variant="body2">{t('compareBtn.compare')}</Typography>
          }
        />
        <DropdownButton
          size="small"
          variant="outlined"
          color="inherit"
          disabled={pickerDisabled}
          sx={{ minWidth: 0, maxWidth: 320 }}
          title={
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedName}
              </Box>
              {compareType === 'tc' && badge(t('compareBtn.tcBadge'))}
              {current && badge(t('compareBtn.crrBadge'))}
            </Box>
          }
        >
          {menuItems}
        </DropdownButton>
      </Box>
    )

  return (
    <ButtonGroup {...buttonGroupProps}>
      <Button
        startIcon={compare ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
        color={compare ? 'success' : 'secondary'}
        onClick={toggleCompare}
      >
        {t('compareBtn.compare')}
      </Button>
      <DropdownButton
        title={
          <>
            {compareType === 'tc' ? (
              <span>
                {selectedName} {badge(t('compareBtn.tcBadge'))}
              </span>
            ) : (
              selectedName
            )}{' '}
            {current && badge(t('compareBtn.crrBadge'))}
          </>
        }
        disabled={pickerDisabled}
      >
        {menuItems}
      </DropdownButton>
    </ButtonGroup>
  )
}

/** A small neutral pill ("Current", "TC") for the quiet style. */
function QuietBadge({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ml: 0.75,
        px: 0.75,
        borderRadius: 999,
        bgcolor: alpha(theme.palette.text.primary, 0.08),
        color: 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      })}
    >
      {children}
    </Box>
  )
}
