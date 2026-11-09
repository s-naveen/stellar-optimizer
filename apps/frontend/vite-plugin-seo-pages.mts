/**
 * Static, crawlable pages for search engines and AI crawlers (neither runs the app's JavaScript).
 *
 * The app is a single page with hash routes (`/#/characters/…`), which search engines treat as one
 * URL. At build time this emits plain HTML pages at real paths instead:
 * - `/<name>-optimizer/` for every playable character. Characters with a computed build
 *   (apps/frontend/seo-builds.json, made by tools/seo-builds) get its set, main stat, substat and
 *   weapon rankings and are indexed. The others are useful entry points into the app but too
 *   similar to each other to index (Google's doorway/scaled-content policies), so they are
 *   `noindex, follow` and left out of the sitemap until they get a computed build.
 * - `/optimizers/`, a hub linking all of them, and `/faq/`
 * - `sitemap.xml` (indexed pages only), `robots.txt` and `llms.txt`
 * The sitemap's lastmod dates are set when publishing (tools/site/seo-publish.mjs), from what
 * actually changed since the deployed version.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
// biome-ignore lint/style/noRestrictedImports: build-time Node code reads the same character list the app uses
import * as charConsts from '../../libs/gi/consts/src/character'

type Options = {
  /** Absolute site URL with a trailing slash, e.g. `https://example.github.io/` */
  siteUrl: string
  siteName: string
  /** HTML injected at the end of every page's <body> (e.g. the analytics snippet) */
  bodyEndHtml?: string
}

const ROOT = resolve(__dirname, '../..')
const LOC = 'libs/gi/dm-localization/assets/locales/en/'
const ELEMENTS = [
  'pyro',
  'hydro',
  'anemo',
  'electro',
  'dendro',
  'cryo',
  'geo',
] as const
type Element = (typeof ELEMENTS)[number]
const ELEMENT_LABEL: Record<Element, string> = {
  pyro: 'Pyro',
  hydro: 'Hydro',
  anemo: 'Anemo',
  electro: 'Electro',
  dendro: 'Dendro',
  cryo: 'Cryo',
  geo: 'Geo',
}
const WEAPON_LABEL: Record<string, string> = {
  sword: 'sword',
  claymore: 'claymore',
  polearm: 'polearm',
  bow: 'bow',
  catalyst: 'catalyst',
}
const STAT_LABEL: Record<string, string> = {
  hp: 'HP',
  hp_: 'HP%',
  atk: 'ATK',
  atk_: 'ATK%',
  def: 'DEF',
  def_: 'DEF%',
  eleMas: 'Elemental Mastery',
  enerRech_: 'Energy Recharge',
  critRate_: 'CRIT Rate',
  critDMG_: 'CRIT DMG',
  heal_: 'Healing Bonus',
  physical_dmg_: 'Physical DMG Bonus',
  ...Object.fromEntries(
    ELEMENTS.map((e) => [`${e}_dmg_`, `${ELEMENT_LABEL[e]} DMG Bonus`])
  ),
}
const stat = (k: string) => STAT_LABEL[k] ?? k
/** Player shorthand for short texts like meta descriptions: "ATK%/EM/CRIT Rate" */
const statShort = (k: string) =>
  ({ eleMas: 'EM', enerRech_: 'ER' })[k] ?? stat(k).replace(/ Bonus$/, '')
/** Names the community searches with, e.g. "tsaritsa optimizer" */
const ALIASES: Record<string, { name: string; short: string; slug: string }> = {
  Anastasya: {
    name: 'Tsaritsa (Anastasya)',
    short: 'the Tsaritsa',
    slug: 'tsaritsa',
  },
}
/** What the optimizer models for characters whose talent names are not out yet */
const KIT_NOTES: Record<string, string[]> = {
  Danica: [
    'Anchor: Electro RES shred, with extra Electro and Cryo shred in Radiance',
    "Maid Form: Defense (party ATK from Danica's ATK) or Battle (On-Field Skill damage bonus)",
    'Elemental Burst cast in Radiance: Stellar-Conduct, and the A4 ATK SPD stacks',
    'Stellar-Conduct hits, C2 "Toast" stacks and the C6 Elevated Stellar-Conduct damage',
  ],
  Anastasya: [
    'Blessing of Love or Honor, and To the New World',
    'Radiance: Stellar-Conduct or Stellar Swirl, including Stellar Swirl vortices',
    'Accolades for the whole party, with or without Sealing',
    'Stellar hits from the skill, burst and Honor Normal Attacks',
  ],
  Valeriy: [
    'Offensive Directive: flat Electro or Stellar-Conduct damage for the active character',
    'Impact Momentum spent by the special Charged Attack (A4), up to 130 at C4',
    'Radiance: Stellar-Conduct, the C2 party Elemental Mastery and the C6 CRIT buffs',
  ],
  Mitya: [
    'Detection Core states (Steady or Overloaded) and Gradient Beacons for the A1 Elemental Mastery',
    'Stellar-Conduct hits from beacons and core detonations',
  ],
}
/** A character's `allStat_gen.json` skillParam entry: talent → parameter → values per level */
type SkillParams = Record<string, number[][]>
const fmtInt = (n: number) => n.toLocaleString('en-US')
/**
 * Characters also played as supports: what they give the party, from their kit data (talent level 9
 * where it scales). Shown first on their page; the computed rankings there are for their DPS build.
 * The role weight comes from the user: Danica is mainly a support, Mitya and the Tsaritsa are
 * played as supports and DPS about equally.
 */
