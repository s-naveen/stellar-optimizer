import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { objPathValue } from '@genshin-optimizer/common/util'
import { artifactAsset } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
  WeaponTypeKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ICachedWeapon,
  TeamOpt,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { getArtSheet } from '@genshin-optimizer/gi/sheets'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import type {
  KqmWeaponGroup,
  KqmWeaponSource,
  TeamData,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  ArtifactSetTooltip,
  KQM_WEAPON_LIST,
  kqmDefaultExcludedWeapons,
  kqmEnergyRelief,
  kqmExcludedWeapons,
  kqmGroupRefinementKey,
  kqmRuleConditionals,
  kqmSets,
  kqmWeaponGroup,
  kqmWeaponSource,
  kqmWeapons,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Checkbox,
  Divider,
  IconButton,
  InputAdornment,
  Skeleton,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  EmptyLine,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  Pill,
  quickSx,
  Segmented,
  tokens,
  type as typeScale,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'
import type { PassiveStore } from './WeaponChooser'
import {
  isConditional,
  PassiveLines,
  PassiveStoreContext,
  WeaponGroup,
} from './WeaponChooser'

/**
 * KQM mode's passive switches: its own setting for the member if there is one (`''`: off), else
 * the member's loadout conditional, else the rule-based state (what a run counts). A switch writes
 * KQM mode's setting, never the loadout's.
 */
function useKqmPassiveStore(
  teamId: string,
  teamOpt: TeamOpt,
  setTeamOpt: (update: TeamOptUpdate) => void
): PassiveStore {
  const database = useDatabase()
  const { attacks } = teamOpt
  // (the rules follow the rotation and the members)
  const rules = useMemo(
    () => kqmRuleConditionals(database, teamId, { attacks }),
    [database, teamId, attacks]
  )
  return useMemo(
    () => ({
      get: (member, path) => {
        const [item, cond] = [path[0], path[path.length - 1]]
        const own = teamOpt.kqm?.passives?.[member.characterKey]?.[item]?.[cond]
        if (own !== undefined) return own || undefined
        const loadout = objPathValue(
          (member.teamChar.conditional ?? {}) as Record<string, unknown>,
          path as string[]
        ) as string | undefined
        if (loadout) return loadout
        return objPathValue(
          (rules[member.characterKey]?.conditional ?? {}) as Record<
            string,
            unknown
          >,
          path as string[]
        ) as string | undefined
      },
      set: (member, path, next) =>
        setTeamOpt((o) => {
          const [item, cond] = [path[0], path[path.length - 1]]
          const kqm = (o.kqm ??= { ...defaultTeamOptKqm })
          const passives = (kqm.passives ??= {})
          const perMember = (passives[member.characterKey] ??= {})
          const perItem = (perMember[item] ??= {})
          perItem[cond] = next ?? ''
        }),
    }),
    [rules, setTeamOpt, teamOpt.kqm?.passives]
  )
}

/** The frame of KQM mode's windows: title, quick picks, then a scrolling body */
function ChooserFrame({
  title,
  picks,
  onClose,
  children,
  embedded = false,
}: {
  embedded?: boolean
  title: ReactNode
  picks: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setReady(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])
  if (embedded)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{picks}</Box>
        <Suspense fallback={<RowsSkeleton />}>
          {ready ? children : <RowsSkeleton />}
        </Suspense>
      </Box>
    )
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      // (over the KQM dialog, already dimmed: a light backdrop)
      slotProps={{
        backdrop: { sx: { backgroundColor: 'rgba(6, 7, 10, 0.3)' } },
      }}
    >
      <CardThemed>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            pt: 2,
            pb: 1.5,
          }}
        >
          <Typography component="h2" sx={{ ...typeScale.title, flexGrow: 1 }}>
            {title}
          </Typography>
          <IconButton
            onClick={onClose}
            aria-label={t('teamOpt.editor.close', 'Close')}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            px: 2.5,
            pb: 1.5,
          }}
        >
          {picks}
        </Box>
        <Divider />
        <Box
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {/* the frame shows at once; the rows (and their weapons' text) fill in right after */}
          <Suspense fallback={<RowsSkeleton />}>
            {ready ? children : <RowsSkeleton />}
          </Suspense>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

