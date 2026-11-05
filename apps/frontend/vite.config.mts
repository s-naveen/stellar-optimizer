// viteStaticCopy contains some `require`, so we need to have our config as .mts instead of .ts.
// https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
// biome-ignore lint/style/noRestrictedImports: the build plugin below must run the exact derivation used at runtime
import { deriveCoreStats } from '../../libs/gi/stats/src/coreStats/derive'
import pkg from '../../package.json' with { type: 'json' }
import { webpAssets } from './vite-plugin-webp.mts'

/**
 * Loading/validating the database needs ~50 kB of the ~1 MB game data file (allStat_gen.json).
 * In production builds, replace `coreStats/data.ts` (which derives that subset from the full file
 * at runtime) with the precomputed subset, so the full file is only downloaded by the pages that
 * use it. Same function, same input: the values are identical to the runtime derivation.
 */
function coreStatsPlugin(): Plugin {
  const statsDir = resolve(__dirname, '../../libs/gi/stats/src')
  const dataModule = normalizePath(resolve(statsDir, 'coreStats/data.ts'))
  return {
    name: 'go-core-stats',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      if (normalizePath(id) !== dataModule) return null
      const jsonFile = resolve(statsDir, 'allStat_gen.json')
      this.addWatchFile(jsonFile)
      const core = deriveCoreStats(JSON.parse(readFileSync(jsonFile, 'utf8')))
      return `export const coreStats = JSON.parse(${JSON.stringify(JSON.stringify(core))})`
    },
  }
}

/** The locale folders copied to `assets/locales` (unhashed file names, loaded by i18next). */
const localeDirs = [
  '../../libs/common/localization/assets/locales',
  '../../libs/gi/localization/assets/locales',
  '../../libs/gi/dm-localization/assets/locales',
].map((dir) => normalizePath(resolve(__dirname, dir)))

/**
 * Content hash of every locale file. i18n.ts adds it to the locale URLs as `?v=`: the service worker
 * serves those unhashed files stale-while-revalidate, so without it the first visit after a deploy
 * gets the previous deploy's text (new items show as raw keys). Text that did not change keeps the
 * same hash, and so its cache.
 */
function hashLocales() {
  const hash = createHash('sha1')
  for (const dir of localeDirs)
    for (const file of readdirSync(dir, {
      recursive: true,
      encoding: 'utf8',
    }).sort()) {
      if (!file.endsWith('.json')) continue
      hash.update(file).update(readFileSync(resolve(dir, file)))
    }
  return hash.digest('hex').slice(0, 10)
}

export default defineConfig(() => ({
  base: '',
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/frontend',

  server: {
    port: 4200,
    host: 'localhost',
  },

  preview: {
    port: 4300,
    host: 'localhost',
  },

  plugins: [
    // Production builds ship large PNG art as WebP (see vite-plugin-webp.mts).
    webpAssets({
      cacheDir: resolve(__dirname, '../../node_modules/.cache/go-webp'),
    }),
    coreStatsPlugin(),
    react(),
    nxViteTsPaths(),
    // Nx executor for vite does not support `assets` prop for copying files.
    // So we need to do it with this plugin. This works for both `build` and `serve`.
    viteStaticCopy({
      targets: [
        ...localeDirs.map((src) => ({ src, dest: 'assets' })),
        {
          src: normalizePath(resolve('../../apps/frontend/assets/*')),
          dest: 'assets',
        },
      ],
      // Force page to reload if we change any of the above files
      watch: {
        reloadPageOnChange: true,
      },
    }),
  ],

  define: {
    // Only expose the app's own NX_* settings (+ NODE_ENV). Passing the whole `process.env`
    // embeds the build machine's environment (user name, paths, session tokens) in the bundle.
    'process.env': Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          (k.startsWith('NX_URL') ||
            k === 'NODE_ENV' ||
            k === 'NX_URLS_GUIDES') &&
          !/PATREON|PAYPAL|TWITCH|TWITTER/.test(k)
      )
    ),
    __VERSION__: `"${pkg.version}"`,
    __GO_LOCALES_VERSION__: JSON.stringify(hashLocales()),
  },

  // Uncomment this if you are using workers.
  worker: {
    // https://vitejs.dev/guide/migration#worker-plugins-is-now-a-function
    plugins: () => [nxViteTsPaths()],
  },

  build: {
    outDir: '../../dist/apps/frontend',
    reportCompressedSize: true,
    // The bundled npm packages' licences (they ask for their notices to travel with the
    // code). Not linked from the UI; next to LICENSE.txt (public/) at the site root.
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    // The asset maps in libs/gi/assets reference every icon of every character. Inlining the small
    // ones as base64 put ~600 kB of images into the startup JS; emit them as files instead.
    assetsInlineLimit: (file: string) =>
      file.includes('/libs/gi/assets/') ? false : undefined,
    rolldownOptions: {
      treeshake: {
        // Workspace libraries are imported through barrel files (`export * from ...`). Declaring
        // them side-effect free lets the bundler drop re-exports a chunk does not use, so the
        // entry chunk no longer carries every sheet, the OCR scanner, etc.
        // Exceptions: modules that are imported only for their effect — stylesheets, the i18n
        // bootstrap, and gi/ui's index (it imports the global App.scss). Keep this list in sync
        // when adding a bare `import './x'` to a lib.
        moduleSideEffects: (id: string, external: boolean) => {
          if (external || !id.includes('/libs/')) return undefined
          if (/\.(css|scss|sass)(\?|$)/.test(id)) return true
          if (/\/libs\/gi\/i18n\/src\/(index|i18n)\.tsx?$/.test(id)) return true
          if (id.endsWith('/libs/gi/ui/src/index.ts')) return true
          return false
        },
      },
    },
  },

  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/frontend',
      provider: 'v8',
    },
  },
}))