const SUPPORT_NOTES: Record<string, (sp: SkillParams) => string> = {
  Danica: (sp) => {
    // burst parameters in the order of libs/gi/sheets/src/Characters/Danica:
    // [5] party ATK as a share of her ATK, [6] its cap, [10] Energy cost
    const share = sp.burst[5][8]
    const cap = sp.burst[6][8]
    const energy = sp.burst[10][0]
    const [[perHundredAtk], [maxBase]] = sp.passive3
    const [[shred], [radShred], [radCryoShred]] = sp.passive1
    const p = (x: number) => pct(x * 100)
    return `<section class="summary">
<h2>Danica as a support</h2>
<p>Danica is mainly played as a support, in Defense Maid. What she gives the party, at talent level 9:</p>
<ul>
<li><strong>Party ATK:</strong> after her Elemental Burst in Radiance: Stellar-Conduct, Defense Maid gives every party member ATK equal to ${p(share)} of Danica's own ATK, up to ${fmtInt(cap)}. That cap needs about ${fmtInt(Math.round(cap / share / 100) * 100)} ATK, so in practice every point of her ATK counts.</li>
<li><strong>Stellar-Conduct:</strong> every 100 ATK she has raises the party's Base Stellar-Conduct DMG by ${p(perHundredAtk)}, up to ${p(maxBase)} at ${fmtInt(Math.round((maxBase / perHundredAtk) * 100))} ATK.</li>
<li><strong>RES shred:</strong> her Anchor lowers enemies' Electro RES by ${p(shred)}, and in Radiance by another ${p(radShred)} plus ${p(radCryoShred)} Cryo RES, whatever her stats.</li>
</ul>
<p>So a support Danica wants ATK: ATK% main stats (or an Energy Recharge sands if she needs one), ATK% substats and a weapon with high base ATK, plus enough Energy Recharge for her ${energy}-Energy burst. In the app, turn on Defense Maid and the burst enhancement to see the exact ATK she gives each teammate.</p>
<p class="note">The rankings below are for her on-field DPS build (Battle Maid).</p>
</section>`
  },
  Mitya: (sp) => {
    // libs/gi/sheets/src/Characters/Mitya: burst [2] beacons created, [4] Energy cost
    const beacons = sp.burst[2][0]
    const energy = sp.burst[4][0]
    const [[emPerBeacon]] = sp.passive1
    const [[perEm], [maxBase]] = sp.passive3
    const p = (x: number) => pct(x * 100)
    return `<section class="summary">
<h2>Mitya as a support</h2>
<p>Mitya is played both as a support and as a DPS, about equally. What he gives the party:</p>
<ul>
<li><strong>Elemental Mastery:</strong> with a Steady State Detection Core, every party member gains ${emPerBeacon} Elemental Mastery for each Gradient Beacon Mitya has. His Elemental Burst creates ${beacons} beacons.</li>
<li><strong>Stellar-Conduct:</strong> every point of Elemental Mastery he has raises the party's Base Stellar-Conduct DMG by ${Number((perEm * 100).toPrecision(3))}%, up to ${p(maxBase)} at ${fmtInt(Math.round(maxBase / perEm))} Elemental Mastery.</li>
</ul>
<p>So a support Mitya wants Elemental Mastery, about ${fmtInt(Math.round(maxBase / perEm))} for the full Stellar-Conduct bonus, plus enough Energy Recharge for his ${energy}-Energy burst.</p>
<p class="note">The rankings below are for his DPS build (Overloaded Detection Core).</p>
</section>`
  },
  Anastasya: (sp) => {
    // libs/gi/sheets/src/Characters/Anastasya: burst [1] Love's Stellar Glimmer DMG bonus, last: Energy cost
    const loveBonus = sp.burst[1][8]
    const energy = sp.burst[sp.burst.length - 1][0]
    const [[critDmg], [accoladesDuration]] = sp.passive1
    const [, [swirlMult]] = sp.passive2
    const [, [perHundredAtk], [maxBase]] = sp.passive3
    const p = (x: number) => pct(x * 100)
    const capAtk = fmtInt(Math.round((maxBase / perHundredAtk) * 100))
    return `<section class="summary">
<h2>The Tsaritsa as a support</h2>
<p>The Tsaritsa is played both as a support and as a DPS, about equally, in Stellar-Conduct and Stellar Swirl teams. What she gives the party, at talent level 9:</p>
<ul>
<li><strong>CRIT DMG:</strong> her Elemental Skill gives every party member Accolades for ${accoladesDuration}s: +${p(critDmg)} CRIT DMG.</li>
<li><strong>Stellar Glimmer DMG:</strong> with the Blessing of Love, her Elemental Burst To the New World increases nearby party members' Stellar Glimmer reaction DMG (Stellar-Conduct and Stellar Swirl) by ${p(loveBonus)}.</li>
<li><strong>Base DMG:</strong> every 100 ATK she has raises the party's Base Stellar-Conduct and Stellar Swirl DMG by ${p(perHundredAtk)}, up to ${p(maxBase)} at ${capAtk} ATK.</li>
<li><strong>Stellar Swirl:</strong> while she is in the party, Stellar Swirl's base reaction multiplier is ${p(swirlMult)} higher.</li>
</ul>
<p>So a support Tsaritsa wants ATK, about ${capAtk} for the full base DMG bonus, plus enough Energy Recharge for her ${energy}-Energy burst.</p>
<p class="note">The rankings below are for her DPS build (Blessing of Honor), in both team types.</p>
</section>`
  },
}
/** Not released yet: their kits follow the current beta data */
const UPCOMING = new Set(['Danica', 'Anastasya', 'Valeriy', 'Mitya'])
/** Not a playable character */
const EXCLUDED = new Set(['Somnia'])
/** Placeholder talent names in unreleased data ("C1", "Danica Normal Attack", …) */
const PLACEHOLDER =
  /^(C[1-6]|Ascension Talent \d|Stellar Talent|Life Talent|.*\b(Normal Attack|Elemental Skill|Elemental Burst))$/

type Character = {
  key: string
  name: string
  /** used inside sentences ("the Tsaritsa"); usually the name */
  short: string
  slug: string
  element: Element
  weapon: string
  rarity: number
  upcoming: boolean
  talents: { label: string; names: string[] }[]
  /** computed builds (tools/seo-builds): none, one, or one per team type */
  builds: ComputedBuild[]
  /** SUPPORT_NOTES section, for characters who are (also) played as supports */
  support?: string
}