const sourceNames: Record<KqmWeaponSource, string> = {
  craft: 'Craftable',
  event: 'Event',
  bp: 'Battle Pass',
  fishing: 'Fishing',
  quest: 'Quest',
  console: 'PlayStation',
  starglitter: 'Starglitter shop',
  standard: 'Standard wish',
  gacha: 'Event wish',
}

/**
 * How many rows to show: the first screenful at once, then a batch more every frame, up to
 * `total` (the drawer opens without rendering rows nobody sees yet). A new `key` (another search)
 * starts over from the first screenful, so a long list never renders in one go.
 */
function useBatches(total: number, batch = 16, first = 6, key = '') {
  const [state, setState] = useState({ key, shown: first })
  // (adjusted while rendering: the new key's first render already shows the first screenful)
  if (state.key !== key) setState({ key, shown: first })
  const shown = state.key === key ? state.shown : first
  useEffect(() => {
    if (shown >= total) return
    const id = requestAnimationFrame(() =>
      startTransition(() =>
        setState((s) => (s.key === key ? { key, shown: s.shown + batch } : s))
      )
    )
    return () => cancelAnimationFrame(id)
  }, [shown, total, batch, key])
  return shown
}

function RowsSkeleton() {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 0.75,
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
        },
      }}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder slots
          key={i}
          variant="rounded"
          height={92}
          sx={{ borderRadius: tokens.radius.inset }}
        />
      ))}
    </Box>
  )
}

const virtualWeapon = (key: WeaponKey, refinement: number): ICachedWeapon => ({
  id: `kqm:${key}`,
  key,
  level: 90,
  ascension: 6,
  refinement: refinement as ICachedWeapon['refinement'],
  location: '',
  lock: false,
})

/**
 * The weapons turned on and off together: Battle Pass, 4★ event wish (and Starglitter shop), 5★
 * standard wish, 5★ event wish;
 * each with how many of its weapons are on and the refinement they count at
 */
