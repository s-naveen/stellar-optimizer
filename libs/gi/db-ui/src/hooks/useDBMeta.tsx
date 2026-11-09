import { useDataEntryBase } from '@genshin-optimizer/common/database-ui'
import type { GenderKey } from '@genshin-optimizer/gi/consts'
import { useCallback, useSyncExternalStore } from 'react'
import { useDatabase } from './useDatabase'

export function useDBMeta() {
  const database = useDatabase()
  return useDataEntryBase(database?.dbMeta) ?? { gender: 'F' }
}

/**
 * The traveler's gender alone: unlike `useDBMeta`, does not re-render on every database write
 * (the meta's `lastEdit` changes with each one)
 */
export function useDBGender(): GenderKey {
  const database = useDatabase()
  const entry = database?.dbMeta
  return useSyncExternalStore(
    useCallback(
      (callback: () => void) =>
        entry?.follow((r) => r === 'update' && callback()) ?? (() => {}),
      [entry]
    ),
    () => entry?.get()?.gender ?? 'F'
  )
}