/** One character's entry in seo-builds.json (see tools/seo-builds/generate.test.ts) */
type ComputedBuild = {
  /** for characters with several builds: what tells them apart, e.g. "Stellar Swirl team" */
  variant?: string
  label: string
  target: string
  sets: { sets: Record<string, number>; rel: number }[]
  mains: {
    sands: string
    goblet: string
    circlet: string
    rel: number
    swappable: boolean
  }[]
  rolls: { key: string; rolls: number }[]
  weapons: {
    key: string
    rarity: number
    refinement: number
    rel: number
    cycled?: boolean
    /** always shown, wherever it ranks (e.g. a weapon at both R1 and R5) */
    pinned?: boolean
    /** the assumption behind its passive, e.g. the party it counts */
    note?: string
  }[]
  scalesWith: string[]
}
type Builds = {
  generated: string
  characters: Record<string, ComputedBuild[]>
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const readJson = (p: string) =>
  JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))
const readLoc = (file: string) =>
  existsSync(resolve(ROOT, LOC + file)) ? readJson(LOC + file) : {}
/** "A, B and C" */
const list = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
const pct = (n: number) => `${n.toFixed(1).replace(/\.0$/, '')}%`

const setName = (k: string): string =>
  readLoc(`artifact_${k}_gen.json`).setName ?? k
const weaponName = (k: string): string =>
  readLoc(`weapon_${k}_gen.json`).name ?? k
/** "4-piece Heart of the Furnace" or "2-piece Gladiator's Finale + 2-piece Wanderer's Troupe" */
function setLabel(sets: Record<string, number>) {
  return Object.entries(sets)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n}-piece ${setName(k)}`)
    .join(' + ')
}
/** For 2+2 rows: what the two 2-piece bonuses give, e.g. "ATK +18% and Elemental Mastery +80" */
function twoPieceBonuses(sets: Record<string, number>) {
  if (Object.values(sets).some((n) => n !== 2)) return ''
  return list(
    Object.keys(sets).map((k) =>
      String(readLoc(`artifact_${k}_gen.json`).setEffects?.['2'] ?? '')
        .replace(
          /^Increases Elemental Mastery by (\d+)\.?$/,
          'Elemental Mastery +$1'
        )
        .replace(/\.$/, '')
    )
  )
}

function loadCharacters(builds: Builds): Character[] {
  const allStats = readJson('libs/gi/stats/src/allStat_gen.json')
  const stats = allStats.char.data
  const skillParams: Record<string, SkillParams> = allStats.char.skillParam
  const names: Record<string, string> = readJson(`${LOC}charNames_gen.json`)
  const genFiles = new Set(readdirSync(resolve(ROOT, LOC)))
  const talentNames = (locKey: string) => {
    const file = `char_${locKey}_gen.json`
    if (!genFiles.has(file)) return []
    const gen = readJson(LOC + file)
    const pick = (keys: string[]) =>
      keys
        .map((k) => gen[k]?.name as string | undefined)
        .filter((n): n is string => !!n && !PLACEHOLDER.test(n.trim()))
    return [
      { label: 'Combat talents', names: pick(['auto', 'skill', 'burst']) },
      {
        label: 'Passive talents',
        names: pick(['passive1', 'passive2', 'passive3', 'passive']),
      },
      {
        label: 'Constellations',
        names: pick([1, 2, 3, 4, 5, 6].map((i) => `constellation${i}`)),
      },
    ].filter((g) => g.names.length)
  }

  const travelers = new Set<string>(charConsts.allTravelerKeys)
  const chars: Character[] = []
  for (const key of charConsts.allCharacterKeys) {
    if (EXCLUDED.has(key)) continue
    if (travelers.has(key)) {
      const element = key.slice('Traveler'.length).toLowerCase() as Element
      if (!ELEMENTS.includes(element)) continue
      const data = stats.Traveler
      const name = `${ELEMENT_LABEL[element]} Traveler`
      chars.push({
        key,
        name,
        short: name,
        slug: slugify(name),
        element,
        weapon: data.weaponType,
        rarity: data.rarity,
        upcoming: false,
        talents: talentNames(`${key}F`),
        builds: [],
      })
      continue
    }
    const data = stats[key]
    if (!data || !names[key]) continue
    const alias = ALIASES[key]
    chars.push({
      key,
      name: alias?.name ?? names[key],
      short: alias?.short ?? names[key],
      slug: alias?.slug ?? slugify(names[key]),
      element: data.ele,
      weapon: data.weaponType,
      rarity: data.rarity,
      upcoming: UPCOMING.has(key),
      talents: talentNames(key),
      builds: builds.characters[key] ?? [],
      support: skillParams[key] && SUPPORT_NOTES[key]?.(skillParams[key]),
    })
  }
  return chars.sort((a, b) => a.name.localeCompare(b.name))
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#08080a;color:#ece5d8;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#d3bc8e}
header,main,footer{max-width:780px;margin:0 auto;padding:0 20px}
header{display:flex;align-items:center;gap:10px;height:64px;border-bottom:1px solid #22222a}
header a{display:flex;align-items:center;gap:10px;color:#ece5d8;text-decoration:none;font-weight:700}
header img{width:26px;height:26px}
h1{font-size:2rem;line-height:1.2;margin:32px 0 8px}
h2{font-size:1.15rem;margin:32px 0 8px}
.lead{color:#b8b2a7;font-size:1.05rem}
.note{color:#8f8a80;font-size:.9rem}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#d3bc8e22;color:#e6d5b1;font-size:.8rem;font-weight:600}
.cta{display:inline-block;margin:16px 0;padding:12px 22px;border-radius:10px;background:#d3bc8e;color:#14120e;font-weight:700;text-decoration:none}
ul{padding-left:20px}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}
.chips a{display:inline-block;padding:4px 12px;border:1px solid #2c2c36;border-radius:999px;text-decoration:none;color:#ece5d8}
.summary{margin:20px 0 4px;padding:6px 20px 10px;border:1px solid #2c2c36;border-radius:12px;background:#101014}
.summary h2{margin:12px 0 4px}
.summary dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:10px 0}
.summary dt{color:#8f8a80}
.summary dd{margin:0}
table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:.95rem}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #1d1d24;vertical-align:top}
th{color:#8f8a80;font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
td.r{width:2.2em;color:#8f8a80}
td small{display:block;color:#8f8a80}
.bar{display:inline-block;height:6px;margin-right:8px;border-radius:3px;background:#d3bc8e;vertical-align:middle;opacity:.75}
dl.faq dt{margin-top:22px;font-weight:700}
dl.faq dd{margin:6px 0 0;color:#cfc8bb}
footer{margin-top:48px;padding:24px 20px 40px;border-top:1px solid #22222a;color:#8f8a80;font-size:.85rem}
`

