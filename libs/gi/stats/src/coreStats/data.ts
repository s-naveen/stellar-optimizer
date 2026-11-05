import * as allStat_gen from '../allStat_gen.json'
import type { AllStats } from '../executors/gen-stats/executor'
import { deriveCoreStats } from './derive'

// NOTE: the production build of apps/frontend replaces this module with the precomputed result
// (plugin `go-core-stats` in apps/frontend/vite.config.mts), so the app can load and validate the
// database without downloading the full ~1 MB allStat_gen.json first. Keep it free of anything
// but this derivation.
export const coreStats = deriveCoreStats(allStat_gen as AllStats)