function KqmWeaponGroups({
  all,
  excludedKeys,
  teamOpt,
  setTeamOpt,
}: {
  /** The weapons of the team's weapon types */
  all: WeaponKey[]
  excludedKeys: Set<WeaponKey>
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const groups: { group: KqmWeaponGroup; label: string; tip: string }[] = [
    {
      group: 'bp',
      label: t('teamOpt.kqm.groupBp', 'Battle Pass weapons'),
      tip: t(
        'teamOpt.kqm.groupBpTip',
        'The Battle Pass’s weapon choice (Gnostic Hymn). On by default at R1.'
      ),
    },
    {
      group: 'wish4',
      label: t('teamOpt.kqm.groupWish4', '4★ event wish weapons'),
      tip: t(
        'teamOpt.kqm.groupWish4Tip',
        'Only from a weapon banner’s rate-up (event wishes), and the Starglitter shop. Off by default. The standard wish pool’s 4★ (Favonius, Sacrificial…), from any banner, are on at R5.'
      ),
    },
    {
      group: 'standard5',
      label: t('teamOpt.kqm.groupStandard5', '5★ standard wish weapons'),
      tip: t(
        'teamOpt.kqm.groupStandard5Tip',
        'The standard banner’s 5★ (Skyward, Aquila Favonia, Wolf’s Gravestone…). Off by default.'
      ),
    },
    {
      group: 'wish5',
      label: t('teamOpt.kqm.groupWish5', '5★ event wish weapons'),
      tip: t(
        'teamOpt.kqm.groupWish5Tip',
        'Only from a weapon banner’s rate-up (event wishes). Off by default. Free 5★ weapons (Exaiphanes Blade) are always on, at R1.'
      ),
    },
  ]
  const update = (fn: (kqm: TeamOptKqm) => TeamOptKqm) =>
    setTeamOpt((o) => {
      o.kqm = fn(o.kqm ?? defaultTeamOptKqm)
    })
  const shown = groups.flatMap((g) => {
    const keys = all.filter((k) => kqmWeaponGroup(k) === g.group)
    return keys.length ? [{ ...g, keys }] : []
  })
  if (!shown.length) return null
  return (
    <Box sx={{ ...insetSx, overflow: 'hidden' }}>
      {shown.map(({ group, label, tip, keys }, i) => {
        const on = keys.filter((k) => !excludedKeys.has(k)).length
        const all = on === keys.length
        const refinementKey = kqmGroupRefinementKey[group]
        const refinement = kqm[refinementKey] ?? 1
        return (
          <Box
            key={group}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1.5,
              rowGap: 0.75,
              pl: 0.75,
              pr: 1.5,
              py: 0.75,
              borderTop: i ? hairline : undefined,
            }}
          >
            <Switch
              size="small"
              checked={all}
              onChange={() =>
                update((kqm) => {
                  const excluded = kqmExcludedWeapons(kqm)
                  for (const k of keys)
                    if (all) excluded.add(k)
                    else excluded.delete(k)
                  return {
                    ...kqm,
                    excludedWeapons: [...excluded],
                    weaponList: KQM_WEAPON_LIST,
                  }
                })
              }
              inputProps={{ 'aria-label': label }}
            />
            <Box sx={{ flex: '1 1 150px', minWidth: 0 }}>
              <FieldLabel
                tip={tip}
                sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}
              >
                {label}
              </FieldLabel>
              <Typography sx={{ ...typeScale.label, ...numSx }}>
                {t('teamOpt.kqm.groupOn', {
                  defaultValue: '{{on}} of {{count}} on',
                  on,
                  count: keys.length,
                })}
              </Typography>
            </Box>
            <Segmented
              size="small"
              value={refinement}
              aria-label={t('teamOpt.kqm.groupRefinement', {
                defaultValue: '{{group}} refinement',
                group: label,
              })}
              options={[1, 2, 3, 4, 5].map((r) => ({
                value: r,
                label: `R${r}`,
              }))}
              onChange={(value) =>
                update((kqm) => {
                  // (the group's weapons all at it: their own refinements are cleared)
                  const refinements = { ...(kqm.refinements ?? {}) }
                  for (const k of keys) delete refinements[k]
                  return {
                    ...kqm,
                    [refinementKey]: value,
                    refinements: Object.keys(refinements).length
                      ? refinements
                      : undefined,
                  }
                })
              }
            />
          </Box>
        )
      })}
    </Box>
  )
}

