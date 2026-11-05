import { ScrollTop, useTitle } from '@genshin-optimizer/common/ui'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { DatabaseContext } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n' // also initializes translations
import { theme } from '@genshin-optimizer/gi/theme'
import { SnowContext, useSnow } from '@genshin-optimizer/gi/ui'
import {
  Box,
  Container,
  CssBaseline,
  Skeleton,
  StyledEngineProvider,
  ThemeProvider,
} from '@mui/material'
import type { ComponentType } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import './App.scss'
import { useDatabases } from '@genshin-optimizer/common/database-ui'
import ErrorBoundary from './ErrorBoundary'
import Footer from './Footer'
import Header from './Header'
import Snow from './Snow'

type PageModule = { default: ComponentType<any> }
/**
 * `lazy()` for a route page, plus `preload()` to fetch it before it is navigated to.
 * Once loaded, the page renders without suspending (no skeleton flash when switching tabs).
 */
function lazyPage(load: () => Promise<unknown>) {
  let loaded: PageModule | undefined
  let loading: Promise<PageModule> | undefined
  const preload = () =>
    (loading ??= (load() as Promise<PageModule>).then(
      (mod) => (loaded = mod),
      (error) => {
        loading = undefined // allow a retry, e.g. after a network hiccup
        throw error
      }
    ))
  const Page = lazy(() => {
    const mod = loaded
    if (!mod) return preload()
    // A thenable that resolves synchronously: React renders the page without suspending.
    return {
      // biome-ignore lint/suspicious/noThenProperty: a sync thenable is the point here (see above)
      then: (resolve: (m: PageModule) => void) => resolve(mod),
    } as unknown as Promise<PageModule>
  })
  return Object.assign(Page, { preload })
}

const PageHome = lazyPage(() => import('@genshin-optimizer/gi/page-home'))
const PageArtifacts = lazyPage(
  () => import('@genshin-optimizer/gi/page-artifacts')
)
const PageTools = lazyPage(() => import('@genshin-optimizer/gi/page-tools'))
const PageSettings = lazyPage(
  () => import('@genshin-optimizer/gi/page-settings')
)
const PageWeapons = lazyPage(() => import('@genshin-optimizer/gi/page-weapons'))
const PageArchive = lazyPage(() => import('@genshin-optimizer/gi/page-archive'))
const PageDocumentation = lazyPage(
  () => import('@genshin-optimizer/gi/page-doc')
)
const PageScanner = lazyPage(() => import('@genshin-optimizer/gi/page-scanner'))
const PageCharacters = lazyPage(
  () => import('@genshin-optimizer/gi/page-characters')
)
const PageTeams = lazyPage(() => import('@genshin-optimizer/gi/page-teams'))
const PageTeam = lazyPage(() => import('@genshin-optimizer/gi/page-team'))

// Most visited first. Prefetched one at a time while the browser is idle (see usePrefetchPages).
const prefetchOrder = [
  PageCharacters,
  PageTeams,
  PageTeam,
  PageArtifacts,
  PageWeapons,
  PageHome,
  PageSettings,
  PageTools,
  PageArchive,
  PageDocumentation,
  PageScanner,
]
// Static namespaces of the main pages, so a first visit to them does not wait on translations.
const prefetchNamespaces = [
  'page_character',
  'page_team',
  'page_teams',
  'page_weapon',
  'page_home',
  'artifact',
  'artifactNames_gen',
  'weaponNames_gen',
  'statKey_gen',
  'sheet',
  'sheet_gen',
  'tooltips_gen',
]

/** After the first page has loaded, fetch the other pages in the background so tab switches are instant. */
function usePrefetchPages() {
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection
    if (connection?.saveData || connection?.effectiveType?.includes('2g'))
      return
    let cancelled = false
    let cancelIdle = () => {}
    const queue = [...prefetchOrder]
    const next = () => {
      // Offline: a failed import would trigger the reload-on-preload-error handler (main.tsx).
      if (cancelled || !navigator.onLine) return
      const page = queue.shift()
      if (!page) {
        preloadNamespaces(prefetchNamespaces)
        return
      }
      page
        .preload()
        .catch(() => undefined)
        .finally(() => {
          cancelIdle = whenIdle(next)
        })
    }
    // Give the current page a head start before using the network/CPU for the others.
    const timer = setTimeout(() => {
      cancelIdle = whenIdle(next)
    }, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
      cancelIdle()
    }
  }, [])
}

