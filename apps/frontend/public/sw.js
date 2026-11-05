/* Stellar Optimizer service worker — makes repeat visits load from the browser cache.
 * - content-hashed files (name-XXXXXXXX.ext): cache-first (they never change)
 * - other same-origin GET files (e.g. locale JSON): stale-while-revalidate
 * - page navigations (index.html): network-first, fall back to the cache after 3s / offline
 * Entries are evicted 30 days after they were cached (a file that is still used is simply
 * fetched again), so the files of old deploys do not pile up.
 */
const CACHE = 'go-cache-v2' // bumping the version deletes the previous cache on activation
const HASHED = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_AGE_MS = 30 * DAY_MS
const CACHED_AT = 'x-go-cached-at'
const META = new Request('./__go-sw-last-cleanup__')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

/** Store a copy of a complete (200) response, stamped with the time it was cached. */
async function store(cache, req, res) {
  if (res.status !== 200 || res.type !== 'basic') return // skip e.g. 206 range responses
  const headers = new Headers(res.headers)
  headers.set(CACHED_AT, String(Date.now()))
  const body = await res.blob()
  await cache.put(
    req,
    new Response(body, { status: 200, statusText: res.statusText, headers })
  )
}

/**
 * Fetch from the network; a copy is stored in the cache in the background.
 * `event.waitUntil` is registered while the response is still pending, as required.
 */
function fetchAndStore(cache, req, event) {
  let stored = Promise.resolve()
  const response = fetch(req).then((res) => {
    stored = store(cache, req, res.clone())
    return res
  })
  event.waitUntil(response.then(() => stored).catch(() => undefined))
  return response
}

async function cacheFirst(req, event) {
  const cache = await caches.open(CACHE)
  return (await cache.match(req)) ?? fetchAndStore(cache, req, event)
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  const update = fetchAndStore(cache, req, event)
  return hit ?? update
}

async function networkFirst(req, event) {
  const cache = await caches.open(CACHE)
  const network = fetchAndStore(cache, req, event)
  let timer
  const slow = new Promise((resolve) => {
    timer = setTimeout(resolve, 3000)
  })
  try {
    // Slow network: serve the cached page if there is one, otherwise keep waiting for it.
    const res = await Promise.race([network, slow])
    if (res) return res
    return (await cache.match(req)) ?? (await network)
  } catch (e) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** At most once a day, and well after the page has loaded, delete entries older than 30 days. */
async function evictOld() {
  const cache = await caches.open(CACHE)
  const meta = await cache.match(META)
  const lastCleanup = Number(meta ? await meta.text() : 0)
  if (Date.now() - lastCleanup < DAY_MS) return
  await cache.put(META, new Response(String(Date.now())))
  await new Promise((resolve) => setTimeout(resolve, 20000))
  const now = Date.now()
  for (const req of await cache.keys()) {
    if (req.url === META.url) continue
    const res = await cache.match(req)
    const cachedAt = Number(res?.headers.get(CACHED_AT))
    if (!cachedAt || now - cachedAt > MAX_AGE_MS) await cache.delete(req)
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.headers.has('range')) return // let the browser handle partial (media) requests
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, event))
    event.waitUntil(evictOld().catch(() => undefined))
  } else if (HASHED.test(url.pathname)) {
    event.respondWith(cacheFirst(req, event))
  } else {
    event.respondWith(staleWhileRevalidate(req, event))
  }
})