/** Search engines show (and Bing checks) up to 160 characters of a meta description */
const MAX_DESCRIPTION = 160
/** `text` as a meta description: whole, or cut at a word with "…" (and a build warning) */
function fitDescription(text: string, path: string) {
  if (text.length <= MAX_DESCRIPTION) return text
  const cut = text.slice(0, MAX_DESCRIPTION - 1)
  const fitted = `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.]+$/, '')}…`
  console.warn(
    `[seo-pages] ${path || '/'}: description cut to ${fitted.length} characters (was ${text.length}): shorten its template`
  )
  return fitted
}

function page({
  opts,
  path,
  title,
  description: fullDescription,
  body,
  breadcrumb,
  index = true,
  dateModified,
  extraLd = [],
}: {
  opts: Options
  path: string
  title: string
  description: string
  body: string
  breadcrumb: { name: string; path: string }[]
  /** false: `noindex, follow` (still crawlable for its links) */
  index?: boolean
  dateModified?: string
  extraLd?: object[]
}) {
  const url = opts.siteUrl + path
  const description = fitDescription(fullDescription, path)
  const depth = path.split('/').filter(Boolean).length
  const up = '../'.repeat(depth)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: title,
        description,
        ...(dateModified ? { dateModified } : {}),
        isPartOf: { '@id': `${opts.siteUrl}#website` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: breadcrumb.map((b, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: b.name,
          item: opts.siteUrl + b.path,
        })),
      },
      {
        '@type': 'WebSite',
        '@id': `${opts.siteUrl}#website`,
        url: opts.siteUrl,
        name: opts.siteName,
      },
      ...extraLd,
    ],
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
${index ? '' : '<meta name="robots" content="noindex, follow" />\n'}<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#08080a" />
<link rel="icon" type="image/svg+xml" href="${up}favicon.svg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(opts.siteName)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${opts.siteUrl}og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${opts.siteUrl}og-image.png" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS.trim()}</style>
</head>
<body>
<header><a href="${up}"><img src="${up}favicon.svg" alt="Logo" />${esc(opts.siteName)}</a></header>
<main>
${body}
</main>
<footer>
<p><a href="${up}optimizers/">All character optimizers</a> · <a href="${up}faq/">FAQ</a> · <a href="${up}">Open ${esc(opts.siteName)}</a></p>
<p>${esc(opts.siteName)} is not affiliated with or endorsed by HoYoverse. Genshin Impact and its characters are trademarks of their owners.</p>
</footer>
${opts.bodyEndHtml ?? ''}
</body>
</html>
`
}

const bar = (rel: number) =>
  `<span class="bar" style="width:${Math.max(4, Math.round((rel - 60) * 1.6))}px"></span>`
const relCell = (rel: number | undefined) =>
  rel === undefined
    ? '<td class="n">–</td>'
    : `<td class="n">${bar(rel)}${pct(rel)}</td>`
const substatOrder = (b: ComputedBuild) =>
  b.rolls.map((r) => esc(stat(r.key))).join(' &gt; ')
const rollsText = (b: ComputedBuild) =>
  list(b.rolls.map((r) => `${r.rolls} into ${esc(stat(r.key))}`))
const mainsText = (m: ComputedBuild['mains'][number]) =>
  `${esc(stat(m.sands))} sands, ${esc(stat(m.goblet))} goblet, ${esc(stat(m.circlet))} circlet`
type Weapon = ComputedBuild['weapons'][number]
/** A weapon at one refinement (the same weapon can be ranked at R1 and R5) */
const weaponId = (w: Weapon) => `${w.key}@${w.refinement}`
const weaponCell = (w: Weapon) =>
  `<td>${esc(weaponName(w.key))}${
    w.cycled
      ? '<small>averaged over its rotating ATK, EM and Stellar effects</small>'
      : ''
  }${w.note ? `<small>${esc(w.note)}</small>` : ''}</td><td>${w.rarity}★ R${w.refinement}</td>`
/** "Jade Vista R5": the best 4★ in a summary */
const best4Text = (b: ComputedBuild) => {
  const w = b.weapons.find((x) => x.rarity === 4)
  return w && w !== b.weapons[0]
    ? `${esc(weaponName(w.key))} R${w.refinement}`
    : ''
}
/** The rows a weapon table shows: the top `n`, plus the best 4★ and pinned weapons below them */
const shownWeapons = (b: ComputedBuild, n: number) =>
  b.weapons.filter(
    (w, i) => i < n || w.pinned || w === b.weapons.find((x) => x.rarity === 4)
  )
const setCell = (sets: Record<string, number>) => {
  const two = twoPieceBonuses(sets)
  return `<td>${esc(setLabel(sets))}${two ? `<small>${esc(two)}</small>` : ''}</td>`
}
/** "This damage scales with …", and why the element's DMG Bonus is missing if it is */
function scalesText(c: Character, b: ComputedBuild) {
  const ele = `${c.element}_dmg_`
  const scales = b.scalesWith.filter((k) => !['atk', 'hp', 'def'].includes(k))
  return `This damage scales with ${esc(list(scales.map(stat)))}.${
    b.scalesWith.includes(ele)
      ? ''
      : ` ${esc(stat(ele))} doesn't raise it: Stellar-Conduct damage counts as reaction damage.`
  }`
}

/** The assumptions behind the computed builds, and the way to your own build */
function howCalculated(
  c: Character,
  builds: ComputedBuild[],
  generated: string
) {
  const each = (b: ComputedBuild) => (b.variant ? `${esc(b.variant)}: ` : '')
  return `<h2 id="how">How this was calculated</h2>
