import {
  ConditionalWrapper,
  SqBadge,
  StarsDisplay,
} from '@genshin-optimizer/common/ui'
import { characterAsset } from '@genshin-optimizer/gi/assets'
import type {
  AscensionKey,
  CharacterKey,
  ElementKey,
  GenderKey,
} from '@genshin-optimizer/gi/consts'
import { getCharMaxLevel } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { input } from '@genshin-optimizer/gi/wr'
import { Box, CardActionArea, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useContext } from 'react'
import { DataContext } from '../../../context'
import { iconAsset } from '../../../util/iconAsset'
import type { RollColorKey } from '../../artifact'
import { CharacterName } from '../Trans'

export function CharacterCardHeader({
  children,
  characterKey,
  onClick,
}: {
  children: React.ReactNode
  characterKey: CharacterKey
  onClick?: () => void
}) {
  const { gender } = useDBMeta()
  const charStat = getCharStat(characterKey)

  const actionWrapperFunc = useCallback(
    (children: ReactNode) => (
      <CardActionArea
        onClick={onClick}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </CardActionArea>
    ),
    [onClick]
  )
  const banner = characterAsset(characterKey, 'banner', gender)

  return (
    <ConditionalWrapper condition={!!onClick} wrapper={actionWrapperFunc}>
      <Box
        display="flex"
        position="relative"
        className={!banner ? `grad-${charStat.rarity}star` : undefined}
        sx={{
          '&::before': {
            content: '""',
            display: 'block',
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            opacity: 0.5,
            backgroundImage: banner ? `url(${banner})` : undefined,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          },
          // darkens the banner behind the text, so it stays readable on bright art
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(18, 19, 25, 0) 30%, rgba(18, 19, 25, 0.5) 100%)',
            pointerEvents: 'none',
          },
        }}
        width="100%"
      >
        <Box
          component="img"
          src={iconAsset(characterKey, gender)}
          alt=""
          // the square is reserved before the image loads, so the card does not jump
          sx={{
            width: '40%',
            aspectRatio: '1',
            objectFit: 'contain',
            objectPosition: 'bottom',
            flexShrink: 0,
          }}
          alignSelf="flex-end"
          zIndex={1}
        />
        <Box
          flexGrow={1}
          sx={{ py: 1.25, pr: 1.25, pl: 0.5, gap: 0.5, minWidth: 0 }}
          display="flex"
          flexDirection="column"
          zIndex={1}
          justifyContent="space-between"
        >
          {children}
        </Box>
      </Box>
    </ConditionalWrapper>
  )
}

export function CharacterCardHeaderContent({
  characterKey,
  tcOverride = false,
}: {
  characterKey: CharacterKey
  tcOverride?: boolean
}) {
  const { gender } = useDBMeta()
  const { data } = useContext(DataContext)
  const characterEle = data.get(input.charEle).value as ElementKey
  const characterLevel = data.get(input.lvl).value
  const constellation = data.get(input.constellation).value
  const ascension = data.get(input.asc).value as AscensionKey
  const autoBoost = data.get(input.total.autoBoost).value
  const skillBoost = data.get(input.total.skillBoost).value
  const burstBoost = data.get(input.total.burstBoost).value

  const tAuto = data.get(input.total.auto).value
  const tSkill = data.get(input.total.skill).value
  const tBurst = data.get(input.total.burst).value
  const charStat = getCharStat(characterKey)
  const tcColor = tcOverride ? 'yellow' : undefined

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <CardName
          characterKey={characterKey}
          ele={characterEle}
          gender={gender}
        />
        <Typography sx={{ fontSize: 13, lineHeight: 1, display: 'flex' }}>
          <StarsDisplay stars={charStat.rarity} colored inline />
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          textShadow: '0 1px 6px rgba(0, 0, 0, 0.6)',
        }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: '0.875rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            color: tcColor ?? 'text.primary',
          }}
        >
          Lv. {characterLevel}
          <Box
            component="span"
            sx={{ fontWeight: 500, color: tcColor ?? 'text.secondary' }}
          >
            /{getCharMaxLevel(characterLevel, ascension)}
          </Box>
        </Typography>
        <ConstellationPill
          constellation={constellation}
          tcOverride={tcOverride}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <TalentPill
          level={tAuto}
          boosted={!!autoBoost}
          tcOverride={tcOverride}
        />
        <TalentPill
          level={tSkill}
          boosted={!!skillBoost}
          tcOverride={tcOverride}
        />
        <TalentPill
          level={tBurst}
          boosted={!!burstBoost}
          tcOverride={tcOverride}
        />
      </Box>
    </>
  )
}

