#!/usr/bin/env node
/**
 * Publishing steps for the static SEO pages (apps/frontend/vite-plugin-seo-pages.mts).
 *
 *   node tools/site/seo-publish.mjs lastmod <dist> <deployed-site-dir> > changed.txt
 *     Before copying a build over the deployed site: gives every sitemap URL the <lastmod> of the
 *     deployed version when its page is unchanged, or today when it changed (Google only trusts
 *     lastmod dates that are accurate). Prints the changed URLs, one per line.
 *
 *   node tools/site/seo-publish.mjs indexnow <deployed-site-dir> < changed.txt
 *     After the push: waits until the site serves the IndexNow key file and the pushed version of
 *     every changed page, then submits the changed URLs to IndexNow (Bing, Yandex, Seznam, Naver,
 *     Yep). The key is the public apps/frontend/public/<key>.txt; it only proves the site owns the
 *     submissions.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const today = new Date().toISOString().slice(0, 10)

/** [{ loc, lastmod }] from a sitemap.xml */
function readSitemap(file) {
  if (!existsSync(file)) return []
  return [
    ...readFileSync(file, 'utf8').matchAll(/<url>([\s\S]*?)<\/url>/g),
  ].map(([, u]) => ({
    loc: u.match(/<loc>(.*?)<\/loc>/)?.[1] ?? '',
    lastmod: u.match(/<lastmod>(.*?)<\/lastmod>/)?.[1],
  }))
}
/** The file serving a URL: https://host/faq/ -> faq/index.html */
const fileOf = (loc) => {
  const path = new URL(loc).pathname.replace(/^\//, '')
  return path === '' || path.endsWith('/') ? `${path}index.html` : path
}

function lastmod(dist, site) {
  const deployed = new Map(
    readSitemap(join(site, 'sitemap.xml')).map((u) => [u.loc, u.lastmod])
  )
  const changed = []
  const urls = readSitemap(join(dist, 'sitemap.xml')).map(({ loc }) => {
    const now = join(dist, fileOf(loc))
    const before = join(site, fileOf(loc))
    const same =
      existsSync(before) &&
      deployed.get(loc) &&
      readFileSync(now, 'utf8') === readFileSync(before, 'utf8')
    if (!same) changed.push(loc)
    return { loc, lastmod: same ? deployed.get(loc) : today }
  })
  writeFileSync(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`
  )
  console.error(
    `sitemap: ${urls.length} URLs, ${changed.length} changed since the deployed version`
  )
  for (const loc of changed) console.log(loc)
}

async function indexnow(site) {
  const urls = readFileSync(0, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!urls.length)
    return console.error('indexnow: nothing changed, nothing to submit')
  const publicDir = join(ROOT, 'apps/frontend/public')
  const keyFile = readdirSync(publicDir).find((f) =>
    /^[0-9a-f]{32}\.txt$/.test(f)
  )
  if (!keyFile) throw new Error('no IndexNow key file in apps/frontend/public')
  const key = keyFile.slice(0, -4)
  const { origin, host } = new URL(urls[0])
  const keyLocation = `${origin}/${keyFile}`
  // Wait for the deploy: the engines fetch the key file to check it, then crawl the pages, so both
  // must already serve what was pushed (the query string skips the CDN cache)
  const live = (url) =>
    fetch(`${url}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.text() : undefined))
      .catch(() => undefined)
  const expected = urls.map((u) => readFileSync(join(site, fileOf(u)), 'utf8'))
  for (let i = 0; ; i++) {
    const [keyText, ...pages] = await Promise.all(
      [keyLocation, ...urls].map(live)
    )
    if (keyText?.trim() === key && pages.every((t, j) => t === expected[j]))
      break
    if (i >= 40)
      throw new Error('indexnow: the deploy is not live after 10 minutes')
    await new Promise((res) => setTimeout(res, 15_000))
  }
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
  })
  // 200: received, 202: received (key check pending); anything else is an error
  console.error(
    `indexnow: ${res.status} ${res.statusText} for ${urls.length} URL(s)`
  )
  if (res.status !== 200 && res.status !== 202) process.exitCode = 1
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'lastmod' && args.length === 2)
  lastmod(resolve(args[0]), resolve(args[1]))
else if (cmd === 'indexnow' && args.length === 1)
  await indexnow(resolve(args[0]))
else {
  console.error(
    'usage: seo-publish.mjs lastmod <dist> <deployed-site-dir> > changed.txt\n       seo-publish.mjs indexnow <deployed-site-dir> < changed.txt'
  )
  process.exitCode = 2
}