function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 3000 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 50)
  return () => clearTimeout(id)
}

function App() {
  const dbIndex = Number.parseInt(localStorage.getItem('dbIndex') || '1')
  const [databases, setDatabases] = useDatabases(
    ArtCharDatabase,
    dbIndex,
    'GONewTabDetection'
  )
  const setDatabase = useCallback(
    (index: number, db: ArtCharDatabase) => {
      const dbs = [...databases]
      dbs[index] = db
      setDatabases(dbs)
    },
    [databases, setDatabases]
  )

  const database = databases[dbIndex - 1]
  const dbContextObj = useMemo(
    () => ({ databases, setDatabases, database, setDatabase }),
    [databases, setDatabases, database, setDatabase]
  )
  const SnowContextObj = useSnow()
  usePrefetchPages()
  return (
    <StyledEngineProvider injectFirst>
      {/* https://mui.com/guides/interoperability/#css-injection-order-2 */}
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <SnowContext.Provider value={SnowContextObj}>
          <DatabaseContext.Provider value={dbContextObj}>
            <ErrorBoundary>
              <HashRouter basename="/">
                <Content />
                <ScrollTop />
              </HashRouter>
            </ErrorBoundary>
          </DatabaseContext.Provider>
        </SnowContext.Provider>
      </ThemeProvider>
    </StyledEngineProvider>
  )
}
/**
 * Width of the main column (all keep a margin from the window edges that grows with the screen):
 * - a team page (`/teams/<id>`: four members side by side, the build tabs) is the densest, so it
 *   gets the most room;
 * - the card-grid list pages come next (the original layout kept side gutters for ads, which this
 *   site doesn't have), so wide screens show more cards per row;
 * - the other pages (home, archive, settings, docs…) would only stretch, so they keep a readable
 *   width.
 */
const listPage = /^\/(characters|artifacts|weapons|teams)(\/|$)/
const teamPage = /^\/teams\/[^/]+/
function useContentMaxWidth() {
  const { pathname } = useLocation()
  if (teamPage.test(pathname)) return 2240
  // `/teams` is the team list; `/characters/<key>` is the list + editor
  return listPage.test(pathname) ? 1920 : 1600
}

function Content() {
  useTitle()
  const contentMaxWidth = useContentMaxWidth()
  return (
    <Box
      display="flex"
      flexDirection="column"
      minHeight="100vh"
      position="relative"
      sx={(theme) => ({
        background: `radial-gradient(ellipse at top, ${theme.palette.neutral700.main} 0%, ${theme.palette.neutral800.main} 100%)`,
      })}
    >
      <Header anchor="back-to-top-anchor" />
      {/* Main content */}
      <Box display="flex" justifyContent="center" alignItems="flex-start">
        {/* Content: see useContentMaxWidth for the width; the side padding keeps it off the
            window edges (8px on phones up to 48px on large screens) */}
        <Container
          maxWidth={false}
          sx={{
            px: { xs: 1, sm: 2, md: 3, lg: 4, xl: 6 },
            flexGrow: 1,
            mx: 0,
            maxWidth: contentMaxWidth,
          }}
        >
          <Suspense
            fallback={
              <Skeleton
                variant="rectangular"
                sx={{ width: '100%', height: 1000 }}
              />
            }
          >
            <Routes>
              <Route index element={<PageHome />} />
              <Route path="/artifacts" element={<PageArtifacts />} />
              <Route path="/weapons" element={<PageWeapons />} />
              <Route path="/characters/*" element={<PageCharacters />} />
              <Route path="/teams/*">
                <Route index element={<PageTeams />} />
                <Route path=":teamId/*" element={<PageTeam />} />
              </Route>
              <Route path="/archive/*" element={<PageArchive />} />
              <Route path="/tools" element={<PageTools />} />
              <Route path="/setting" element={<PageSettings />} />
              <Route path="/doc/*" element={<PageDocumentation />} />
              <Route path="/scanner" element={<PageScanner />} />
            </Routes>
          </Suspense>
        </Container>
      </Box>

      {/* make sure footer is always at bottom */}
      <Box flexGrow={1} />
      <Snow />
      <Footer />
    </Box>
  )
}
export default App