const pillSx = {
  height: 20,
  px: 0.75,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.75rem',
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  textShadow: 'none',
} as const
// a dark glass pill reads on any banner
const glassPill = {
  bgcolor: 'rgba(18, 19, 25, 0.6)',
  boxShadow: 'inset 0 0 0 1px rgba(236, 229, 216, 0.14)',
} as const

/** C0 stays neutral; from C1 on, the roll colours (as before) with dark text so it reads. */
function ConstellationPill({
  constellation,
  tcOverride,
}: {
  constellation: number
  tcOverride: boolean
}) {
  const color =
    !tcOverride && constellation > 0
      ? (`roll${Math.max(3, constellation)}` as RollColorKey)
      : undefined
  return (
    <Box
      component="span"
      sx={{
        ...pillSx,
        borderRadius: '6px',
        ...(color
          ? { bgcolor: `${color}.main`, color: '#17181f' }
          : {
              ...glassPill,
              color: tcOverride ? 'yellow' : 'text.secondary',
            }),
      }}
    >
      C{constellation}
    </Box>
  )
}

/** A talent level; boosted (by a constellation) talents are blue, as before. */
function TalentPill({
  level,
  boosted,
  tcOverride,
}: {
  level: number
  boosted: boolean
  tcOverride: boolean
}) {
  return (
    <Box
      component="span"
      sx={{
        ...pillSx,
        minWidth: 24,
        borderRadius: 10,
        ...(boosted && !tcOverride
          ? { bgcolor: 'info.main', color: '#17181f' }
          : { ...glassPill, color: tcOverride ? 'yellow' : 'text.primary' }),
      }}
    >
      {level}
    </Box>
  )
}

export function HeaderContentNew({
  characterKey,
}: {
  characterKey: CharacterKey
}) {
  const { gender } = useDBMeta()
  const charStat = getCharStat(characterKey)
  return (
    <>
      <CardName
        characterKey={characterKey}
        ele={getCharEle(characterKey)}
        gender={gender}
      />
      <Box mt={1}>
        <Typography variant="h4">
          <SqBadge>NEW</SqBadge>
        </Typography>
      </Box>
      <Typography mt={1.5}>
        <StarsDisplay stars={charStat.rarity} colored />
      </Typography>
    </>
  )
}

/** The character's name with their element icon: lighter than a solid element-coloured pill. */
function CardName({
  characterKey,
  ele,
  gender,
}: {
  characterKey: CharacterKey
  ele: ElementKey
  gender: GenderKey
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minWidth: 0,
        color: `${ele}.main`,
        '& .MuiSvgIcon-root': { fontSize: 18, flexShrink: 0 },
      }}
    >
      <ElementIcon ele={ele} />
      <Typography
        noWrap
        sx={{
          color: 'text.primary',
          fontWeight: 650,
          fontSize: '0.9375rem',
          lineHeight: 1.35,
          letterSpacing: '-0.01em',
          textShadow: '0 1px 8px rgba(0, 0, 0, 0.65)',
        }}
      >
        <CharacterName characterKey={characterKey} gender={gender} />
      </Typography>
    </Box>
  )
}
