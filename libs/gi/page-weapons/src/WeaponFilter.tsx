import {
  BootstrapTooltip,
  type BulkAction,
  BulkActionsMenu,
  CollapsibleFilterCard,
  FilterGrid,
  FilterGroup,
  filterToggleValue,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import {
  bulkCatTotal,
  catTotal,
  handleMultiSelect,
} from '@genshin-optimizer/common/util'
import {
  allLocationCharacterKeys,
  allRarityKeys,
  allWeaponTypeKeys,
} from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import {
  LocationFilterMultiAutocomplete,
  WeaponRarityToggle,
  WeaponToggle,
} from '@genshin-optimizer/gi/ui'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import PersonSearchIcon from '@mui/icons-material/PersonSearch'
import { ToggleButton } from '@mui/material'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const lockedValues = ['locked', 'unlocked'] as const

const lockedHandler = handleMultiSelect([...lockedValues])

const filterKeys = [
  'weaponType',
  'rarity',
  'locked',
  'showEquipped',
  'showInventory',
  'locations',
] as const
const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x) => b.includes(x))
    : a === b

function WeaponFilter({
  numShowing,
  total,
  weaponIds,
}: {
  numShowing: number
  total: number
  weaponIds: string[]
}) {
  const { t } = useTranslation(['page_weapon', 'ui'])
  const database = useDatabase()
  const [state, setState] = useState(database.displayWeapon.get())

  useEffect(() => {
    database.displayWeapon.follow((_r, dbMeta) => setState(dbMeta))
  }, [database])

  const { weaponType, rarity, locked, showEquipped, showInventory, locations } =
    state

  // The same defaults Reset restores.
  const defaults = useMemo(
    () => database.displayWeapon.init(database),
    [database]
  )
  const changedKeys = filterKeys.filter(
    (key) => !sameValue(state[key], defaults[key])
  )
  // "All equipped" / "All unequipped" together are one filter
  const activeCount = new Set(
    changedKeys.map((key) =>
      key === 'showEquipped' || key === 'showInventory' ? 'equipped' : key
    )
  ).size

  const weaponTotals = useMemo(
    () =>
      catTotal(allWeaponTypeKeys, (ct) =>
        database.weapons.entries.forEach(([id, weapon]) => {
          const wtk = getWeaponStat(weapon.key).weaponType
          ct[wtk].total++
          if (weaponIds.includes(id)) ct[wtk].current++
        })
      ),
    [database, weaponIds]
  )

  const weaponRarityTotals = useMemo(
    () =>
      catTotal(allRarityKeys, (ct) =>
        database.weapons.entries.forEach(([id, weapon]) => {
          const wr = getWeaponStat(weapon.key).rarity
          ct[wr].total++
          if (weaponIds.includes(id)) ct[wr].current++
        })
      ),
    [database, weaponIds]
  )

  const { lockedTotal, equippedTotal, locationTotal } = useMemo(() => {
    const catKeys = {
      lockedTotal: ['locked', 'unlocked'],
      equippedTotal: ['equipped', 'unequipped'],
      locationTotal: [...allLocationCharacterKeys, ''],
    } as const
    return bulkCatTotal(catKeys, (ctMap) =>
      database.weapons.entries.forEach(([id, weapon]) => {
        const location = weapon.location
        const lock = weapon.lock ? 'locked' : 'unlocked'
        const equipped = location ? 'equipped' : 'unequipped'
        ctMap['lockedTotal'][lock].total++
        ctMap['equippedTotal'][equipped].total++
        ctMap['locationTotal'][location].total++
        if (weaponIds.includes(id)) {
          ctMap['lockedTotal'][lock].current++
          ctMap['equippedTotal'][equipped].current++
          ctMap['locationTotal'][location].current++
        }
      })
    )
  }, [database, weaponIds])

  return (
    <CollapsibleFilterCard
      storageKey="weaponPage_filtersOpen"
      title={t('filters.title')}
      activeLabel={
        activeCount ? t('filters.active', { count: activeCount }) : undefined
      }
      summary={
        <>
          <strong>{numShowing}</strong> / {total}
        </>
      }
      resetLabel={t('ui:reset')}
      resetDisabled={!changedKeys.length}
      onReset={() => database.displayWeapon.set({ action: 'reset' })}
    >
      <FilterGrid
        narrowAreas={'"weapon" "inventory"'}
        wideAreas={'"weapon inventory"'}
      >
        <FilterGroup area="weapon" title={t('filters.groups.weapon')}>
          <WeaponToggle
            quiet
            fullWidth
            size="small"
            onChange={(weaponType) =>
              database.displayWeapon.set({ weaponType })
            }
            value={weaponType}
            totals={weaponTotals}
          />
          <WeaponRarityToggle
            quiet
            fullWidth
            size="small"
            onChange={(rarity) => database.displayWeapon.set({ rarity })}
            value={rarity}
            totals={weaponRarityTotals}
          />
        </FilterGroup>
        <FilterGroup area="inventory" title={t('subheadings.inventory')}>
          <SolidToggleButtonGroup
            quiet
            fullWidth
            size="small"
            value={filterToggleValue(locked, lockedValues)}
          >
            {lockedValues.map((v) => (
              <ToggleButton
                key={v}
                value={v}
                onClick={() =>
                  database.displayWeapon.set({
                    locked: lockedHandler(locked, v),
                  })
                }
              >
                {v === 'locked' ? (
                  <LockIcon fontSize="small" />
                ) : (
                  <LockOpenIcon fontSize="small" />
                )}
                <span>{t(`ui:${v}`)}</span>
                <ToggleButtonCount>{lockedTotal[v]}</ToggleButtonCount>
              </ToggleButton>
            ))}
          </SolidToggleButtonGroup>
          <SolidToggleButtonGroup
            quiet
            fullWidth
            size="small"
            value={[
              ...(showInventory ? ['unequipped'] : []),
              ...(showEquipped ? ['equipped'] : []),
            ]}
          >
            <ToggleButton
              value="unequipped"
              onClick={() =>
                database.displayWeapon.set({ showInventory: !showInventory })
              }
            >
              <BusinessCenterIcon fontSize="small" />
              <span>{t('filters.unequipped')}</span>
              <ToggleButtonCount>
                {equippedTotal['unequipped']}
              </ToggleButtonCount>
            </ToggleButton>
            <ToggleButton
              value="equipped"
              onClick={() =>
                database.displayWeapon.set({ showEquipped: !showEquipped })
              }
            >
              <PersonSearchIcon fontSize="small" />
              <span>{t('filters.equipped')}</span>
              <ToggleButtonCount>{equippedTotal['equipped']}</ToggleButtonCount>
            </ToggleButton>
          </SolidToggleButtonGroup>
          <Suspense fallback={null}>
            <BootstrapTooltip
              title={showEquipped ? t('locationsTooltip') : ''}
              placement="top"
            >
              <span>
                <LocationFilterMultiAutocomplete
                  size="small"
                  totals={locationTotal}
                  locations={showEquipped ? [] : locations}
                  setLocations={(locations) =>
                    database.displayWeapon.set({ locations })
                  }
                  disabled={showEquipped}
                />
              </span>
            </BootstrapTooltip>
          </Suspense>
        </FilterGroup>
      </FilterGrid>
    </CollapsibleFilterCard>
  )
}

