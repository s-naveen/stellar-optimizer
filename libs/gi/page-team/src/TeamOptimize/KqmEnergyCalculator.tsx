import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  calculateEnergyRecharge,
  ENERGY_CALC_SOURCE,
  energyCalcData,
  energyCalcWeapons,
  energySkillConstellation,
  energyWeaponFlat,
  isFavonius,
  kqmMemberConstellation,
  kqmWeapons,
  withFieldTime,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RemoveIcon from '@mui/icons-material/Remove'
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Link,
  MenuItem,
  Select,
  Slider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  Disclosure,
  EmptyLine,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'

type EnergyCalcEstimate = ReturnType<typeof calculateEnergyRecharge>

/**
 * The calculator's ER targets before KQM picks the weapons: Favonius and energy weapon triggers
 * count for a member that may use such a weapon in KQM (the run then counts them per weapon).
 * The members' own equipped weapons play no part: KQM builds use KQM's weapons.
 */
export function kqmEnergyEstimate(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  kqm: TeamOptKqm | undefined
) {
  const { weapons, refinements } = energyCalcWeapons(keys, settings, (key) =>
    kqmWeapons(key, kqm)
  )
  return calculateEnergyRecharge(keys, settings, weapons, refinements)
}

/**
 * The KQM ER calculator: what each member needs on top (a summary strip), the encounter in one line,
 * then one block per member — its skill, how often its burst is used and its time on the field, the
 * rest folded away. The numbers follow ERC 7.3.
 */
