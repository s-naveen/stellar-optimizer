import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  ImgIcon,
  ModalWrapper,
  NumberInputLazy,
} from '@genshin-optimizer/common/ui'
import {
  deepClone,
  deletePropPath,
  layeredAssignment,
  objClearEmpties,
  objPathValue,
} from '@genshin-optimizer/common/util'
import { imgAssets, weaponAsset } from '@genshin-optimizer/gi/assets'
import type {
  CharacterKey,
  WeaponKey,
  WeaponTypeKey,
} from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon, TeamOpt } from '@genshin-optimizer/gi/db'
import {
  defaultInitialWeaponKey,
  initialWeapon,
} from '@genshin-optimizer/gi/db'
import {
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import type { DocumentConditional } from '@genshin-optimizer/gi/sheets'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  hasEnergyRequirement,
  isEnergyWeapon,
  LocationName,
  WeaponEditor,
  WeaponName,
  WeaponSelectionModal,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import BoltIcon from '@mui/icons-material/Bolt'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import type { SxProps, Theme } from '@mui/material'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  createContext,
  Suspense,
  startTransition,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  DialogHead,
  floatSx,
  OptionTile,
  stackedBackdrop,
  TileAction,
} from './OptionTile'
import {
  FieldLabel,
  focusSx,
  hairline,
  numSx,
  Pill,
  quickSx,
  tokens,
  type as typo,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/** The inventory's weapons the members can wield, by weapon type (best first) */
function useTeamWeapons(members: TeamOptMember[]) {
  const database = useDatabase()
  // (subscribed: a weapon added or removed here, or anywhere, shows at once)
  const inventory = useDataManagerValues(database.weapons)
  return useMemo(() => {
    const types = [
      ...new Set(members.map((m) => getCharWeaponType(m.characterKey))),
    ] as WeaponTypeKey[]
    return types.map((type) => ({
      type,
      members: members.filter(
        (m) => getCharWeaponType(m.characterKey) === type
      ),
      weapons: inventory
        .filter((w) => getWeaponStat(w.key)?.weaponType === type)
        .sort(
          (a, b) =>
            getWeaponStat(b.key).rarity - getWeaponStat(a.key).rarity ||
            b.level - a.level ||
            b.refinement - a.refinement
        ),
    }))
  }, [inventory, members])
}

/** Whether to choose the members' weapons too, and which ones may be chosen */
export function WeaponSettings({
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const groups = useTeamWeapons(members)
  const [show, onShow, onHide] = useBoolState()
  const total = groups.reduce((n, g) => n + g.weapons.length, 0)
  const excluded = new Set(teamOpt.excludedWeapons)
  const allowed = groups.reduce(
    (n, g) => n + g.weapons.filter((w) => !excluded.has(w.id)).length,
    0
  )
  return (
    <>
      <OptionTile
        label={t('teamOpt.weapons.toggle', 'Weapons too')}
        checked={teamOpt.optimizeWeapons}
        disabled={disabled}
        onChange={() =>
          setTeamOpt((o) => {
            o.optimizeWeapons = !o.optimizeWeapons
          })
        }
        action={
          teamOpt.optimizeWeapons && (
            <Tooltip
              arrow
              title={t('teamOpt.weapons.title', 'Weapons to choose from')}
            >
              <span style={{ display: 'inline-flex' }}>
                <TileAction
                  onClick={(e) => {
                    // (not the tile's toggle)
                    e.preventDefault()
                    onShow()
                  }}
                  disabled={disabled}
                  aria-label={t(
                    'teamOpt.weapons.title',
                    'Weapons to choose from'
                  )}
                >
                  {`${allowed}/${total}`}
                </TileAction>
              </span>
            </Tooltip>
          )
        }
      />
      {show && (
        <WeaponChooserModal
          groups={groups}
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          onClose={onHide}
        />
      )}
    </>
  )
}

function WeaponChooserModal({
  groups,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  onClose,
}: {
  groups: ReturnType<typeof useTeamWeapons>
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['page_team', 'page_weapon'])
  const excluded = new Set(teamOpt.excludedWeapons)
  const all = groups.flatMap((g) => g.weapons)
  const setExcluded = (ids: string[]) =>
    setTeamOpt((o) => {
      o.excludedWeapons = [...new Set(ids)]
    })
  const toggle = (weapon: ICachedWeapon) =>
    setExcluded(
      excluded.has(weapon.id)
        ? teamOpt.excludedWeapons.filter((id) => id !== weapon.id)
        : [...teamOpt.excludedWeapons, weapon.id]
    )
  // the dialog shows at once (its frame and placeholders); its rows fill in right after
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setReady(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])
  // the quick picks: lit when the ticks are exactly theirs
  const sameAs = (ids: string[]) =>
    ids.length === excluded.size && ids.every((id) => excluded.has(id))
  const below5 = all
    .filter((w) => getWeaponStat(w.key).rarity < 5)
    .map((w) => w.id)
  const below80 = all.filter((w) => w.level < 80).map((w) => w.id)
  const picks = [
    { key: 'all', label: t('teamOpt.weapons.all', 'All'), ids: [] },
    {
      key: '5',
      label: t('teamOpt.weapons.fiveStar', 'Only 5★'),
      ids: below5,
    },
    {
      key: '80',
      label: t('teamOpt.weapons.leveled', 'Level 80 and up'),
      ids: below80,
    },
  ]
  const allowedCount = all.filter((w) => !excluded.has(w.id)).length
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      // (over the run dialog, already dimmed: a light backdrop, not a second dark one)
      slotProps={stackedBackdrop}
    >
      <CardThemed sx={floatSx}>
        <DialogHead
          title={t('teamOpt.weapons.title', 'Weapons to choose from')}
          info={t(
            'teamOpt.weapons.desc',
            'Each member tries the ticked weapons of its type, along with its artifacts. A passive counts only when it is on for that character. An energy weapon in the team lowers each member’s Energy Recharge requirement by what you set for that member: click ⚡ on it.'
          )}
          actions={
            <Typography sx={{ ...typo.label, ...numSx, whiteSpace: 'nowrap' }}>
              {t('teamOpt.weapons.groupCount', {
                defaultValue: '{{allowed}} of {{total}}',
                allowed: allowedCount,
                total: all.length,
              })}
            </Typography>
          }
          onClose={onClose}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.25,
            borderBottom: hairline,
          }}
        >
          {picks.map((p) => (
            <Pill
              key={p.key}
              selected={sameAs(p.ids)}
              onClick={() => setExcluded(p.ids)}
            >
              {p.label}
            </Pill>
          ))}
        </Box>
        <Box
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            maxHeight: { xs: 'calc(100dvh - 170px)', sm: '70vh' },
            overflowY: 'auto',
          }}
        >
          {!ready &&
            groups.map((group) => (
              <Box key={group.type}>
                <Skeleton variant="text" width={180} height={34} />
                <Box sx={{ mt: 1, ...rowGridSx }}>
                  {group.weapons.slice(0, 6).map((w) => (
                    <Skeleton
                      key={w.id}
                      variant="rounded"
                      height={98}
                      sx={{ borderRadius: tokens.radius.inset }}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          {ready &&
            groups.map((group) => (
              <WeaponGroup
                key={group.type}
                {...group}
                teamData={teamData}
                excluded={excluded}
                onToggle={toggle}
                teamMembers={members}
                weaponEnergy={teamOpt.weaponEnergy}
                setWeaponEnergy={(id, characterKey, value) =>
                  setTeamOpt((o) => {
                    const perMember = { ...o.weaponEnergy[id] }
                    if (value > 0) perMember[characterKey] = value
                    else delete perMember[characterKey]
                    if (Object.keys(perMember).length)
                      o.weaponEnergy[id] = perMember
                    else delete o.weaponEnergy[id]
                  })
                }
                typeName={t(`page_weapon:weaponType.${group.type}`, group.type)}
              />
            ))}
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** Weapon cards side by side (one column on phones) */
const rowGridSx = {
  display: 'grid',
  gap: 1,
  alignItems: 'stretch',
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr)',
    sm: 'repeat(2, minmax(0, 1fr))',
  },
} as const

/** A weapon type: its weapons, and (passives being per character) whose passives are shown */
export function WeaponGroup({
  type,
  typeName,
  members,
  teamMembers,
  weapons,
  teamData,
  excluded,
  onToggle,
  weaponEnergy,
  setWeaponEnergy,
  virtual = false,
  tooFew,
  sourceOf,
  onRefinement,
  visible,
  selectionCounts,
}: {
  selectionCounts?: { allowed: number; total: number }
  /** Only the first rows are rendered (the rest come in later batches) */
  visible?: number
  /** Weapons that are not the inventory's (KQM mode's): no adding, deleting or wielders */
  virtual?: boolean
  sourceOf?: (weapon: ICachedWeapon) => ReactNode
  onRefinement?: (weapon: ICachedWeapon, refinement: number) => void
  /** The warning when fewer are ticked than members wield the type (default: Team Optimize's) */
  tooFew?: string
  type: WeaponTypeKey
  typeName: ReactNode
  /** The members who wield this type */
  members: TeamOptMember[]
  teamMembers: TeamOptMember[]
  weapons: ICachedWeapon[]
  teamData: TeamData | undefined
  excluded: Set<string>
  onToggle: (weapon: ICachedWeapon) => void
  weaponEnergy: TeamOpt['weaponEnergy']
  setWeaponEnergy: (
    weaponId: string,
    characterKey: CharacterKey,
    value: number
  ) => void
}) {
  const { t } = useTranslation('page_team')
  const ticked =
    selectionCounts?.allowed ??
    weapons.filter((w) => !excluded.has(w.id)).length
  const tooFewTicked = ticked < (virtual ? 1 : members.length)
  return (
    <Box component="section">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          minHeight: 32,
          mb: 1,
        }}
      >
        <ImgIcon size={1.5} src={imgAssets.weaponTypes?.[type]} />
        <Typography component="h3" sx={typo.title}>
          {typeName}
        </Typography>
        {/* the members who wield this type: each weapon's passives are set for each of them */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {members.map((m) => (
            <MemberAvatar
              key={m.characterKey}
              characterKey={m.characterKey}
              size={22}
            />
          ))}
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Typography
          sx={{
            ...typo.label,
            ...numSx,
            color: tooFewTicked ? 'warning.main' : 'text.secondary',
          }}
        >
          {t('teamOpt.weapons.groupCount', {
            defaultValue: '{{allowed}} of {{total}}',
            allowed: ticked,
            total: selectionCounts?.total ?? weapons.length,
          })}
        </Typography>
        {!virtual && <AddWeaponButton type={type} />}
      </Box>
      {tooFewTicked && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 1,
            fontSize: 13,
            color: 'warning.main',
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
          {tooFew ??
            t(
              'teamOpt.weapons.tooFewTicked',
              'Tick one for each member: a member left without one keeps its current weapon.'
            )}
        </Box>
      )}
      <Box sx={rowGridSx}>
        {(visible === undefined ? weapons : weapons.slice(0, visible)).map(
          (weapon) => (
            <WeaponRow
              key={weapon.id}
              weapon={weapon}
              allowed={!excluded.has(weapon.id)}
              onToggle={() => onToggle(weapon)}
              wielders={members}
              teamData={teamData}
              teamMembers={teamMembers}
              energy={weaponEnergy[weapon.id]}
              setEnergy={(characterKey, value) =>
                setWeaponEnergy(weapon.id, characterKey, value)
              }
              virtual={virtual}
              source={sourceOf?.(weapon)}
              onRefinement={
                onRefinement && ((r: number) => onRefinement(weapon, r))
              }
            />
          )
        )}
      </Box>
    </Box>
  )
}

export const isConditional = (
  section: unknown
): section is DocumentConditional =>
  !!section && typeof section === 'object' && 'states' in section

function WeaponRow({
  weapon,
  allowed,
  onToggle,
  wielders,
  teamData,
  teamMembers,
  energy,
  setEnergy,
  virtual = false,
  source,
  onRefinement,
}: {
  virtual?: boolean
  /** Where it comes from (KQM mode's weapons) */
  source?: ReactNode
  /** Its refinement can be chosen (KQM mode's weapons) */
  onRefinement?: (refinement: number) => void
  weapon: ICachedWeapon
  allowed: boolean
  onToggle: () => void
  /** Whose passives are shown */
  /** The members who could wield it: its passives are set for each */
  wielders: TeamOptMember[]
  teamData: TeamData | undefined
  teamMembers: TeamOptMember[]
  /** Per member, how much less Energy Recharge it needs with this weapon in the team */
  energy: Partial<Record<CharacterKey, number>> | undefined
  setEnergy: (characterKey: CharacterKey, value: number) => void
}) {
  const { t } = useTranslation('page_team')
  const nameId = useId()
  const { rarity } = getWeaponStat(weapon.key)
  // what it saves each member's Energy Recharge: opened from its ⚡
  const [energyOpen, setEnergyOpen] = useState(false)
  const passives = useMemo(
    () => (getWeaponSheet(weapon.key)?.document ?? []).filter(isConditional),
    [weapon.key]
  )
  const energySet = teamMembers.filter(
    ({ characterKey }) => (energy?.[characterKey] ?? 0) > 0
  )
  const isEnergy = isEnergyWeapon(weapon.key) || !!energySet.length
  const rowIcon = {
    color: 'text.disabled',
    ...quickSx,
    '[data-weapon-id]:hover &, [data-weapon-id]:focus-within &': {
      color: 'text.secondary',
    },
  }
  return (
    <Box
      data-weapon-id={weapon.id}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        borderRadius: tokens.radius.inset,
        bgcolor: tokens.inset,
        border: hairline,
        // (not ticked: quiet, readable again under the pointer)
        opacity: allowed ? 1 : 0.5,
        transition: 'opacity .12s, border-color .12s',
        '&:hover': {
          opacity: allowed ? 1 : 0.85,
          borderColor: alpha(theme.palette.text.primary, 0.14),
        },
        '&:focus-within': { opacity: 1 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 0.75,
          pr: 0.5,
          py: 0.75,
        }}
      >
        <Checkbox
          size="small"
          checked={allowed}
          onChange={onToggle}
          sx={{ p: 0.5 }}
          inputProps={{ 'aria-labelledby': nameId }}
        />
        {/* (its picture and name tick it too) */}
        <Box
          component="img"
          src={weaponAsset(weapon.key, weapon.ascension >= 2)}
          alt=""
          onClick={onToggle}
          className={`grad-${rarity}star`}
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.5,
            flexShrink: 0,
            cursor: 'pointer',
          }}
        />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography
            id={nameId}
            onClick={onToggle}
            sx={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              minWidth: 0,
              cursor: 'pointer',
            }}
            noWrap
          >
            <WeaponName weaponKey={weapon.key} />
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minHeight: 20,
              color: 'text.secondary',
              fontSize: 12.5,
              minWidth: 0,
              ...numSx,
            }}
          >
            {onRefinement ? (
              <Box
                component="span"
                sx={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Select
                  variant="standard"
                  disableUnderline
                  value={weapon.refinement}
                  onChange={(e) => onRefinement(Number(e.target.value))}
                  inputProps={{
                    'aria-label': t('teamOpt.kqm.refinement', 'Refinement'),
                  }}
                  sx={{
                    fontSize: 12.5,
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {[1, 2, 3, 4, 5].map((r) => (
                    <MenuItem key={r} value={r}>
                      R{r}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            ) : (
              <Box component="span" sx={{ flexShrink: 0 }}>
                {t('teamOpt.weapons.levelRef', {
                  defaultValue: 'Lv. {{level}} · R{{refinement}}',
                  level: weapon.level,
                  refinement: weapon.refinement,
                })}
              </Box>
            )}
            {source && (
              <Box component="span" sx={{ flexShrink: 0 }}>
                · {source}
              </Box>
            )}
            {/* (on this line, so that the name keeps its room) */}
            {isEnergy && (
              <EnergyTag
                members={energySet}
                energy={energy}
                open={energyOpen}
                onClick={() => setEnergyOpen((o) => !o)}
              />
            )}
            {weapon.location && !virtual && (
              <>
                <span>·</span>
                <WielderButton weapon={weapon} />
              </>
            )}
          </Box>
        </Box>
        {!virtual && <RemoveWeaponButton weapon={weapon} iconSx={rowIcon} />}
        {!isEnergy && (
          <Tooltip
            arrow
            title={t(
              'teamOpt.weapons.energyAdd',
              'Gives energy: set how much less Energy Recharge each member needs'
            )}
          >
            <IconButton
              size="small"
              onClick={() => setEnergyOpen((o) => !o)}
              aria-expanded={energyOpen}
              aria-label={t('teamOpt.weapons.energy', 'Energy')}
              sx={{
                ...rowIcon,
                ...(energyOpen && { color: 'text.primary' }),
                '&:hover': { color: 'text.primary' },
              }}
            >
              <BoltIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {/* (on every card, so that cards side by side line up) */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          px: 1.5,
          py: 0.5,
          borderTop: hairline,
        }}
      >
        <PassiveLines
          weaponKey={weapon.key}
          passives={passives}
          wielders={wielders}
          data={wielders[0] && teamData?.[wielders[0].characterKey]?.target}
        />
      </Box>
      <Collapse in={energyOpen} timeout={180} unmountOnExit>
        <Box sx={{ px: 1.5, py: 1, borderTop: hairline }}>
          <TeamEnergy
            members={teamMembers}
            energy={energy}
            setEnergy={setEnergy}
          />
        </Box>
      </Collapse>
    </Box>
  )
}

/** An energy weapon's tag: what it saves each member (if set), opening its settings */
function EnergyTag({
  members,
  energy,
  open,
  onClick,
}: {
  /** The members it saves Energy Recharge */
  members: TeamOptMember[]
  energy: Partial<Record<CharacterKey, number>> | undefined
  /** Its settings are open */
  open?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      arrow
      title={
        members.length
          ? t(
              'teamOpt.weapons.energySetHint',
              'Less Energy Recharge each member needs while someone in the team wields it. Click to change.'
            )
          : t(
              'teamOpt.weapons.energyHint',
              'Gives energy or particles: click to set how much less Energy Recharge each member needs with it in the team.'
            )
      }
    >
      <ButtonBase
        onClick={onClick}
        aria-expanded={open}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 20,
          px: 0.75,
          borderRadius: 1,
          fontSize: 12,
          fontWeight: 600,
          ...numSx,
          color: members.length || open ? 'text.primary' : 'text.secondary',
          backgroundColor: alpha(
            theme.palette.text.primary,
            open ? 0.12 : 0.07
          ),
          flexShrink: 0,
          ...quickSx,
          ...focusSx,
          '&:hover': {
            color: 'text.primary',
            backgroundColor: alpha(theme.palette.text.primary, 0.12),
          },
        })}
      >
        <BoltIcon sx={{ fontSize: 13 }} />
        {members.length
          ? members.map(({ characterKey }) => (
              <Box
                key={characterKey}
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
              >
                <MemberAvatar characterKey={characterKey} size={14} />
                {`−${energy?.[characterKey]}`}
              </Box>
            ))
          : t('teamOpt.weapons.energy', 'Energy')}
      </ButtonBase>
    </Tooltip>
  )
}

/**
 * What an energy weapon saves each member: its particles or energy reach the whole team, each
 * member differently, so each gets its own Energy Recharge requirement reduction. One compact line
 * (the explanation is on hover).
 */
function TeamEnergy({
  members,
  energy,
  setEnergy,
}: {
  members: TeamOptMember[]
  energy: Partial<Record<CharacterKey, number>> | undefined
  setEnergy: (characterKey: CharacterKey, value: number) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1.5,
        rowGap: 0.75,
      }}
    >
      <FieldLabel
        tip={t(
          'teamOpt.weapons.teamEnergyHint',
          'How much less Energy Recharge each member needs while someone in the team wields this weapon.'
        )}
      >
        {t('teamOpt.weapons.teamEnergy', 'ER needed')}
      </FieldLabel>
      {members.map((member) => (
        <MemberEnergy
          key={member.characterKey}
          member={member}
          value={energy?.[member.characterKey] ?? 0}
          setValue={(value) => setEnergy(member.characterKey, value)}
        />
      ))}
    </Box>
  )
}

