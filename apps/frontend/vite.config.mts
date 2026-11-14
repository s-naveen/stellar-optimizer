// viteStaticCopy contains some `require`, so we need to have our config as .mts instead of .ts.
// https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
// biome-ignore lint/style/noRestrictedImports: the build plugin below must run the exact derivation used at runtime
import { deriveCoreStats } from '../../libs/gi/stats/src/coreStats/derive'
import pkg from '../../package.json' with { type: 'json' }
import {
  betaKeyTest,
  readBetaContent,
  releasedOnlyPlugin,
  stripBetaKeys,
} from './vite-plugin-released.mts'
import { seoPagesPlugin } from './vite-plugin-seo-pages.mts'
import { webpAssets } from './vite-plugin-webp.mts'

/** Unreleased content: on the beta site only (see beta-content.json) */
const beta = readBetaContent(resolve(__dirname, 'beta-content.json'))
/**
 * GO_RELEASED=1: the released-only build, for stellaroptimizer.com (into dist/apps/frontend-released).
 * The default build is the beta site (gi-beta73.github.io), with everything.
 */
const released = process.env.GO_RELEASED === '1'

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
      const data = JSON.parse(readFileSync(jsonFile, 'utf8'))
      if (released) stripBetaKeys(data, betaKeyTest(beta))
      const core = deriveCoreStats(data)
      return `export const coreStats = JSON.parse(${JSON.stringify(JSON.stringify(core))})`
    },
  }
}

/** The locale folders copied to `assets/locales` (unhashed file names, loaded by i18next). */
/**
 * Cloudflare Web Analytics: cookieless visit counts for the published sites (no consent banner
 * needed). Production builds only, and only on the real hosts, so local runs (dev server, smoke
 * tests of dist) are never counted. Each host has its own Web Analytics site, so the beta and the
 * released site are counted apart; the tokens are the public site tags from the Cloudflare
 * dashboard (Web Analytics → the site → Manage site), not secrets. gi-beta73.github.io's site is
 * in another Cloudflare account than stellaroptimizer.com's (set up as "JS Snippet installation",
 * so Cloudflare injects nothing itself).
 * Opening a site once with `?notrack` stops counting that browser there (for the site's own
 * team); `?notrack=off` counts it again.
 */
const CF_WEB_ANALYTICS_TOKENS: Record<string, string> = {
  'gi-beta73.github.io': 'ec971696b247424ca782ce28157bc5af',
  'stellaroptimizer.com': 'cb9d851f67d541428fdf3ef910d61702',
}
/** The site search engines treat as the original (canonical links, sitemap): the beta site */
const CANONICAL_HOST = 'gi-beta73.github.io'
// the beacon finds its config by the data-cf-beacon attribute when inserted this way
const CF_BEACON_INLINE = `(() => {
  try {
    const q = new URLSearchParams(location.search)
    if (q.get('notrack') === 'off') localStorage.removeItem('stellar-notrack')
    else if (q.has('notrack')) localStorage.setItem('stellar-notrack', '1')
    if (localStorage.getItem('stellar-notrack')) return
  } catch {}
  const token = ${JSON.stringify(CF_WEB_ANALYTICS_TOKENS)}[location.hostname.replace(/^www./, '')]
  if (!token) return
  const s = document.createElement('script')
  s.type = 'module'
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  s.dataset.cfBeacon = JSON.stringify({ token })
  document.head.appendChild(s)
})()`
function cloudflareWebAnalyticsPlugin(): Plugin {
  return {
    name: 'cf-web-analytics',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'script', children: CF_BEACON_INLINE, injectTo: 'body' },
    ],
  }
}

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

/**
 * This build's id: in the app (__GO_BUILD_ID__), in version.json (what the live site serves, never
 * cached) and in sw.js (a new id makes a new service worker: it drops the old cache and takes over,
 * and the page reloads onto the new build). See src/app/updateCheck.ts.
 */
const buildId = Date.now().toString(36)
/** The release this build is: the newest entry of the changelog (tools/site/release.mjs adds them) */
const releaseVersion: string = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../libs/gi/ui/src/changelog/changelog.json'),
    'utf8'
  )
)[0].version
function buildVersionPlugin(): Plugin {
  return {
    name: 'go-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildId, version: releaseVersion }),
      })
    },
    writeBundle(options) {
      const sw = resolve(options.dir ?? '', 'sw.js')
      if (!existsSync(sw)) return
      writeFileSync(
        sw,
        readFileSync(sw, 'utf8').replaceAll('__GO_BUILD_ID__', buildId)
      )
    },
  }
}

export default defineConfig(({ command }) => ({
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
    // the released-only build leaves the beta content out (see vite-plugin-released.mts)
    released && releasedOnlyPlugin(beta),
    // Production builds ship large PNG art as WebP (see vite-plugin-webp.mts).
    webpAssets({
      cacheDir: resolve(__dirname, '../../node_modules/.cache/go-webp'),
    }),
    coreStatsPlugin(),
    buildVersionPlugin(),
    cloudflareWebAnalyticsPlugin(),
    // static landing pages (/<name>-optimizer/, /optimizers/), sitemap.xml and robots.txt
    seoPagesPlugin({
      siteUrl: `https://${CANONICAL_HOST}/`,
      siteName: 'Stellar Optimizer',
      bodyEndHtml: `<script>${CF_BEACON_INLINE}</script>`,
      upcoming: new Set(beta.characters),
      // the released-only build: no beta characters' pages, no beta weapons or sets in rankings
      exclude: released
        ? new Set([...beta.characters, ...beta.weapons, ...beta.artifactSets])
        : undefined,
    }),
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
    // Experimental KQM: local development only by default. Explicit 1/0 enables/disables it.
    __GO_KQM_THEORYCRAFTING__: JSON.stringify(
      process.env.GO_KQM_THEORYCRAFTING === undefined
        ? command === 'serve'
        : process.env.GO_KQM_THEORYCRAFTING === '1'
    ),
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
    __GO_BUILD_ID__: JSON.stringify(buildId),
  },

  // Uncomment this if you are using workers.
  worker: {
    // https://vitejs.dev/guide/migration#worker-plugins-is-now-a-function
    plugins: () =>
      released
        ? [releasedOnlyPlugin(beta, { locales: false }), nxViteTsPaths()]
        : [nxViteTsPaths()],
  },

  build: {
    outDir: released
      ? '../../dist/apps/frontend-released'
      : '../../dist/apps/frontend',
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