<ul>
${builds
  .map(
    (b) =>
      `<li>${each(b)}DPS build. Situation: ${esc(b.label)}. Maximized: ${esc(b.target)}, as an average hit (CRIT Rate × CRIT DMG).</li>`
  )
  .join('\n')}
<li>Level 90, talents 9/9/9, constellation 0.</li>${
    builds.some((b) => b.weapons.some((w) => w.note))
      ? '\n<li>Weapons whose passive counts party members (marked in the weapon table) are ranked with three teammates of other elements.</li>'
      : ''
  }
<li>Artifacts: 5★ +20 with KQM Standards substats: 2 rolls of every substat plus 20 more placed by the optimizer, at most 2 per artifact and none on a piece whose main stat is the same stat.</li>
<li>Weapons: level 90, 5★ at refinement 1 and 4★ at refinement 5.</li>
<li>Enemy: level 100 with 10% RES.</li>
<li>Solo, no team buffs. Set and weapon effects the character can trigger alone are at full stacks; effects that need teammates, shields, healing or taking damage are off, and effects that rotate are averaged.</li>
<li>No Energy Recharge requirement: check that your build has enough to use the Elemental Burst on rotation.</li>
${
  c.upcoming
    ? `<li>${esc(cap(c.short))} isn't released yet: these numbers use the beta data of ${esc(generated)} and can change before release.</li>`
    : `<li>Computed on ${esc(generated)}.</li>`
}
</ul>
<p>Your own best build depends on the artifacts you have, your team and your rotation. <a href="../#/characters/${c.key}">Optimize ${esc(c.short)} with your artifacts</a> to get it.</p>`
}

/** One computed build: answer first, then the rankings and how they were made */
function singleBuildSections(
  opts: Options,
  c: Character,
  b: ComputedBuild,
  generated: string
) {
  const Short = cap(c.short)
  const top = b.sets[0]
  const mains = b.mains[0]
  const bestWeapon = b.weapons[0]
  const best4 = b.weapons.find((w) => w.rarity === 4)
  const weaponRow = (w: ComputedBuild['weapons'][number], i: number) =>
    `<tr><td class="r">${i + 1}</td>${weaponCell(w)}${relCell(w.rel)}</tr>`

  return `<section class="summary">
<h2>${esc(Short)}'s best DPS build</h2>
<dl>
<dt>Artifacts</dt><dd>${esc(setLabel(top.sets))}</dd>
<dt>Main stats</dt><dd>${mainsText(mains)}</dd>
<dt>Substats</dt><dd>${substatOrder(b)}</dd>
<dt>Weapon</dt><dd>${esc(weaponName(bestWeapon.key))}${
    best4 && best4 !== bestWeapon ? `; best 4★: ${best4Text(b)}` : ''
  }</dd>
</dl>
<p class="note">Computed by ${esc(opts.siteName)}'s damage engine. Situation: ${esc(b.label)}. Maximizing: ${esc(b.target)}. <a href="#how">How this was calculated</a></p>
</section>
<a class="cta" href="../#/characters/${c.key}">Optimize ${esc(c.short)} with your artifacts</a>
<h2>Best artifact sets for ${esc(c.short)}'s DPS build</h2>
<table><thead><tr><th></th><th>Set</th><th>Damage</th></tr></thead><tbody>
${b.sets
  .slice(0, 6)
  .map(
    (s, i) =>
      `<tr><td class="r">${i + 1}</td>${setCell(s.sets)}${relCell(s.rel)}</tr>`
  )
  .join('\n')}
</tbody></table>
<p class="note">Damage relative to the best set, each with its own best main stats and substats.</p>
<h2>Best main stats for the DPS build</h2>
<table><thead><tr><th>Sands</th><th>Goblet</th><th>Circlet</th><th>Damage</th></tr></thead><tbody>
${b.mains
  .map(
    (m) =>
      `<tr><td>${esc(stat(m.sands))}</td><td>${esc(stat(m.goblet))}</td><td>${esc(stat(m.circlet))}</td>${relCell(m.rel)}</tr>`
  )
  .join('\n')}
</tbody></table>
${
  mains.swappable
    ? `<p class="note">${esc(stat(mains.sands))} and ${esc(stat(mains.goblet))} can swap between the sands and the goblet: same stats, same damage.</p>`
    : ''
}
<h2>Substat priority</h2>
<p>Of the 20 extra substat rolls in a KQM Standards build, the optimizer puts ${rollsText(b)}.</p>
<p>${scalesText(c, b)}</p>
<h2>Best weapons for ${esc(c.short)}'s DPS build</h2>
<table><thead><tr><th></th><th>Weapon</th><th></th><th>Damage</th></tr></thead><tbody>
${shownWeapons(b, 8)
  .map((w) => weaponRow(w, b.weapons.indexOf(w)))
  .join('\n')}
</tbody></table>
<p class="note">Damage relative to the best weapon, with ${esc(setLabel(top.sets))} and the best main stats and substats for each weapon.</p>
${howCalculated(c, [b], generated)}`
}

/**
 * Rows for a table comparing several builds: the union of each build's top `n` rows, by their best
 * value in any build. `cells[i]` is the row's value in build `i` (undefined: not in its rankings).
 */
function compareRows<T>(
  builds: ComputedBuild[],
  pick: (b: ComputedBuild) => (T & { rel: number })[],
  id: (x: T) => string,
  n: number
) {
  // the union of each build's top `n` rows, then every build's value for each of them
  const rows = new Map<string, { item: T; cells: (number | undefined)[] }>()
  for (const b of builds)
    for (const x of pick(b).slice(0, n))
      if (!rows.has(id(x))) rows.set(id(x), { item: x, cells: [] })
  for (const [key, row] of rows)
    row.cells = builds.map((b) => pick(b).find((x) => id(x) === key)?.rel)
  const best = (r: { cells: (number | undefined)[] }) =>
    Math.max(...r.cells.map((v) => v ?? 0))
  return [...rows.values()].sort((a, b) => best(b) - best(a))
}

/** Several computed builds (e.g. one per team type), side by side */
function multiBuildSections(
  opts: Options,
  c: Character,
  builds: ComputedBuild[],
  generated: string
) {
  const Short = cap(c.short)
  const heads = builds
    .map((b) => `<th>${esc(b.variant ?? b.label)}</th>`)
    .join('')
  const row = (label: string, f: (b: ComputedBuild) => string) =>
    `<tr><th scope="row">${label}</th>${builds.map((b) => `<td>${f(b)}</td>`).join('')}</tr>`
  const best4 = (b: ComputedBuild) => b.weapons.find((w) => w.rarity === 4)
  const sets = compareRows(
    builds,
    (b) => b.sets,
    (s) => JSON.stringify(s.sets),
    6
  )
  const mains = compareRows(
    builds,
    (b) => b.mains,
    (m) => [m.sands, m.goblet, m.circlet].join('/'),
    4
  )
  const weapons = compareRows(builds, (b) => b.weapons, weaponId, 6)
  // each build's best 4★ and the pinned weapons, if the top rows don't have them
  for (const b of builds)
    for (const w of shownWeapons(b, 0))
      if (!weapons.some((r) => weaponId(r.item) === weaponId(w)))
        weapons.push({
          item: w,
          cells: builds.map(
            (o) => o.weapons.find((x) => weaponId(x) === weaponId(w))?.rel
          ),
        })
  weapons.sort(
    (a, b) =>
      Math.max(...b.cells.map((v) => v ?? 0)) -
      Math.max(...a.cells.map((v) => v ?? 0))
  )

  return `<section class="summary">
