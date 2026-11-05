import {
  BootstrapTooltip,
  SqBadge,
  StarsDisplay,
} from '@genshin-optimizer/common/ui'
import { clamp, getUnitStr } from '@genshin-optimizer/common/util'
import type {
  ArtifactSlotKey,
  LocationKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import { SlotIcon, StatIcon } from '@genshin-optimizer/gi/svgicons'
import {
  artDisplayValue,
  getMainStatDisplayStr,
} from '@genshin-optimizer/gi/util'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import type { Palette } from '@mui/material'
import { Box, Skeleton, Typography } from '@mui/material'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { iconAsset } from '../../util/iconAsset'
import { CharacterName } from '../character/Trans'
import {
  ArtifactSetName,
  ArtifactSetSlotName,
  ArtifactSlotName,
} from './ArtifactTrans'
import type { RollColorKey } from './util'
import { artifactLevelVariant } from './util'

export function ArtifactTooltip({
  art,
  children,
}: {
  art: ICachedArtifact
  children: JSX.Element
}) {
  const title = (
    <Suspense
      fallback={<Skeleton variant="rectangular" width={256} height={220} />}
    >
      <ArtifactData art={art} />
    </Suspense>
  )

  return (
    <BootstrapTooltip placement="top" title={title} disableInteractive>
      {children}
    </BootstrapTooltip>
  )
}

/** The artifact at a glance: piece, main stat, substats (in their roll colours), set and wearer. */
function ArtifactData({ art }: { art: ICachedArtifact }) {
  const { t: tk } = useTranslation('statKey_gen')
  const {
    setKey,
    slotKey,
    level,
    rarity,
    mainStatKey,
    substats,
    unactivatedSubstats,
    location,
  } = art
  const mainVariant = KeyMap.getVariant(mainStatKey)
  return (
    <Box
      sx={{
        width: 264,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box>
        <SlotLine slotKey={slotKey} level={level} />
        <Typography
          sx={{
            mt: 0.5,
            fontSize: '0.9375rem',
            fontWeight: 600,
            lineHeight: 1.3,
            color: 'text.primary',
          }}
        >
          <ArtifactSetSlotName setKey={setKey} slotKey={slotKey} />
        </Typography>
        <Box
          sx={{ mt: 0.5, display: 'flex', fontSize: 13, lineHeight: 1 }}
          aria-label={`${rarity}★`}
        >
          <StarsDisplay stars={rarity} colored inline />
        </Box>
      </Box>

      {/* main stat */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          py: 0.75,
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          color: mainVariant ? `${mainVariant}.main` : 'text.primary',
        }}
      >
        <StatIcon statKey={mainStatKey} iconProps={{ sx: { fontSize: 18 } }} />
        <Typography
          sx={{ fontSize: '0.8125rem', color: 'inherit', opacity: 0.85 }}
        >
          {tk(mainStatKey)}
        </Typography>
        <Typography
          sx={{
            ml: 'auto',
            fontSize: '1.25rem',
            fontWeight: 700,
            lineHeight: 1.2,
            color: 'inherit',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {getMainStatDisplayStr(mainStatKey, rarity, level)}
        </Typography>
      </Box>

      {/* substats */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {substats.map(
          ({ value, key, rolls }) =>
            !!(value && key) && (
              <SubstatRow
                key={key}
                statKey={key}
                value={value}
                color={`roll${clamp(rolls.length, 1, 6)}` as RollColorKey}
              />
            )
        )}
        {unactivatedSubstats?.map(
          ({ value, key }) =>
            !!(value && key) && (
              <SubstatRow key={key} statKey={key} value={value} inactive />
            )
        )}
      </Box>

      {/* set and wearer */}
      <Box
        sx={{
          pt: 0.75,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Typography
          sx={{ fontSize: '0.8125rem', fontWeight: 500, color: 'success.main' }}
        >
          <ArtifactSetName setKey={setKey} />
        </Typography>
        <WearerLine location={location} />
      </Box>
    </Box>
  )
}

function SlotLine({
  slotKey,
  level,
}: {
  slotKey: ArtifactSlotKey
  level: number
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        color: 'text.secondary',
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      <SlotIcon slotKey={slotKey} iconProps={{ sx: { fontSize: 14 } }} />
      <ArtifactSlotName slotKey={slotKey} />
      <SqBadge
        color={artifactLevelVariant(level)}
        sx={{
          ml: 'auto',
          fontSize: '0.75rem',
          fontWeight: 700,
          letterSpacing: 0,
          borderRadius: '6px',
          px: 0.75,
        }}
      >
        +{level}
      </SqBadge>
    </Box>
  )
}

/** One substat: icon and value in the roll colour, the name in text colour so it stays readable. */
function SubstatRow({
  statKey,
  value,
  color,
  inactive = false,
}: {
  statKey: MainStatKey | SubstatKey
  value: number
  color?: keyof Palette
  inactive?: boolean
}) {
  const { t: tk } = useTranslation('statKey_gen')
  const unit = getUnitStr(statKey)
  const tone = inactive ? 'text.disabled' : color ? `${color}.main` : undefined
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: '0.8125rem',
        lineHeight: 1.4,
      }}
    >
      <Box component="span" sx={{ display: 'flex', color: tone }}>
        <StatIcon statKey={statKey} iconProps={{ sx: { fontSize: 15 } }} />
      </Box>
      <Box
        component="span"
        sx={{ color: inactive ? 'text.disabled' : 'text.primary' }}
      >
        {tk(statKey)}
      </Box>
      <Box
        component="span"
        sx={{
          ml: 'auto',
          fontWeight: 700,
          color: tone,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        +{artDisplayValue(value, unit)}
        {unit}
      </Box>
    </Box>
  )
}

/** Who wears it: a small round portrait and the name, or Inventory. */
function WearerLine({ location }: { location: LocationKey }) {
  const { t } = useTranslation('ui')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const characterKey = location
    ? database.chars.LocationToCharacterKey(location)
    : undefined
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: '0.8125rem',
        color: 'text.secondary',
      }}
    >
      {characterKey ? (
        <>
          <Box
            component="img"
            src={iconAsset(characterKey, gender)}
            alt=""
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              objectFit: 'cover',
              bgcolor: 'divider',
              flexShrink: 0,
            }}
          />
          <CharacterName characterKey={characterKey} gender={gender} />
        </>
      ) : (
        <>
          <BusinessCenterIcon sx={{ fontSize: 18 }} />
          {t('inventory')}
        </>
      )}
    </Box>
  )
}