/** A member's avatar and how much less Energy Recharge it needs (dim: it has no ER requirement) */
function MemberEnergy({
  member: { characterKey, teamChar },
  value,
  setValue,
}: {
  member: TeamOptMember
  value: number
  setValue: (value: number) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  // without an Energy Recharge requirement, the value has nothing to lower (yet)
  const needsEnergy = hasEnergyRequirement(
    useOptConfig(teamChar.optConfigId)?.statFilters
  )
  return (
    <Box
      component="label"
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Tooltip
        title={
          <>
            <CharacterName characterKey={characterKey} gender={gender} />
            {!needsEnergy &&
              t(
                'teamOpt.weapons.noEnergyNeedHint',
                ': no Energy Recharge requirement, so this changes nothing yet'
              )}
          </>
        }
      >
        <Box
          sx={{
            display: 'flex',
            opacity: needsEnergy ? 1 : 0.4,
            filter: needsEnergy ? 'none' : 'grayscale(1)',
          }}
        >
          <MemberAvatar characterKey={characterKey} size={22} />
        </Box>
      </Tooltip>
      <NumberInputLazy
        size="small"
        float
        // typing 20 or -20 both mean 20% less
        value={-value}
        onChange={(v) => setValue(Math.min(Math.abs(v), 500))}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end" sx={{ ml: 0.25 }}>
              %
            </InputAdornment>
          ),
        }}
        inputProps={{
          sx: { width: '2.5em', textAlign: 'right', py: 0.25, pl: 0.75 },
        }}
        sx={{ '& .MuiOutlinedInput-root': { pr: 0.75 } }}
      />
    </Box>
  )
}