/** KQM mode's weapons: which may be chosen, their passives per member, what energy they give */
export function KqmWeaponChooser({
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  onClose,
  embedded = false,
}: {
  embedded?: boolean
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['page_team', 'page_weapon', 'weaponNames_gen'])
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const store = useKqmPassiveStore(teamId, teamOpt, setTeamOpt)
  const optimized = members
  const groups = useMemo(() => {
    const byType = new Map<WeaponTypeKey, TeamOptMember[]>()
    for (const m of optimized) {
      const type = getCharWeaponType(m.characterKey)
      byType.set(type, [...(byType.get(type) ?? []), m])
    }
    return [...byType].map(([type, wielders]) => ({
      type,
      members: wielders,
      weapons: kqmWeapons(wielders[0].characterKey, kqm, { all: true }).map(
        (w) => virtualWeapon(w.key, w.refinement)
      ),
    }))
  }, [optimized, kqm])
  const all = useMemo(
    () => groups.flatMap((g) => g.weapons.map((w) => w.key)),
    [groups]
  )
  const excludedKeys = useMemo(() => kqmExcludedWeapons(kqm), [kqm])
  const excluded = useMemo(
    () => new Set([...excludedKeys].map((key) => `kqm:${key}`)),
    [excludedKeys]
  )
  // Typing only updates the field: the list follows the deferred query, in the background
  const query = useDeferredValue(search).trim().toLocaleLowerCase()
  // each weapon's searchable text (name, key, source), made once
  const searchText = useMemo(
    () =>
      new Map(
        groups.flatMap((g) =>
          g.weapons.map((w) => [
            w.id,
            `${t(`weaponNames_gen:${w.key}`, w.key)} ${w.key} ${sourceNames[kqmWeaponSource(w.key)]}`.toLocaleLowerCase(),
          ])
        )
      ),
    [groups, t]
  )
  const filteredGroups = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        filtered: g.weapons.filter(
          (w) =>
            (!selectedOnly || !excluded.has(w.id)) &&
            (!query || !!searchText.get(w.id)?.includes(query))
        ),
      })),
    [groups, selectedOnly, excluded, query, searchText]
  )
  // (a new search shows its matches in batches too, from the first screenful)
  const shown = useBatches(
    filteredGroups.reduce((n, g) => n + g.filtered.length, 0),
    16,
    6,
    `${query}|${selectedOnly}`
  )
  // per weapon, what it saves each member (KQM mode's own value), once per settings change
  const energy = useMemo(
    () => new Map(all.map((key) => [key, kqmEnergyRelief([key], teamOpt)])),
    [all, teamOpt]
  )
  const setExcluded = (keys: WeaponKey[]) =>
    setTeamOpt((o) => {
      o.kqm = {
        ...(o.kqm ?? defaultTeamOptKqm),
        excludedWeapons: [...new Set(keys)],
        weaponList: KQM_WEAPON_LIST,
      }
    })
  const rarity = (key: WeaponKey) => getWeaponStat(key)?.rarity ?? 0
  // (a quick pick is lit when the selection is exactly what it sets)
  const shownKeys = new Set(all)
  const selectionId = (keys: Iterable<WeaponKey>) =>
    [...new Set(keys)]
      .filter((k) => shownKeys.has(k))
      .sort()
      .join()
  const currentId = selectionId(excludedKeys)
  // The list, rebuilt only when what it shows changes (not on every keystroke in the search)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setExcluded` only uses `setTeamOpt` and `excludedKeys`
  const list = useMemo(() => {
    const onToggle = (weapon: { key: WeaponKey }) =>
      setExcluded(
        excludedKeys.has(weapon.key)
          ? [...excludedKeys].filter((k) => k !== weapon.key)
          : [...excludedKeys, weapon.key]
      )
    let before = 0
    return (
      <>
        {filteredGroups.map((group) => {
          const { filtered } = group
          // (rows come in batches: the window stays responsive while they fill in)
          const visible = Math.max(0, shown - before)
          before += filtered.length
          if (!filtered.length) return null
          return (
            <WeaponGroup
              key={group.type}
              type={group.type}
              members={group.members}
              weapons={filtered}
              selectionCounts={{
                allowed: group.weapons.filter((w) => !excluded.has(w.id))
                  .length,
                total: group.weapons.length,
              }}
              visible={visible}
              virtual
              teamData={teamData}
              excluded={excluded}
              onToggle={onToggle}
              teamMembers={members}
              weaponEnergy={Object.fromEntries(
                group.weapons.map((w) => [w.id, energy.get(w.key) ?? {}])
              )}
              setWeaponEnergy={(id, characterKey, value) =>
                setTeamOpt((o) => {
                  const key = id.replace(/^kqm:/, '') as WeaponKey
                  const k = (o.kqm ??= { ...defaultTeamOptKqm })
                  const energy = (k.weaponEnergy ??= {})
                  energy[key] = {
                    ...energy[key],
                    [characterKey]: Math.max(0, value),
                  }
                })
              }
              sourceOf={(w) => {
                const source = kqmWeaponSource(w.key)
                return t(`teamOpt.kqm.source.${source}`, sourceNames[source])
              }}
              onRefinement={(w, r) =>
                setTeamOpt((o) => {
                  const k = (o.kqm ??= { ...defaultTeamOptKqm })
                  k.refinements = { ...k.refinements, [w.key]: r }
                })
              }
              tooFew={t(
                'teamOpt.kqm.tooFewTicked',
                'Select at least one weapon of this type before generating builds.'
              )}
              typeName={t(`page_weapon:weaponType.${group.type}`, group.type)}
            />
          )
        })}
        {filteredGroups.length > 0 &&
          filteredGroups.every((g) => !g.filtered.length) && (
            <EmptyLine>
              {t(
                'teamOpt.kqm.noMatches',
                'No matches. Change the search or turn off Selected only.'
              )}
            </EmptyLine>
          )}
      </>
    )
  }, [
    filteredGroups,
    shown,
    excluded,
    excludedKeys,
    teamData,
    members,
    energy,
    setTeamOpt,
    t,
  ])
  return (
    <PassiveStoreContext.Provider value={store}>
      <ChooserFrame
        embedded={embedded}
        title={t('teamOpt.kqm.weaponsTitle', 'KQM weapons')}
        onClose={onClose}
        picks={(
          [
            [
              'free',
              t('teamOpt.kqm.defaultSelection', 'Default selection'),
              kqmDefaultExcludedWeapons(),
            ],
            [
              'four',
              t('teamOpt.kqm.allFour', 'All 4★'),
              // (exactly the 4★: the 5★ and the three 3★ off)
              all.filter((k) => rarity(k) !== 4),
            ],
            ['all', t('teamOpt.kqm.allWeapons', 'All weapons'), []],
            ['none', t('teamOpt.kqm.clearSelection', 'Clear selection'), all],
          ] as const
        ).map(([id, label, keys]) => (
          <Pill
            key={id}
            selected={selectionId(keys) === currentId}
            onClick={() =>
              setExcluded(
                [...excludedKeys]
                  .filter((key) => !all.includes(key))
                  .concat([...keys])
              )
            }
          >
            {label}
          </Pill>
        ))}
      >
        <KqmWeaponGroups
          all={all}
          excludedKeys={excludedKeys}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
        />
        {kqm.energySource === 'calculator' && (
          <FieldLabel
            tip={t(
              'teamOpt.kqm.calc.weaponHelp',
              'The preview counts Favonius and flat-energy weapon triggers for members who may use such a weapon here. During optimization they follow each build’s weapon and refinement.'
            )}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('teamOpt.kqm.calc.weaponMode', 'ER calculated per weapon.')}
          </FieldLabel>
        )}
        <SelectionSearch
          search={search}
          setSearch={setSearch}
          selectedOnly={selectedOnly}
          setSelectedOnly={setSelectedOnly}
          label={t('teamOpt.kqm.searchWeapons', 'Search weapons or sources')}
        />
        {!optimized.length && (
          <EmptyLine>
            {t('teamOpt.kqm.noMembers', 'Select at least one member in Setup.')}
          </EmptyLine>
        )}
        {list}
      </ChooserFrame>
    </PassiveStoreContext.Provider>
  )
}