<h2>${esc(Short)}'s best DPS builds</h2>
<table><thead><tr><th></th>${heads}</tr></thead><tbody>
${row('Artifacts', (b) => esc(setLabel(b.sets[0].sets)))}
${row('Main stats', (b) => mainsText(b.mains[0]))}
${row('Substats', substatOrder)}
${row('Weapon', (b) => {
  const w4 = best4(b)
  return `${esc(weaponName(b.weapons[0].key))}${
    w4 && w4 !== b.weapons[0] ? `<small>best 4★: ${best4Text(b)}</small>` : ''
  }`
})}
</tbody></table>
<p class="note">Computed by ${esc(opts.siteName)}'s damage engine for each team type. <a href="#how">How this was calculated</a></p>
</section>
<a class="cta" href="../#/characters/${c.key}">Optimize ${esc(c.short)} with your artifacts</a>
<h2>Best artifact sets for ${esc(c.short)}'s DPS build</h2>
<table><thead><tr><th>Set</th>${heads}</tr></thead><tbody>
${sets.map((r) => `<tr>${setCell(r.item.sets)}${r.cells.map(relCell).join('')}</tr>`).join('\n')}
</tbody></table>
<p class="note">Damage relative to the best set for that team type, each with its own best main stats and substats.</p>
<h2>Best main stats for the DPS build</h2>
<table><thead><tr><th>Sands</th><th>Goblet</th><th>Circlet</th>${heads}</tr></thead><tbody>
${mains
  .map(
    (r) =>
      `<tr><td>${esc(stat(r.item.sands))}</td><td>${esc(stat(r.item.goblet))}</td><td>${esc(stat(r.item.circlet))}</td>${r.cells.map(relCell).join('')}</tr>`
  )
  .join('\n')}
</tbody></table>
${
  builds[0].mains[0].swappable
    ? `<p class="note">${esc(stat(builds[0].mains[0].sands))} and ${esc(stat(builds[0].mains[0].goblet))} can swap between the sands and the goblet: same stats, same damage.</p>`
    : ''
}
<h2>Substat priority</h2>
<p>Of the 20 extra substat rolls in a KQM Standards build, the optimizer puts:</p>
<ul>
${builds.map((b) => `<li>${esc(b.variant ?? b.label)}: ${rollsText(b)}.</li>`).join('\n')}
</ul>
<p>${scalesText(c, builds[0])}</p>
<h2>Best weapons for ${esc(c.short)}'s DPS build</h2>
<table><thead><tr><th>Weapon</th><th></th>${heads}</tr></thead><tbody>
${weapons.map((r) => `<tr>${weaponCell(r.item)}${r.cells.map(relCell).join('')}</tr>`).join('\n')}
</tbody></table>
<p class="note">Damage relative to the best weapon for that team type, with that team type's best set and the best main stats and substats for each weapon. A dash: not in that team type's top ${builds[0].weapons.length}.</p>
${howCalculated(c, builds, generated)}`
}

/** "Stellar-Conduct and Stellar Swirl teams" from variants "Stellar-Conduct team", "Stellar Swirl team" */
function variantsText(builds: ComputedBuild[]) {
  const v = builds.map((b) => b.variant ?? b.label)
  return v.every((x) => x.endsWith(' team'))
    ? `${list(v.map((x) => x.slice(0, -' team'.length)))} teams`
    : list(v)
}

/** The computed builds of a character: one, or several side by side */
function buildSections(
  opts: Options,
  c: Character,
  builds: ComputedBuild[],
  generated: string
) {
  return builds.length === 1
    ? singleBuildSections(opts, c, builds[0], generated)
    : multiBuildSections(opts, c, builds, generated)
}

function characterPage(
  opts: Options,
  c: Character,
  all: Character[],
  generated: string
) {
  const element = ELEMENT_LABEL[c.element]
  const weapon = WEAPON_LABEL[c.weapon] ?? c.weapon
  // "the Tsaritsa (Anastasya)" in running text, the plain name otherwise
  const named = c.short === c.name ? c.name : `${c.short} (${c.key})`
  const builds = c.builds
  const b = builds[0]
  const title = !b
    ? `${c.name} Optimizer: Build Calculator for Your Own Artifacts`
    : c.support
      ? `${c.name} Optimizer: Support & DPS Builds, Artifacts & Weapons`
      : `${c.name} Optimizer: Best DPS Build, Artifacts & Weapons`
  const description = b
    ? builds.length > 1
      ? `${cap(c.short)}${c.support ? ' as a support, plus' : ':'} computed DPS builds for ${variantsText(builds)}, with the best sets, main stats and weapons. Optimize yours, free.`
      : `${c.support ? `${cap(c.short)} as a support, plus the computed DPS build: ` : `${cap(c.short)}'s best DPS build: `}${setLabel(b.sets[0].sets)}, ${statShort(b.mains[0].sands)}/${statShort(b.mains[0].goblet)}/${statShort(b.mains[0].circlet)}, ${weaponName(b.weapons[0].key)}. Optimize yours, free.`
    : `Optimize ${named}'s Genshin Impact build from your own artifacts: it tries the combinations you own and calculates the damage. Free, in your browser.`
  const related = all.filter((o) => o.element === c.element && o.key !== c.key)
  const kit = KIT_NOTES[c.key] ?? []
  const appLink = `../#/characters/${c.key}`
  const body = `<h1>${esc(c.name)} Optimizer</h1>
${c.upcoming ? '<p><span class="badge">Upcoming character</span></p>\n' : ''}<p class="lead">Build, artifact and weapon optimizer for ${esc(named)}, the ${c.rarity}★ ${element} character who fights with a ${weapon} in Genshin Impact.${
    c.upcoming
      ? ` ${esc(cap(c.short))} isn't released yet: the kit follows the current beta data, so numbers can still change.`
      : ''
  }</p>