/**
 * A weapon's conditional passives, for one member: on only when the user turns them on (some
 * characters cannot trigger some of them). Stored on the member's loadout, like on its pages.
 */
/** A weapon passive's switch: one value at `path`, or one of several states */
type PassiveLine = {
  label: ReactNode
  path: readonly string[]
  /** One state: on or off; several: a choice */
  states: [string, ReactNode][]
}

/**
 * A weapon's passives, one line each: its name, then for each member who could wield it (each sets
 * it apart: one may trigger it and another not) a toggle on its avatar, or its state.
 */
export function PassiveLines({
  weaponKey,
  passives,
  wielders,
  data,
}: {
  /** The weapon's (or artifact set's) key: the passives' paths start with it */
  weaponKey: WeaponKey | string
  passives: DocumentConditional[]
  wielders: TeamOptMember[]
  /** Where states that depend on the character are read */
  data: UIData | undefined
}) {
  const lines = useMemo(() => {
    const out: PassiveLine[] = []
    for (const section of passives) {
      const states =
        typeof section.states === 'function'
          ? data
            ? section.states(data)
            : {}
          : section.states
      const entries = Object.entries(states) as [
        string,
        { name?: ReactNode; path?: readonly string[] },
      ][]
      if ('path' in section && section.path) {
        if (section.path[0] !== weaponKey) continue
        out.push({
          label: section.name,
          path: section.path,
          states: entries.map(([key, state]) => [key, state.name ?? key]),
        })
      } else
        for (const [key, state] of entries)
          if (state.path && state.path[0] === weaponKey)
            out.push({
              label: state.name ?? (section as { name?: ReactNode }).name,
              path: state.path,
              states: [[key, state.name ?? key]],
            })
    }
    return out
  }, [passives, data, weaponKey])
  const { t } = useTranslation('page_team')
  if (!lines.length || !wielders.length)
    return (
      <Typography
        sx={{ fontSize: 13, lineHeight: '32px', color: 'text.disabled' }}
      >
        {t('teamOpt.weapons.noPassive', 'No passive effects')}
      </Typography>
    )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((line) => (
        <Box
          key={line.path.join('.')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.25,
            minHeight: 34,
          }}
        >
          <Typography
            // (the members' switches go under it when they don't fit beside it)
            sx={{
              flex: '1 1 150px',
              minWidth: 0,
              fontSize: 13,
              lineHeight: 1.4,
              color: 'text.secondary',
            }}
          >
            {line.label}
          </Typography>
          {wielders.map((member) =>
            line.states.length <= 1 ? (
              <PassiveAvatarToggle
                key={member.characterKey}
                member={member}
                line={line}
              />
            ) : (
              <PassiveAvatarStates
                key={member.characterKey}
                member={member}
                line={line}
              />
            )
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Where the passive switches read and write: by default the member's loadout conditionals; KQM
 * mode's windows give their own (its settings, over the loadout's and the rule-based ones)
 */
export interface PassiveStore {
  get: (member: TeamOptMember, path: readonly string[]) => string | undefined
  set: (
    member: TeamOptMember,
    path: readonly string[],
    next: string | undefined
  ) => void
}
export const PassiveStoreContext = createContext<PassiveStore | undefined>(
  undefined
)

/** A member's value of a passive (its loadout's conditional), and its setter */
function usePassive(member: TeamOptMember, path: readonly string[]) {
  const database = useDatabase()
  const teamChar = useTeamChar(member.teamCharId)
  const store = useContext(PassiveStoreContext)
  if (store)
    return [
      store.get(member, path),
      (next?: string) => store.set(member, path, next),
    ] as const
  const value = objPathValue(
    (teamChar?.conditional ?? {}) as Record<string, unknown>,
    path as string[]
  ) as string | undefined
  const set = (next?: string) =>
    database.teamChars.set(member.teamCharId, (tc) => {
      const conditional = deepClone(tc.conditional) as Record<string, unknown>
      if (next) layeredAssignment(conditional, path as string[], next)
      else {
        deletePropPath(conditional, path as string[])
        // (no empty weapon entry left behind)
        objClearEmpties(conditional)
      }
      tc.conditional = conditional as typeof tc.conditional
    })
  return [value, set] as const
}

/** A passive on or off for a member: its avatar, lit when on */
function PassiveAvatarToggle({
  member,
  line,
}: {
  member: TeamOptMember
  line: PassiveLine
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [value, set] = usePassive(member, line.path)
  const stateKey = line.states[0]?.[0]
  const on = !!stateKey && value === stateKey
  return (
    <Tooltip
      arrow
      title={
        <>
          <CharacterName characterKey={member.characterKey} gender={gender} />
          {on
            ? t('teamOpt.weapons.passiveOn', ': on')
            : t('teamOpt.weapons.passiveOff', ': off')}
        </>
      }
    >
      <ButtonBase
        onClick={() => set(on ? undefined : stateKey)}
        aria-pressed={on}
        data-member={member.characterKey}
        sx={(theme) => ({
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: '50%',
          border: `1.5px solid ${on ? theme.palette.primary.main : 'transparent'}`,
          backgroundColor: on
            ? alpha(theme.palette.primary.main, 0.16)
            : 'transparent',
          opacity: on ? 1 : 0.4,
          filter: on ? 'none' : 'grayscale(1)',
          transition: 'opacity .12s, border-color .12s, background-color .12s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          '&:hover': { opacity: on ? 1 : 0.8 },
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens.gold}`,
            outlineOffset: 1,
          },
        })}
      >
        <MemberAvatar characterKey={member.characterKey} size={22} />
      </ButtonBase>
    </Tooltip>
  )
}

/** A passive with several states (stacks…) for a member: its avatar and a compact choice */
function PassiveAvatarStates({
  member,
  line,
}: {
  member: TeamOptMember
  line: PassiveLine
}) {
  const { t } = useTranslation('page_team')
  const [value, set] = usePassive(member, line.path)
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        flexShrink: 0,
        opacity: value ? 1 : 0.55,
      }}
    >
      {/* (gray when off, as the on/off avatars) */}
      <Box sx={{ display: 'flex', filter: value ? 'none' : 'grayscale(1)' }}>
        <MemberAvatar characterKey={member.characterKey} size={22} />
      </Box>
      <Select
        variant="standard"
        disableUnderline
        data-member={member.characterKey}
        displayEmpty
        value={value ?? ''}
        onChange={(e) => set((e.target.value as string) || undefined)}
        sx={{
          fontSize: 13,
          minWidth: 48,
          color: value ? 'text.primary' : 'text.secondary',
          ...quickSx,
          '&:hover': { color: 'text.primary' },
        }}
      >
        <MenuItem value="">{t('teamOpt.weapons.off', 'Off')}</MenuItem>
        {line.states.map(([key, name]) => (
          <MenuItem key={key} value={key}>
            {name}
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}

/**
 * In a weapon type's header: adds a weapon of that type (picked as on the Weapons page), then
 * opens it in the weapon editor for its level and refinement. A new weapon is ticked.
 */
function AddWeaponButton({ type }: { type: WeaponTypeKey }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string>()
  return (
    <>
      <Button
        size="small"
        color="inherit"
        variant="outlined"
        onClick={() => setPicking(true)}
        aria-label={t('teamOpt.weapons.add', 'Add')}
        startIcon={<AddIcon sx={{ fontSize: '16px !important' }} />}
        sx={{
          minHeight: 28,
          py: 0,
          pl: 1,
          pr: 1.25,
          fontSize: 12.5,
          color: 'text.secondary',
          '& .MuiButton-startIcon': { mr: 0.5 },
          '&:hover': { color: 'text.primary' },
        }}
      >
        {t('teamOpt.weapons.add', 'Add')}
      </Button>
      <Suspense fallback={false}>
        <WeaponSelectionModal
          show={picking}
          onHide={() => setPicking(false)}
          weaponTypeFilter={type}
          onSelect={(key) => {
            setPicking(false)
            setEditing(database.weapons.new(initialWeapon(key)))
          }}
        />
      </Suspense>
      {editing && (
        <Suspense fallback={false}>
          <WeaponEditor
            weaponId={editing}
            footer
            onClose={() => setEditing(undefined)}
          />
        </Suspense>
      )}
    </>
  )
}

/**
 * A weapon's wielder: a click lists the weapons of that type to give them another one right here
 * (equipping swaps, as in the game: the other one's wielder, if any, gets this one).
 */
function WielderButton({ weapon }: { weapon: ICachedWeapon }) {
  const { t } = useTranslation('page_team')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const location = weapon.location
  if (!location) return null
  return (
    <>
      <Tooltip arrow title={t('teamOpt.weapons.swap', 'Change weapon')}>
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          sx={(theme) => ({
            minWidth: 0,
            gap: 0.25,
            pl: 0.5,
            pr: 0.25,
            mx: -0.5,
            height: 22,
            borderRadius: 1,
            color: 'inherit',
            ...quickSx,
            ...focusSx,
            '&:hover': {
              color: 'text.primary',
              backgroundColor: alpha(theme.palette.text.primary, 0.07),
            },
          })}
        >
          <LocationName location={location} variant="caption" noWrap />
          <ArrowDropDownIcon sx={{ fontSize: 16, opacity: 0.7 }} />
        </ButtonBase>
      </Tooltip>
      {anchor && (
        <SwapMenu
          anchor={anchor}
          weapon={weapon}
          location={location}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}

/** The weapons of a type, best first: picking one equips it on `location` */
function SwapMenu({
  anchor,
  weapon,
  location,
  onClose,
}: {
  anchor: HTMLElement
  weapon: ICachedWeapon
  location: NonNullable<ICachedWeapon['location']>
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const inventory = useDataManagerValues(database.weapons)
  const type = getWeaponStat(weapon.key).weaponType
  const weapons = useMemo(
    () =>
      inventory
        .filter((w) => getWeaponStat(w.key)?.weaponType === type)
        .sort(
          (a, b) =>
            getWeaponStat(b.key).rarity - getWeaponStat(a.key).rarity ||
            b.level - a.level ||
            b.refinement - a.refinement
        ),
    [inventory, type]
  )
  return (
    <Menu
      open
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{ paper: { sx: { maxHeight: 400, minWidth: 280 } } }}
    >
      {/* (what picking does: whose weapon changes) */}
      <Box
        component="li"
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          pt: 0.5,
          pb: 0.75,
          ...typo.label,
        }}
      >
        {t('teamOpt.weapons.swap', 'Change weapon')}
        {location && (
          <Box component="span" sx={{ color: 'text.primary' }}>
            <CharacterName
              characterKey={database.chars.LocationToCharacterKey(location)}
              gender={gender}
            />
          </Box>
        )}
      </Box>
      {weapons.map((w) => (
        <MenuItem
          key={w.id}
          selected={w.id === weapon.id}
          onClick={() => {
            if (w.id !== weapon.id) database.weapons.set(w.id, { location })
            onClose()
          }}
          sx={{ gap: 1.25, py: 0.75 }}
        >
          <Box
            component="img"
            src={weaponAsset(w.key, w.ascension >= 2)}
            alt=""
            className={`grad-${getWeaponStat(w.key).rarity}star`}
            sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0 }}
          />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              <WeaponName weaponKey={w.key} />
            </Typography>
            <Typography
              component="div"
              sx={{ ...typo.label, ...numSx, fontWeight: 400 }}
            >
              {t('teamOpt.weapons.levelRef', {
                defaultValue: 'Lv. {{level}} · R{{refinement}}',
                level: w.level,
                refinement: w.refinement,
              })}
            </Typography>
          </Box>
          {/* who holds it now: they would get this row's weapon */}
          {w.location && w.id !== weapon.id && (
            <MemberAvatar
              characterKey={database.chars.LocationToCharacterKey(w.location)}
              size={22}
            />
          )}
        </MenuItem>
      ))}
    </Menu>
  )
}

/**
 * Deletes a weapon from the inventory, after asking. Every character holds a weapon: one that is
 * equipped is replaced on its wielder by its type's basic weapon (the dialog says so), and the
 * basic weapon itself, equipped, cannot be deleted (it would only come back).
 */
function RemoveWeaponButton({
  weapon,
  iconSx,
}: {
  weapon: ICachedWeapon
  /** The row's icon colour (quiet until the row is hovered) */
  iconSx?: SxProps<Theme>
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [asking, setAsking] = useState(false)
  const type = getWeaponStat(weapon.key).weaponType
  const replacement = defaultInitialWeaponKey(type)
  const wielder = weapon.location
    ? database.chars.LocationToCharacterKey(weapon.location)
    : undefined
  const wielderName = wielder && (
    <CharacterName characterKey={wielder} gender={gender} />
  )
  const blocked = !!wielder && weapon.key === replacement
  const remove = () => {
    setAsking(false)
    if (weapon.location) {
      // its wielder gets the basic weapon (equipping it unequips this one)
      database.weapons.new({
        ...initialWeapon(replacement),
        location: weapon.location,
      })
    }
    database.weapons.remove(weapon.id)
  }
  return (
    <>
      <Tooltip
        title={
          blocked ? (
            <>
              {t('teamOpt.weapons.deleteHeld', 'Equipped by')} {wielderName}
              {t(
                'teamOpt.weapons.deleteHeldHint',
                ': give them another weapon first'
              )}
            </>
          ) : (
            t('teamOpt.weapons.delete', 'Delete')
          )
        }
      >
        {/* (a span: a disabled button gets no hover) */}
        <span>
          <IconButton
            size="small"
            disabled={blocked}
            onClick={() => setAsking(true)}
            aria-label={t(
              'teamOpt.weapons.deleteLabel',
              'Delete from inventory'
            )}
            sx={[
              ...(Array.isArray(iconSx) ? iconSx : [iconSx]),
              { '&:hover': { color: 'error.main' } },
            ]}
          >
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        maxWidth="xs"
        fullWidth
        // (over the weapons' dialog: a light backdrop)
        slotProps={stackedBackdrop}
      >
        <DialogTitle sx={{ ...typo.title, fontSize: 16, pb: 0.5 }}>
          {t('teamOpt.weapons.deleteTitle', 'Delete')}{' '}
          <WeaponName weaponKey={weapon.key} />?
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5 }}
          >
            <Box
              component="img"
              src={weaponAsset(weapon.key, weapon.ascension >= 2)}
              alt=""
              className={`grad-${getWeaponStat(weapon.key).rarity}star`}
              sx={{ width: 36, height: 36, borderRadius: 1.5, flexShrink: 0 }}
            />
            <Typography component="div" sx={{ ...typo.label, ...numSx }}>
              {t('teamOpt.weapons.levelRef', {
                defaultValue: 'Lv. {{level}} · R{{refinement}}',
                level: weapon.level,
                refinement: weapon.refinement,
              })}
              {weapon.lock && (
                <Box component="span" sx={{ color: 'warning.main' }}>
                  {' · '}
                  {t('teamOpt.weapons.locked', 'Locked')}
                </Box>
              )}
            </Typography>
          </Box>
          {wielder && (
            <Alert severity="warning" sx={{ mt: 1.5, py: 0.25 }}>
              {t('teamOpt.weapons.deleteEquipped', 'Equipped by')}{' '}
              <strong>{wielderName}</strong>
              {t('teamOpt.weapons.deleteReplaced', ', who gets')}{' '}
              <strong>
                <WeaponName weaponKey={replacement} />
              </strong>{' '}
              {t('teamOpt.weapons.deleteInstead', 'instead.')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 0.5 }}>
          <Button color="inherit" onClick={() => setAsking(false)} autoFocus>
            {t('teamOpt.weapons.deleteCancel', 'Cancel')}
          </Button>
          <Button variant="contained" color="error" onClick={remove}>
            {t('teamOpt.weapons.deleteConfirm', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