/** KQM mode's artifact sets: which may be chosen, and their effects per member */
export function KqmSetChooser({
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  onClose,
  embedded = false,
}: {
  embedded?: boolean
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['page_team', 'artifactNames_gen'])
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const store = useKqmPassiveStore(teamId, teamOpt, setTeamOpt)
  const optimized = members
  const sets = useMemo(() => kqmSets(), [])
  const excludedSets = teamOpt.kqm?.excludedSets
  const excluded = useMemo(() => new Set(excludedSets ?? []), [excludedSets])
  const setExcluded = (keys: ArtifactSetKey[]) =>
    setTeamOpt((o) => {
      o.kqm = {
        ...(o.kqm ?? defaultTeamOptKqm),
        excludedSets: [...new Set(keys)],
      }
    })
  // Typing only updates the field: the list follows the deferred query, in the background
  const query = useDeferredValue(search).trim().toLocaleLowerCase()
  const searchText = useMemo(
    () =>
      new Map(
        sets.map((key) => [
          key,
          `${t(`artifactNames_gen:${key}`, key)} ${key}`.toLocaleLowerCase(),
        ])
      ),
    [sets, t]
  )
  const filteredSets = useMemo(
    () =>
      sets.filter(
        (key) =>
          (!selectedOnly || !excluded.has(key)) &&
          (!query || !!searchText.get(key)?.includes(query))
      ),
    [sets, selectedOnly, excluded, query, searchText]
  )
  const allowedCount = sets.filter((k) => !excluded.has(k)).length
  // (rows come in batches: the drawer opens at once and stays responsive while they fill in)
  const batch = useBatches(
    filteredSets.length,
    10,
    6,
    `${query}|${selectedOnly}`
  )
  const data = optimized[0] && teamData?.[optimized[0].characterKey]?.target
  // The rows, rebuilt only when what they show changes (not on every keystroke in the search)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setExcluded` only uses `setTeamOpt` and `excluded`
  const rows = useMemo(
    () =>
      filteredSets
        .slice(0, batch)
        .map((setKey) => (
          <SetRow
            key={setKey}
            setKey={setKey}
            allowed={!excluded.has(setKey)}
            onToggle={() =>
              setExcluded(
                excluded.has(setKey)
                  ? [...excluded].filter((k) => k !== setKey)
                  : [...excluded, setKey]
              )
            }
            wielders={optimized}
            data={data}
          />
        )),
    [filteredSets, batch, excluded, optimized, data, setTeamOpt]
  )
  return (
    <PassiveStoreContext.Provider value={store}>
      <ChooserFrame
        embedded={embedded}
        title={t('teamOpt.kqm.setsTitle', 'KQM artifact sets')}
        onClose={onClose}
        picks={
          <>
            <Pill
              selected={allowedCount === sets.length}
              onClick={() => setExcluded([])}
            >
              {t('teamOpt.kqm.selectAllSets', 'All sets')}
            </Pill>
            <Pill
              selected={allowedCount === 0}
              onClick={() => setExcluded([...sets])}
            >
              {t('teamOpt.kqm.clearSelection', 'Clear selection')}
            </Pill>
          </>
        }
      >
        <SelectionSearch
          search={search}
          setSearch={setSearch}
          selectedOnly={selectedOnly}
          setSelectedOnly={setSelectedOnly}
          label={t('teamOpt.kqm.searchSets', 'Search artifact sets')}
        />
        {excluded.size >= sets.length && (
          <Box
            role="status"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: 13,
              color: 'warning.main',
            }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
            {t(
              'teamOpt.kqm.noSets',
              'No artifact sets selected. Builds will have no set bonus.'
            )}
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography sx={{ ...typeScale.label, ...numSx, flexGrow: 1 }}>
            {t('teamOpt.weapons.groupCount', {
              defaultValue: '{{allowed}} of {{total}}',
              allowed: allowedCount,
              total: sets.length,
            })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {optimized.map((m) => (
              <MemberAvatar
                key={m.characterKey}
                characterKey={m.characterKey}
                size={22}
              />
            ))}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gap: 0.75,
            alignItems: 'stretch',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
            },
          }}
        >
          {!filteredSets.length && (
            <EmptyLine sx={{ gridColumn: '1 / -1' }}>
              {t(
                'teamOpt.kqm.noMatches',
                'No matches. Change the search or turn off Selected only.'
              )}
            </EmptyLine>
          )}
          {rows}
        </Box>
      </ChooserFrame>
    </PassiveStoreContext.Provider>
  )
}