${c.support ?? ''}${b ? buildSections(opts, c, builds, generated) : `<a class="cta" href="${appLink}">Optimize ${esc(c.short)}</a>`}
<h2>What you can do for ${esc(c.short)}</h2>
<ul>
<li>Find the best artifact set and main stats for ${esc(c.short)} from the artifacts you own.</li>
<li>Try other weapons and compare how each build changes ${esc(c.short)}'s damage, healing or shields.</li>
<li>Build teams with buffs, resonances and reactions, and read every talent's damage number.</li>
<li>Set minimum stats such as Energy Recharge or CRIT Rate and only see builds that reach them.</li>
<li>Find out which substats and artifacts are worth leveling next.</li>
</ul>
${
  kit.length
    ? `<h2>What the optimizer models for ${esc(c.short)}</h2>\n<ul>${kit
        .map((k) => `<li>${esc(k)}</li>`)
        .join('')}</ul>`
    : ''
}
${c.talents
  .map(
    (g) =>
      `<h2>${esc(cap(c.short))}: ${g.label.toLowerCase()}</h2>\n<ul>${g.names
        .map((n) => `<li>${esc(n)}</li>`)
        .join('')}</ul>`
  )
  .join('\n')}
${
  related.length
    ? `<h2>More ${element} character optimizers</h2>\n<ul class="chips">${related
        .map(
          (o) => `<li><a href="../${o.slug}-optimizer/">${esc(o.name)}</a></li>`
        )
        .join('')}</ul>`
    : ''
}`
  return page({
    opts,
    path: `${c.slug}-optimizer/`,
    title: `${title} | ${opts.siteName}`,
    description,
    body,
    index: builds.length > 0,
    dateModified: b ? generated : undefined,
    breadcrumb: [
      { name: opts.siteName, path: '' },
      { name: 'Character optimizers', path: 'optimizers/' },
      { name: `${c.name} Optimizer`, path: `${c.slug}-optimizer/` },
    ],
  })
}

function hubPage(opts: Options, all: Character[]) {
  const upcoming = all.filter((c) => c.upcoming)
  const computed = all.filter((c) => c.builds.length)
  const chip = (c: Character) =>
    `<li><a href="../${c.slug}-optimizer/">${esc(c.name)}</a></li>`
  const body = `<h1>Genshin Impact character optimizers</h1>
<p class="lead">Pick a character to optimize their build from your own inventory: the best artifacts and main stats, damage for every talent, teams and upgrade suggestions. Free, in your browser.</p>
<a class="cta" href="../">Open ${esc(opts.siteName)}</a>
${
  computed.length
    ? `<h2>Computed DPS builds</h2>\n<p>Set, main stat, substat and weapon rankings worked out by the optimizer.</p>\n<ul class="chips">${computed.map(chip).join('')}</ul>`
    : ''
}
${upcoming.length ? `<h2>New and upcoming</h2>\n<ul class="chips">${upcoming.map(chip).join('')}</ul>` : ''}
${ELEMENTS.map((e) => {
  const chars = all.filter((c) => c.element === e)
  return chars.length
    ? `<h2>${ELEMENT_LABEL[e]}</h2>\n<ul class="chips">${chars.map(chip).join('')}</ul>`
    : ''
}).join('\n')}`
  return page({
    opts,
    path: 'optimizers/',
    title: `Genshin Impact Character Optimizers: Builds for Every Character | ${opts.siteName}`,
    description: `Artifact and build optimizers for every Genshin Impact character, with computed DPS builds for ${list(
      computed.map((c) => c.short)
    )}. Free and in your browser.`,
    body,
    breadcrumb: [
      { name: opts.siteName, path: '' },
      { name: 'Character optimizers', path: 'optimizers/' },
    ],
  })
}

/** Plain answers, written to be quoted (search snippets, AI answers) */
function faqPage(opts: Options, all: Character[]) {
  const computed = all.filter((c) => c.builds.length)
  const upcoming = all.filter((c) => c.upcoming)
  const link = (c: Character) =>
    `<a href="../${c.slug}-optimizer/">${esc(c.name.replace(/ \(.*\)$/, ''))}</a>`
  const qa: { q: string; a: string }[] = [
    {
      q: `What is ${opts.siteName}?`,
      a: `${esc(opts.siteName)} is a free Genshin Impact build optimizer that runs in your browser. You import your artifacts and weapons, pick a character and a target (a talent's damage, healing or shield), and it searches the combinations of artifacts you own for the build that gives the highest number, using the game's damage formulas.`,
    },
    {
      q: 'Is it free? Do I need an account?',
      a: 'It is free, with no account and no ads.',
    },
    {
      q: 'Where is my data stored?',
      a: `In your browser's storage on your own device. Your artifacts, weapons and characters are never uploaded, and you can export a backup file at any time. The site counts visits with cookieless Cloudflare Web Analytics.`,
    },
    {
      q: 'How do I import my artifacts?',
      a: 'Scan your inventory with a scanner such as Inventory Kamera, Irminsul or AdeptiScanner, which save a GOOD file, then import that file in the app. You can also add artifacts from screenshots or by hand.',
    },
    {
      q: 'Which characters are supported?',
      a: `Every playable character, including upcoming ones from the current beta data: ${list(
        upcoming.map(link)
      )}. Upcoming kits can still change before release.`,
    },
    {
      q: 'How does it find the best build?',
      a: 'It goes through the artifact combinations you own that fit your rules (sets, main stats, minimum stats such as Energy Recharge) and keeps the builds with the highest result. Combinations that provably cannot win are skipped, so millions are checked in seconds, on your graphics card when the browser supports WebGPU.',
    },
    {
      q: 'Where do the "best build" rankings on character pages come from?',
      a: `The optimizer computes them: for ${list(
        computed.map(link)
      )} it ranks artifact sets, main stats and weapons for a DPS build, with KQM Standards artifacts in one stated situation. Each page lists its assumptions. Your best build depends on your own artifacts and team, which the app works out for you.`,
    },
    {
      q: 'Does it include teams and buffs?',
      a: 'Yes. Add up to four characters to a team and their buffs, elemental resonance and reactions are included in the damage.',
    },
  ]
  const strip = (h: string) => h.replace(/<[^>]+>/g, '')
  const body = `<h1>${esc(opts.siteName)} FAQ</h1>
<p class="lead">Questions about the Genshin Impact build optimizer: what it does, your data, importing artifacts and the computed builds.</p>
<dl class="faq">
${qa.map(({ q, a }) => `<dt>${esc(q)}</dt>\n<dd>${a}</dd>`).join('\n')}
</dl>
<a class="cta" href="../">Open ${esc(opts.siteName)}</a>`
  return page({
    opts,
    path: 'faq/',
    title: `${opts.siteName} FAQ: Genshin Impact Build Optimizer`,
    description: `${opts.siteName} FAQ: a free Genshin Impact build optimizer in your browser, no account. Your data stays on your device; import artifacts from scanners.`,
    body,
    breadcrumb: [
      { name: opts.siteName, path: '' },
      { name: 'FAQ', path: 'faq/' },
    ],
    extraLd: [
      {
        '@type': 'FAQPage',
        mainEntity: qa.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: strip(a) },
        })),
      },
    ],
  })
}

