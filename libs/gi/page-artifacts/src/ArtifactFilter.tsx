import {
  type BulkAction,
  BulkActionsMenu,
  CollapsibleFilterCard,
} from '@genshin-optimizer/common/ui'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { useDatabase, useDisplayArtifact } from '@genshin-optimizer/gi/db-ui'
import {
  type FilterOption,
  initialFilterOption,
} from '@genshin-optimizer/gi/schema'
import { ArtifactFilterDisplay } from '@genshin-optimizer/gi/ui'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import PersonOffIcon from '@mui/icons-material/PersonOff'
import { Skeleton } from '@mui/material'
import { Suspense, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x) => b.includes(x))
    : a === b

/** Filter options that differ from the defaults (what Reset would change). */
function changedFilterKeys(option: FilterOption) {
  const initial = initialFilterOption()
  const keys = new Set([...Object.keys(initial), ...Object.keys(option)])
  return [...keys].filter(
    (key) =>
      !sameValue(
        option[key as keyof FilterOption],
        initial[key as keyof FilterOption]
      )
  ) as (keyof FilterOption)[]
}

/** How many filters are active, counting a range (low/high) as one filter. */
function countActiveFilters(changed: (keyof FilterOption)[]) {
  const groups = changed
    // only changes how the RV range is applied, it is not a filter by itself
    .filter((key) => key !== 'useMaxRV')
    .map((key) =>
      key === 'levelLow' || key === 'levelHigh'
        ? 'level'
        : key === 'rvLow' || key === 'rvHigh'
          ? 'rv'
          : key === 'showEquipped' || key === 'showInventory'
            ? 'equipped'
            : key
    )
  return new Set(groups).size
}

export default function ArtifactFilter({
  numShowing,
  total,
  artifactIds,
}: {
  numShowing: number
  total: number
  artifactIds: string[]
}) {
  const { t } = useTranslation(['artifact', 'ui'])
  const database = useDatabase()
  const { filterOption } = useDisplayArtifact()
  const filterOptionDispatch = useCallback(
    (option: Partial<FilterOption>) =>
      database.displayArtifact.set({
        filterOption: { ...filterOption, ...option },
      }),
    [database, filterOption]
  )
  const changed = useMemo(() => changedFilterKeys(filterOption), [filterOption])
  const activeCount = countActiveFilters(changed)

  return (
    <CollapsibleFilterCard
      storageKey="artifactPage_filtersOpen"
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
      resetDisabled={!changed.length}
      onReset={() => database.displayArtifact.set({ action: 'reset' })}
    >
      <Suspense
        fallback={<Skeleton variant="rectangular" width="100%" height={400} />}
      >
        <ArtifactFilterDisplay
          filterOption={filterOption}
          filterOptionDispatch={filterOptionDispatch}
          filteredIds={artifactIds}
        />
      </Suspense>
    </CollapsibleFilterCard>
  )
}

/** Delete / lock / unlock / unequip every artifact that matches the current filters. */
export function ArtifactBulkActions({
  artifactIds,
}: {
  artifactIds: string[]
}) {
  const { t } = useTranslation(['artifact', 'ui'])
  const database = useDatabase()
  const { numDelete, numUnequip, numUnlock, numLock } = useMemo(() => {
    const artifacts = artifactIds.map((id) =>
      database.arts.get(id)
    ) as ICachedArtifact[]
    const numUnlock = artifacts.reduce((a, art) => a + (art.lock ? 0 : 1), 0)
    const numLock = artifacts.length - numUnlock
    const numDelete = numUnlock
    const numUnequip = artifacts.reduce(
      (a, art) => a + (art.location ? 1 : 0),
      0
    )
    return { numDelete, numUnequip, numUnlock, numLock }
  }, [artifactIds, database])

  const actions: BulkAction[] = [
    {
      key: 'unequip',
      icon: <PersonOffIcon />,
      label: t('bulk.unequip'),
      count: numUnequip,
      run: () =>
        window.confirm(
          `Are you sure you want to unequip ${numUnequip} artifacts currently equipped on characters?`
        ) &&
        artifactIds.forEach((id) => database.arts.set(id, { location: '' })),
    },
    {
      key: 'lock',
      icon: <LockIcon />,
      label: t('bulk.lock'),
      count: numUnlock,
      run: () =>
        window.confirm(
          `Are you sure you want to lock ${numUnlock} artifacts?`
        ) && artifactIds.forEach((id) => database.arts.set(id, { lock: true })),
    },
    {
      key: 'unlock',
      icon: <LockOpenIcon />,
      label: t('bulk.unlock'),
      count: numLock,
      run: () =>
        window.confirm(
          `Are you sure you want to unlock ${numLock} artifacts?`
        ) &&
        artifactIds.forEach((id) => database.arts.set(id, { lock: false })),
    },
    {
      key: 'delete',
      icon: <DeleteForeverIcon />,
      label: t('bulk.delete'),
      count: numDelete,
      danger: true,
      run: () =>
        window.confirm(
          `Are you sure you want to delete ${numDelete} artifacts?`
        ) &&
        artifactIds.forEach(
          (id) => !database.arts.get(id)?.lock && database.arts.remove(id)
        ),
    },
  ]

  return (
    <BulkActionsMenu
      label={t('bulk.title')}
      hint={t('bulk.hint', { count: artifactIds.length })}
      actions={actions}
      disabled={!artifactIds.length}
    />
  )
}