function SetRow({
  setKey,
  allowed,
  onToggle,
  wielders,
  data,
}: {
  setKey: ArtifactSetKey
  allowed: boolean
  onToggle: () => void
  wielders: TeamOptMember[]
  data: Parameters<typeof PassiveLines>[0]['data']
}) {
  const nameId = useId()
  const passives = useMemo(() => {
    const sheet = getArtSheet(setKey)
    return [2, 4].flatMap((n) =>
      (sheet?.setEffectDocument(n as 2 | 4) ?? []).filter(isConditional)
    )
  }, [setKey])
  return (
    <Box
      sx={(theme) => ({
        ...insetSx,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        // (not ticked: quiet, readable again under the pointer; like the weapon rows)
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
        <Box
          component="img"
          src={artifactAsset(setKey, 'flower')}
          alt=""
          // (its picture and name tick it too, like the weapon rows)
          onClick={onToggle}
          sx={{ width: 38, height: 38, flexShrink: 0, cursor: 'pointer' }}
        />
        <ArtifactSetTooltip setKey={setKey}>
          <Typography
            id={nameId}
            onClick={onToggle}
            sx={{
              fontSize: 14,
              fontWeight: 600,
              minWidth: 0,
              cursor: 'pointer',
            }}
            noWrap
          >
            <ArtifactSetName setKey={setKey} />
          </Typography>
        </ArtifactSetTooltip>
      </Box>
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          px: 1.5,
          py: 0.75,
          borderTop: hairline,
        }}
      >
        <PassiveLines
          weaponKey={setKey}
          passives={passives}
          wielders={wielders}
          data={data}
        />
      </Box>
    </Box>
  )
}

/** How many weapons (of the optimized members' types) and sets KQM mode may choose from */
export function kqmChooserCounts(members: TeamOptMember[], teamOpt: TeamOpt) {
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const types = new Map<WeaponTypeKey, CharacterKey>()
  for (const m of members)
    types.set(getCharWeaponType(m.characterKey), m.characterKey)
  const weapons = [...types.values()].flatMap((ck) =>
    kqmWeapons(ck, kqm, { all: true })
  )
  const excluded = kqmExcludedWeapons(kqm)
  const sets = kqmSets()
  return {
    weapons: {
      allowed: weapons.filter((w) => !excluded.has(w.key)).length,
      total: weapons.length,
    },
    sets: {
      allowed: sets.filter((k) => !kqm.excludedSets?.includes(k)).length,
      total: sets.length,
    },
  }
}

function SelectionSearch({
  search,
  setSearch,
  selectedOnly,
  setSelectedOnly,
  label,
}: {
  search: string
  setSearch: (value: string) => void
  selectedOnly: boolean
  setSelectedOnly: (value: boolean) => void
  label: string
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}
    >
      <TextField
        size="small"
        placeholder={label}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          // (Escape clears the search first; the drawer closes on the next one)
          if (e.key === 'Escape' && search) {
            e.stopPropagation()
            setSearch('')
          }
        }}
        inputProps={{ 'aria-label': label }}
        sx={{
          flex: '1 1 220px',
          '& .MuiInputBase-root': { fontSize: 14, pr: 0.5 },
          '& .MuiInputBase-input': { py: 0.875 },
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: search ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label={t('teamOpt.kqm.clearSearch', 'Clear search')}
                onClick={() => setSearch('')}
                sx={{ ...quickSx, ...focusSx }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
      />
      <Pill
        selected={selectedOnly}
        onClick={() => setSelectedOnly(!selectedOnly)}
        sx={{ minHeight: 36 }}
      >
        {t('teamOpt.kqm.selectedOnly', 'Selected only')}
      </Pill>
    </Box>
  )
}