/** https://llmstxt.org: a short Markdown map of the site for AI tools */
function llmsTxt(opts: Options, all: Character[]) {
  const computed = all.filter((c) => c.builds.length)
  return `# ${opts.siteName}

> Free Genshin Impact artifact and build optimizer that runs in the browser, with no account. It finds the best artifacts, main stats and weapons for each character from the player's own inventory, using full damage calculations, and supports upcoming characters such as Danica and the Tsaritsa (Anastasya) from beta data.

The app itself needs JavaScript. The pages below are plain HTML.

## Computed DPS builds

${computed
  .map((c) => {
    const best = c.builds
      .map(
        (b) =>
          `${b.variant ? `${b.variant}: ` : ''}${setLabel(b.sets[0].sets)} with ${weaponName(b.weapons[0].key)}`
      )
      .join('; ')
    return `- [${c.name} Optimizer](${opts.siteUrl}${c.slug}-optimizer/): best artifact sets, main stats, substats and weapons for ${c.short}'s DPS build, computed by the optimizer (best: ${best})${c.support ? `, plus what ${c.short} gives the party as a support` : ''}`
  })
  .join('\n')}

## Site

- [FAQ](${opts.siteUrl}faq/): what the optimizer does, data privacy, importing artifacts
- [Character optimizers](${opts.siteUrl}optimizers/): links to every character
- [${opts.siteName}](${opts.siteUrl}): the optimizer app
`
}

/** A tiny page at the other name that forwards to the canonical one (e.g. /anastasya-optimizer/). */
function aliasPage(opts: Options, from: string, to: Character) {
  const url = `${opts.siteUrl}${to.slug}-optimizer/`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(to.name)} Optimizer | ${esc(opts.siteName)}</title>
<link rel="canonical" href="${url}" />
<meta name="robots" content="noindex, follow" />
<meta http-equiv="refresh" content="0; url=../${to.slug}-optimizer/" />
</head>
<body><p><a href="../${to.slug}-optimizer/">${esc(to.name)} Optimizer</a> (${esc(from)})</p></body>
</html>
`
}

export function seoPagesPlugin(opts: Options): Plugin {
  return {
    name: 'seo-pages',
    apply: 'build',
    generateBundle() {
      const buildsFile = resolve(__dirname, 'seo-builds.json')
      const builds: Builds = existsSync(buildsFile)
        ? JSON.parse(readFileSync(buildsFile, 'utf8'))
        : { generated: '', characters: {} }
      const chars = loadCharacters(builds)
      const emit = (fileName: string, source: string) =>
        this.emitFile({ type: 'asset', fileName, source })
      for (const c of chars)
        emit(
          `${c.slug}-optimizer/index.html`,
          characterPage(opts, c, chars, builds.generated)
        )
      for (const [key, alias] of Object.entries(ALIASES)) {
        const c = chars.find((x) => x.key === key)
        const other = slugify(key)
        if (c && other !== alias.slug)
          emit(`${other}-optimizer/index.html`, aliasPage(opts, key, c))
      }
      emit('optimizers/index.html', hubPage(opts, chars))
      emit('faq/index.html', faqPage(opts, chars))
      emit('llms.txt', llmsTxt(opts, chars))
      // indexed pages only; tools/site/seo-publish.mjs sets each lastmod from real changes
      const today = new Date().toISOString().slice(0, 10)
      const urls = [
        '',
        'optimizers/',
        'faq/',
        ...chars
          .filter((c) => c.builds.length)
          .map((c) => `${c.slug}-optimizer/`),
      ]
      emit(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${opts.siteUrl}${u}</loc><lastmod>${today}</lastmod></url>`
  )
  .join('\n')}
</urlset>
`
      )
      emit(
        'robots.txt',
        `User-agent: *\nAllow: /\n\nSitemap: ${opts.siteUrl}sitemap.xml\n`
      )
    },
  }
}