export function KqmEnergyCalculator({
  members,
  kqm,
  settings,
  setSettings,
}: {
  members: TeamOptMember[]
  /** KQM's settings: the members' constellations and the weapons they may use */
  kqm: TeamOptKqm | undefined
  settings: TeamOptEnergyCalculator
  setSettings: (
    update: (previous: TeamOptEnergyCalculator) => TeamOptEnergyCalculator
  ) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const [optionsOpen, setOptionsOpen] = useState(false)
  const keys = members.map((m) => m.characterKey)
  const estimate = useMemo(
    () =>
      kqmEnergyEstimate(
        members.map((m) => m.characterKey),
        settings,
        kqm
      ),
    [members, settings, kqm]
  )
  const updateMember = (
    key: CharacterKey,
    values: Partial<TeamOptEnergyMember>
  ) =>
    setSettings((previous) => {
      const { fieldTime, ...rest } = values
      const next = {
        ...previous,
        members: {
          ...previous.members,
          [key]: { ...previous.members[key]!, ...rest },
        },
      }
      // Keep the full rotation assigned while someone adjusts a character's field time.
      return fieldTime === undefined
        ? next
        : withFieldTime(next, keys, key, fieldTime)
    })
  const rngName = (rng: TeamOptEnergyCalculator['rng']) =>
    t(
      `teamOpt.kqm.calc.${rng}`,
      { average: 'Average', safe: 'Safe', worst: 'Worst case' }[rng]
    )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* what each member needs: the answer first (a tile opens its member) */}
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: `repeat(${Math.min(4, Math.max(1, members.length))}, minmax(0, 1fr))`,
          },
        }}
      >
        {members.map(({ characterKey }) => (
          <NeedTile
            key={characterKey}
            characterKey={characterKey}
            estimate={estimate}
            onClick={() =>
              document
                .getElementById(`er-member-${characterKey}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          />
        ))}
      </Box>

      {/* the encounter, in one line (its settings open under it); the data's source */}
      <Box
        sx={{
          ...insetSx,
          px: { xs: 1.25, sm: 1.5 },
          py: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Disclosure
            label={t('teamOpt.kqm.calc.encounter', 'Encounter')}
            info={t(
              'teamOpt.kqm.calc.globalHelp',
              'Enemy clear particles are the total neutral particles dropped over the chamber clear time. Electro resonance particles require two Electro teammates; their interval is at least 5 seconds.'
            )}
            open={optionsOpen}
            onToggle={() => setOptionsOpen((value) => !value)}
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Box
              sx={{
                display: 'grid',
                gap: 1.25,
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(4, minmax(0, 1fr))',
                },
                pt: 0.5,
                pb: 0.25,
              }}
            >
              <LabelledField label={t('teamOpt.kqm.calc.clear', 'Clear time')}>
                <NumberField
                  value={settings.clearTime}
                  unit="s"
                  min={0.1}
                  ariaLabel={t('teamOpt.kqm.calc.clear', 'Clear time')}
                  onChange={(clearTime) =>
                    setSettings((s) => ({ ...s, clearTime }))
                  }
                />
              </LabelledField>
              <LabelledField
                label={t('teamOpt.kqm.calc.enemy', 'Enemy particles')}
              >
                <NumberField
                  value={settings.enemyParticles}
                  ariaLabel={t('teamOpt.kqm.calc.enemy', 'Enemy particles')}
                  onChange={(enemyParticles) =>
                    setSettings((s) => ({ ...s, enemyParticles }))
                  }
                />
              </LabelledField>
              <LabelledField label={t('teamOpt.kqm.calc.rng', 'Particle RNG')}>
                <Select
                  size="small"
                  value={settings.rng}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      rng: e.target.value as TeamOptEnergyCalculator['rng'],
                    }))
                  }
                  inputProps={{
                    'aria-label': t('teamOpt.kqm.calc.rng', 'Particle RNG'),
                  }}
                  sx={selectSx}
                >
                  {(['average', 'safe', 'worst'] as const).map((value) => (
                    <MenuItem key={value} value={value}>
                      {rngName(value)}
                    </MenuItem>
                  ))}
                </Select>
              </LabelledField>
              <LabelledField
                label={t('teamOpt.kqm.calc.electro', 'Electro interval')}
              >
                <NumberField
                  value={settings.electroInterval}
                  unit="s"
                  ariaLabel={t('teamOpt.kqm.calc.electro', 'Electro interval')}
                  onChange={(electroInterval) =>
                    setSettings((s) => ({ ...s, electroInterval }))
                  }
                />
              </LabelledField>
            </Box>
          </Disclosure>
          {!optionsOpen && (
            <Typography
              noWrap
              sx={{
                ...type.label,
                display: { xs: 'none', sm: 'block' },
                minWidth: 0,
                ...numSx,
              }}
            >
              {t('teamOpt.kqm.calc.encounterSummary', {
                defaultValue:
                  'Clear {{clear}} s · {{enemy}} enemy particles · {{rng}}',
                clear: +settings.clearTime.toFixed(1),
                enemy: +settings.enemyParticles.toFixed(1),
                rng: rngName(settings.rng),
              })}
            </Typography>
          )}
          <Link
            href={ENERGY_CALC_SOURCE}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            sx={{
              alignSelf: 'flex-start',
              mt: 0.625,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              fontSize: 12.5,
              color: 'text.secondary',
              ...quickSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            ERC 7.3 <OpenInNewIcon sx={{ fontSize: 13 }} />
          </Link>
        </Box>
      </Box>

      {/* each member: its skill, its burst, its field time; the rest folded */}
      <Box sx={{ ...insetSx, overflow: 'hidden' }}>
        {members.map(({ characterKey }, index) => (
          <MemberEnergy
            key={characterKey}
            characterKey={characterKey}
            first={index === 0}
            keys={keys}
            kqm={kqm}
            member={settings.members[characterKey]}
            estimate={estimate}
            updateMember={updateMember}
          />
        ))}
      </Box>
    </Box>
  )
}

/** A member's needed Energy Recharge, as a tile of the summary */
function NeedTile({
  characterKey,
  estimate,
  onClick,
}: {
  characterKey: CharacterKey
  estimate: EnergyCalcEstimate
  onClick: () => void
}) {
  const { gender } = useDBMeta()
  // (the target as applied: the required ER rounded up to 0.1%)
  const required = estimate.targets[characterKey]
  return (
    <ButtonBase
      onClick={onClick}
      sx={(theme) => ({
        ...insetSx,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1,
        px: 1.25,
        py: 1,
        textAlign: 'left',
        minWidth: 0,
        ...quickSx,
        ...focusSx,
        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) },
      })}
    >
      <MemberAvatar characterKey={characterKey} size={30} />
      <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
        <Typography noWrap sx={{ ...type.label, fontSize: 12 }}>
          <CharacterName characterKey={characterKey} gender={gender} />
        </Typography>
        <Typography
          sx={{
            ...type.stat,
            color: required !== undefined ? 'text.primary' : 'text.secondary',
          }}
        >
          {required !== undefined ? `${required}%` : '—'}
          <Box component="span" sx={{ ...type.label, fontSize: 11.5, ml: 0.5 }}>
            ER
          </Box>
        </Typography>
      </Box>
    </ButtonBase>
  )
}

/** One member's energy: skill and uses, burst, field time, then its details folded */
function MemberEnergy({
  characterKey,
  first,
  keys,
  kqm,
  member,
  estimate,
  updateMember,
}: {
  characterKey: CharacterKey
  first: boolean
  keys: CharacterKey[]
  kqm: TeamOptKqm | undefined
  member: TeamOptEnergyMember | undefined
  estimate: EnergyCalcEstimate
  updateMember: (
    key: CharacterKey,
    values: Partial<TeamOptEnergyMember>
  ) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
  const data = energyCalcData[characterKey]
  const name = t(`charNames_gen:${characterKey}`, characterKey)
  if (!member || !data)
    return (
      <Box sx={{ p: 1.25, borderTop: first ? undefined : hairline }}>
        <EmptyLine sx={{ minHeight: 48 }}>
          <MemberAvatar characterKey={characterKey} size={24} />
          {name}: {t('teamOpt.kqm.calc.noData', 'Use a manual ER target.')}
        </EmptyLine>
      </Box>
    )
  const er = estimate.members[characterKey]
  const required = estimate.targets[characterKey]
  const cons = kqmMemberConstellation(characterKey, kqm)
  // the skill's ways (above the KQM build's constellation left out, unless chosen), each with its particles
  const skillOptions = data.skills
    .map((skill, index) => ({ skill, index }))
    .filter(
      ({ skill, index }) =>
        energySkillConstellation(skill.label) <= cons ||
        index === member.skillMode ||
        index === member.secondaryMode
    )
  // Favonius and energy weapon triggers count only with such a weapon, which KQM picks from these
  const allowedWeapons = kqmWeapons(characterKey, kqm)
  const noFavonius =
    member.favoniusProcs > 0 && !allowedWeapons.some((w) => isFavonius(w.key))
  const noEnergyWeapon =
    (member.weaponEnergyTriggers ?? 0) > 0 &&
    !allowedWeapons.some((w) => energyWeaponFlat(w.key) > 0)
  const particles = (skill: (typeof data.skills)[number]) =>
    skill.perSecond > 0
      ? t('teamOpt.kqm.calc.perSecond', {
          defaultValue: '{{value}} particles/s',
          value: skill.perSecond,
        })
      : skill.particles === 1
        ? t('teamOpt.kqm.calc.perUseOne', '1 particle')
        : t('teamOpt.kqm.calc.perUse', {
            defaultValue: '{{value}} particles',
            value: skill.particles,
          })
  const modeSelect = (secondary: boolean) => (
    <Select
      size="small"
      fullWidth
      value={secondary ? member.secondaryMode : member.skillMode}
      onChange={(e) =>
        updateMember(characterKey, {
          [secondary ? 'secondaryMode' : 'skillMode']: Number(e.target.value),
        })
      }
      inputProps={{
        'aria-label': `${name}: ${
          secondary
            ? t('teamOpt.kqm.calc.secondary', 'Second skill')
            : t('teamOpt.kqm.calc.skill', 'Skill')
        }`,
      }}
      renderValue={(value) => {
        const skill = data.skills[value as number]
        return skill ? (
          <Box
            component="span"
            sx={{
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
              alignItems: 'baseline',
            }}
          >
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {skill.label}
            </Box>
            <Box
              component="span"
              sx={{
                ...type.label,
                fontSize: 12,
                flexShrink: 0,
                display: { xs: 'none', sm: 'inline' },
                ...numSx,
              }}
            >
              {particles(skill)}
            </Box>
          </Box>
        ) : (
          ''
        )
      }}
      sx={selectSx}
    >
      {skillOptions.map(({ skill, index }) => (
        <MenuItem
          key={skill.label}
          value={index}
          sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
        >
          <span>{skill.label}</span>
          <Box component="span" sx={{ ...type.label, fontSize: 12, ...numSx }}>
            {particles(skill)}
          </Box>
        </MenuItem>
      ))}
    </Select>
  )
  const catcherSelect = (favonius: boolean) => (
    <Select
      size="small"
      fullWidth
      value={
        (favonius ? member.favoniusCatchBy : member.catchBy) ?? characterKey
      }
      onChange={(e) =>
        updateMember(characterKey, {
          [favonius ? 'favoniusCatchBy' : 'catchBy']: e.target
            .value as CharacterKey,
        })
      }
      inputProps={{
        'aria-label': `${name}: ${
          favonius
            ? t('teamOpt.kqm.calc.favCatcher', 'Favonius catcher')
            : t('teamOpt.kqm.calc.catcher', 'Particle catcher')
        }`,
      }}
      sx={selectSx}
    >
      {keys.map((key) => (
        <MenuItem key={key} value={key}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MemberAvatar characterKey={key} size={20} />
            <CharacterName characterKey={key} gender={gender} />
          </Box>
        </MenuItem>
      ))}
    </Select>
  )
  const burstOptions = [
    { value: 1, label: t('teamOpt.kqm.calc.burstEvery1', 'Every') },
    {
      value: 2,
      label: phone
        ? t('teamOpt.kqm.calc.burstEvery2Short', '2nd')
        : t('teamOpt.kqm.calc.burstEvery2', 'Every 2nd'),
    },
    {
      value: 3,
      label: phone
        ? t('teamOpt.kqm.calc.burstEvery3Short', '3rd')
        : t('teamOpt.kqm.calc.burstEvery3', 'Every 3rd'),
    },
    {
      value: 0,
      label: phone
        ? t('teamOpt.kqm.calc.unusedShort', 'Off')
        : t('teamOpt.kqm.calc.unused', 'Unused'),
    },
    ...([0, 1, 2, 3].includes(member.burstEvery)
      ? []
      : [
          {
            value: member.burstEvery,
            label: t('teamOpt.kqm.calc.burstEveryN', {
              defaultValue: 'Every {{n}}th',
              n: member.burstEvery,
            }),
          },
        ]),
  ]
  const detailsSummary = er
    ? t('teamOpt.kqm.calc.detailsSummary', {
        defaultValue:
          '{{particles}} particle energy · {{flat}} bonus · burst {{cost}}',
        particles: +er.particleEnergy.toFixed(1),
        flat: +er.flatEnergy.toFixed(1),
        cost: +er.burstCost.toFixed(1),
      })
    : undefined

  return (
    <Box
      id={`er-member-${characterKey}`}
      sx={{
        px: { xs: 1.25, sm: 1.75 },
        py: 1.5,
        borderTop: first ? undefined : hairline,
        scrollMarginTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {/* who, and what it needs */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <MemberAvatar characterKey={characterKey} size={32} />
        <Typography sx={{ ...type.title, flex: 1, minWidth: 0 }} noWrap>
          <CharacterName characterKey={characterKey} gender={gender} />
        </Typography>
        <Tooltip
          arrow
          title={
            er
              ? t('teamOpt.kqm.calc.breakdown', {
                  defaultValue:
                    '{{particles}} particle energy at 100% ER + {{flat}} flat energy per rotation; burst cost {{cost}}.',
                  particles: +er.particleEnergy.toFixed(1),
                  flat: +er.flatEnergy.toFixed(1),
                  cost: +er.burstCost.toFixed(1),
                })
              : ''
          }
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 0.75,
              cursor: er ? 'help' : undefined,
            }}
          >
            <Typography sx={{ ...type.label, fontSize: 12 }}>
              {t('teamOpt.kqm.calc.needs', 'needs')}
            </Typography>
            <Typography
              sx={{
                ...type.stat,
                fontSize: 20,
                color:
                  required !== undefined ? 'text.primary' : 'text.secondary',
              }}
            >
              {required !== undefined ? `${required}%` : '—'}
            </Typography>
            <Typography sx={{ ...type.label, fontSize: 12 }}>ER</Typography>
          </Box>
        </Tooltip>
      </Box>

      {/* the three settings that matter most, label left, control right */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '76px minmax(0, 1fr)',
            sm: '96px minmax(0, 1fr)',
          },
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 1,
        }}
      >
        <FieldLabel>{t('teamOpt.kqm.calc.skill', 'Skill')}</FieldLabel>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>{modeSelect(false)}</Box>
          <Stepper
            value={member.skillUses}
            onChange={(skillUses) => updateMember(characterKey, { skillUses })}
            ariaLabel={`${name}: ${t('teamOpt.kqm.calc.uses', 'Skill uses')}`}
            prefix="×"
            tip={t('teamOpt.kqm.calc.uses', 'Skill uses')}
          />
        </Box>
        <FieldLabel>{t('teamOpt.kqm.calc.burst', 'Burst')}</FieldLabel>
        <Box sx={{ minWidth: 0, overflowX: 'auto' }}>
          <Segmented
            size="small"
            value={member.burstEvery}
            aria-label={`${name}: ${t('teamOpt.kqm.calc.burst', 'Burst')}`}
            options={burstOptions.map((o) => ({
              value: o.value,
              label: o.label,
              tip:
                o.value === 0
                  ? t('teamOpt.kqm.calc.unusedTip', 'The burst is not used')
                  : t('teamOpt.kqm.calc.burstEveryTip', {
                      defaultValue: 'Burst used every {{n}} rotation(s)',
                      n: o.value,
                    }),
            }))}
            onChange={(burstEvery) =>
              updateMember(characterKey, { burstEvery })
            }
          />
        </Box>
        <FieldLabel
          tip={t(
            'teamOpt.kqm.calc.fieldTimeTip',
            'Share of the rotation this member is on the field (the others share the rest). Turret particles and catching follow it.'
          )}
        >
          {t('teamOpt.kqm.calc.fieldTime', 'Field time')}
        </FieldLabel>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}
        >
          <Slider
            size="small"
            value={Number.isFinite(member.fieldTime) ? member.fieldTime : 0}
            onChange={(_, value) =>
              updateMember(characterKey, { fieldTime: value as number })
            }
            aria-label={`${name}: field time`}
            sx={{ flex: 1, py: 1 }}
          />
          <NumberField
            value={+member.fieldTime.toFixed(1)}
            unit="%"
            width={72}
            ariaLabel={`${name}: ${t('teamOpt.kqm.calc.fieldTime', 'Field time')}`}
            onChange={(fieldTime) => updateMember(characterKey, { fieldTime })}
          />
        </Box>
      </Box>

      {/* the rest (catching, a second skill, Favonius, weapons, bonus energy), folded */}
      <Disclosure
        label={t('teamOpt.kqm.calc.more', 'More')}
        info={t(
          'teamOpt.kqm.calc.memberHelp',
          'Set rotations per burst to 0 if the burst is unused. Turret particles are distributed by field time. Confirm any energy refunds from character passives in Bonus flat energy.'
        )}
        open={detailsOpen}
        onToggle={() => setDetailsOpen((o) => !o)}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
            },
          }}
        >
          <LabelledField
            label={t('teamOpt.kqm.calc.catcher', 'Particle catcher')}
          >
            {catcherSelect(false)}
          </LabelledField>
          <LabelledField label={t('teamOpt.kqm.calc.feed', 'Fed to catcher')}>
            <NumberField
              value={member.funnelShare}
              unit="%"
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.feed', 'Fed to catcher')}`}
              onChange={(funnelShare) =>
                updateMember(characterKey, { funnelShare })
              }
            />
          </LabelledField>
          <LabelledField
            label={t('teamOpt.kqm.calc.secondary', 'Second skill')}
          >
            {modeSelect(true)}
          </LabelledField>
          <LabelledField
            label={t('teamOpt.kqm.calc.secondaryUses', 'Second skill uses')}
          >
            <NumberField
              value={member.secondaryUses}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.secondaryUses', 'Second skill uses')}`}
              onChange={(secondaryUses) =>
                updateMember(characterKey, { secondaryUses })
              }
            />
          </LabelledField>
          <LabelledField
            label={t('teamOpt.kqm.calc.favProcs', 'Favonius triggers')}
            tip={t(
              'teamOpt.kqm.calc.favProcsTip',
              'Per rotation, while this member holds a Favonius weapon (KQM counts them for each weapon it tries). Each makes 3 clear particles: 6 Energy for the catcher, less for the others. At most one per 12 s (R1) to 6 s (R5).'
            )}
          >
            <NumberField
              value={member.favoniusProcs}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.favProcs', 'Favonius triggers')}`}
              onChange={(favoniusProcs) =>
                updateMember(characterKey, { favoniusProcs })
              }
            />
            {noFavonius && (
              <WeaponWarning>
                {t(
                  'teamOpt.kqm.calc.noFavonius',
                  'Not counted: no Favonius weapon is selected for this member in Weapons.'
                )}
              </WeaponWarning>
            )}
          </LabelledField>
          <LabelledField
            label={t('teamOpt.kqm.calc.favCatcher', 'Favonius catcher')}
          >
            {catcherSelect(true)}
          </LabelledField>
          <LabelledField
            label={t(
              'teamOpt.kqm.calc.weaponTriggers',
              'Energy weapon triggers'
            )}
            tip={t(
              'teamOpt.kqm.calc.weaponTriggersTip',
              'Per rotation, while this member holds Amenoma Kageuchi, Katsuragikiri Nagamasa, Kitain Cross Spear, Prototype Amber or Everlasting Moonglow; the energy follows the weapon and its refinement.'
            )}
          >
            <NumberField
              value={member.weaponEnergyTriggers ?? 0}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.weaponTriggers', 'Energy weapon triggers')}`}
              onChange={(weaponEnergyTriggers) =>
                updateMember(characterKey, { weaponEnergyTriggers })
              }
            />
            {noEnergyWeapon && (
              <WeaponWarning>
                {t(
                  'teamOpt.kqm.calc.noEnergyWeapon',
                  'Not counted: no energy weapon is selected for this member in Weapons.'
                )}
              </WeaponWarning>
            )}
          </LabelledField>
          <LabelledField
            label={t('teamOpt.kqm.calc.flat', 'Bonus energy')}
            tip={t(
              'teamOpt.kqm.calc.flatTip',
              'Energy per rotation from character abilities or effects shared by every build.'
            )}
          >
            <NumberField
              value={member.flatEnergy}
              min={Number.NEGATIVE_INFINITY}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.flat', 'Bonus energy')}`}
              onChange={(flatEnergy) =>
                updateMember(characterKey, { flatEnergy })
              }
            />
          </LabelledField>
        </Box>
      </Disclosure>
      {!detailsOpen && detailsSummary && (
        <Typography
          sx={{ ...type.label, fontSize: 12, mt: -1, pl: 3, ...numSx }}
        >
          {detailsSummary}
        </Typography>
      )}
    </Box>
  )
}

/** A label above a control */
function LabelledField({
  label,
  tip,
  children,
}: {
  label: string
  tip?: string
  children: ReactNode
}) {
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
    >
      <FieldLabel tip={tip} sx={{ fontSize: 12 }}>
        {label}
      </FieldLabel>
      {children}
    </Box>
  )
}

/** Why a weapon input does not count (under the input) */
function WeaponWarning({ children }: { children: ReactNode }) {
  return (
    <Typography
      role="status"
      sx={{ fontSize: 12, lineHeight: 1.35, color: 'warning.main' }}
    >
      {children}
    </Typography>
  )
}

/** The compact controls' look: 32 px, a hairline, gold when focused */
const controlSx = (theme: Theme) => ({
  height: 32,
  borderRadius: tokens.radius.control,
  fontSize: 13.5,
  bgcolor: alpha(theme.palette.text.primary, 0.03),
  boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
  ...quickSx,
  '&:hover': {
    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.28)}`,
  },
  '&.Mui-focused': {
    boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}, 0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
  },
  '&.Mui-error': { boxShadow: `inset 0 0 0 1px ${theme.palette.error.main}` },
})
const selectSx = (theme: Theme) => ({
  ...controlSx(theme),
  '& .MuiOutlinedInput-notchedOutline': { border: 0 },
  '& .MuiSelect-select': {
    py: 0,
    pl: 1.25,
    display: 'flex',
    alignItems: 'center',
  },
})

/** A number typed in (committed as typed; red while it is not a number) */
function NumberField({
  value,
  onChange,
  unit,
  min = 0,
  ariaLabel,
  width,
}: {
  value: number
  onChange: (value: number) => void
  unit?: string
  min?: number
  ariaLabel: string
  width?: number
}) {
  const [text, setText] = useState(() =>
    Number.isFinite(value) ? `${+value.toFixed(4)}` : ''
  )
  useEffect(
    () => setText(Number.isFinite(value) ? `${+value.toFixed(4)}` : ''),
    [value]
  )
  return (
    <InputBase
      value={text}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        onChange(next.trim() ? Number(next.replace(',', '.')) : Number.NaN)
      }}
      error={!Number.isFinite(value) || value < min}
      inputProps={{
        inputMode: 'decimal',
        'aria-label': ariaLabel,
        style: { textAlign: 'right' },
      }}
      endAdornment={
        unit ? (
          <Box component="span" sx={{ ...type.label, fontSize: 12, ml: 0.5 }}>
            {unit}
          </Box>
        ) : undefined
      }
      sx={(theme) => ({
        ...controlSx(theme),
        px: 1.25,
        width: width ?? '100%',
        flexShrink: 0,
        ...numSx,
      })}
    />
  )
}

/** A count with − and + (whole steps; typing any number works too) */
function Stepper({
  value,
  onChange,
  ariaLabel,
  prefix,
  tip,
}: {
  value: number
  onChange: (value: number) => void
  ariaLabel: string
  prefix?: string
  tip?: string
}) {
  const [text, setText] = useState(`${+value.toFixed(2)}`)
  useEffect(() => setText(`${+value.toFixed(2)}`), [value])
  const step = (d: number) =>
    onChange(Math.max(0, Math.round((value + d) * 100) / 100))
  const button = (d: number, icon: ReactNode, label: string) => (
    <IconButton
      size="small"
      aria-label={label}
      onClick={() => step(d)}
      disabled={d < 0 && value <= 0}
      sx={{
        p: 0.375,
        borderRadius: 1,
        color: 'text.secondary',
        '&:hover': { color: 'text.primary' },
      }}
    >
      {icon}
    </IconButton>
  )
  const control = (
    <Box
      sx={(theme) => ({
        ...controlSx(theme),
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.25,
        flexShrink: 0,
        '&:focus-within': {
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}, 0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
        },
      })}
    >
      {button(-1, <RemoveIcon sx={{ fontSize: 16 }} />, `${ariaLabel} −1`)}
      <InputBase
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value.replace(',', '.'))
          if (e.target.value.trim() && Number.isFinite(n) && n >= 0) onChange(n)
        }}
        onBlur={() => setText(`${+value.toFixed(2)}`)}
        inputProps={{
          inputMode: 'decimal',
          'aria-label': ariaLabel,
          style: { textAlign: 'center', padding: 0 },
        }}
        startAdornment={
          prefix ? (
            <Box
              component="span"
              sx={{ ...type.label, fontSize: 12, mr: 0.25 }}
            >
              {prefix}
            </Box>
          ) : undefined
        }
        sx={{ width: 44, fontSize: 13.5, fontWeight: 600, ...numSx }}
      />
      {button(1, <AddIcon sx={{ fontSize: 16 }} />, `${ariaLabel} +1`)}
    </Box>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      {control}
    </Tooltip>
  ) : (
    control
  )
}
