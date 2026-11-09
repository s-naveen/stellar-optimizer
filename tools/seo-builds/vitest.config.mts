import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vite'

// Runs the build-data generator (generate.test.ts) with the workspace path aliases.
// Not part of any nx project, so normal test runs never pick it up.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tools/seo-builds',
  plugins: [nxViteTsPaths()],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['*.test.ts'],
    reporters: ['default'],
    testTimeout: 0,
  },
}))
