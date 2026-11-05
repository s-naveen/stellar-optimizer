import {
  type Database,
  DBLocalStorage,
  type DBStorage,
  loadJsonOrB64GzipFromStorage,
  SandboxStorage,
  type StorageType,
} from '@genshin-optimizer/common/database'
import { useEffect, useRef, useState } from 'react'

export function useDatabases<DB extends Database>(
  DatabaseClass: new (dbIndex: 1 | 2 | 3 | 4, dbStorage: DBStorage) => DB,
  dbIndex: number,
  newTabKey: string,
  storageType?: StorageType
) {
  const state = useState(() => {
    localStorage.removeItem(newTabKey)
    localStorage.setItem(newTabKey, 'debug')
    return ([1, 2, 3, 4] as const).map((index) => {
      if (index === dbIndex)
        return new DatabaseClass(
          index,
          new DBLocalStorage(localStorage, storageType)
        )
      const dbName = `${storageType ? `${storageType}_` : ''}extraDatabase_${index}`
      const dbObj = loadJsonOrB64GzipFromStorage(dbName)
      return new DatabaseClass(index, new SandboxStorage(dbObj, storageType))
    })
  })

  // Refresh the compressed per-slot copies (`extraDatabase_N`, which also persists migrations of
  // the other slots) once the page is idle instead of before the first render: serializing and
  // gzipping a whole database takes ~100 ms on a desktop and several times that on a phone.
  // A database that was replaced in the meantime (import, swap) is skipped, so a stale object
  // can never overwrite newer data.
  const latest = useRef(state[0])
  latest.current = state[0]
  useEffect(() => {
    const initial = latest.current
    return whenIdle(() => {
      for (const db of initial)
        if (latest.current.includes(db)) db.toExtraLocalDB()
    })
  }, [])

  return state
}

/** Run `fn` when the browser is idle (at most ~2 s later). Returns a cancel function. */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 2000 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 200)
  return () => clearTimeout(id)
}