/** Delete / lock / unlock every weapon that matches the current filters. */
function WeaponBulkActions({ weaponIds }: { weaponIds: string[] }) {
  const { t } = useTranslation(['page_weapon', 'ui'])
  const database = useDatabase()
  const { numDelete, numUnlock, numLock } = useMemo(() => {
    const weapons = weaponIds.map((id) =>
      database.weapons.get(id)
    ) as ICachedWeapon[]
    const numUnlock = weapons.reduce(
      (w, weapon) => w + (weapon.lock ? 0 : 1),
      0
    )
    const numLock = weapons.length - numUnlock
    const numDelete = weapons.reduce(
      (w, weapon) => w + (weapon.lock || weapon.location ? 0 : 1),
      0
    )
    return { numDelete, numUnlock, numLock }
  }, [weaponIds, database])

  const actions: BulkAction[] = [
    {
      key: 'lock',
      icon: <LockIcon />,
      label: t('bulk.lock'),
      count: numUnlock,
      run: () =>
        window.confirm(
          `Are you sure you want to lock ${numUnlock} weapons ?`
        ) &&
        weaponIds.forEach((id) => database.weapons.set(id, { lock: true })),
    },
    {
      key: 'unlock',
      icon: <LockOpenIcon />,
      label: t('bulk.unlock'),
      count: numLock,
      run: () =>
        window.confirm(
          `Are you sure you want to unlock ${numLock} weapons ?`
        ) &&
        weaponIds.forEach((id) => database.weapons.set(id, { lock: false })),
    },
    {
      key: 'delete',
      icon: <DeleteForeverIcon />,
      label: t('bulk.delete'),
      count: numDelete,
      danger: true,
      run: () =>
        window.confirm(
          `Are you sure you want to delete ${numDelete} weapons?`
        ) &&
        weaponIds.forEach((id) => {
          const weapon = database.weapons.get(id)
          if (!weapon?.lock && !weapon?.location) database.weapons.remove(id)
        }),
    },
  ]

  return (
    <BulkActionsMenu
      label={t('bulk.title')}
      hint={t('bulk.hint', { count: weaponIds.length })}
      actions={actions}
      disabled={!weaponIds.length}
    />
  )
}

export default WeaponFilter
export { WeaponBulkActions }
