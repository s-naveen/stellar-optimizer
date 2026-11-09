import { ElementIcon, StatIcon } from '@genshin-optimizer/gi/svgicons'
import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { BuildCardData } from './buildCardData'

/**
 * The card's width in CSS pixels (drawn at `scale` times that). Its height follows the content
 * (more stats or totals make it taller); CARD_HEIGHT is the usual one, for placeholders.
 */
export const CARD_WIDTH = 1600
export const CARD_HEIGHT = 958

/**
 * The look: a night sky in the character's colors (its namecard, blurred and darkened), the
 * character's splash art standing in it, its constellation as a column of medallions, a serif for
 * names and headline numbers, and the build laid out on open space: only the artifacts, which are
 * objects, and what they add up to sit on cards.
 */
export const SANS =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
export const SERIF =
  '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Noto Serif", serif'
export const NIGHT = '#0e1020'
export const TEXT = '#ece5d8'
export const MUTED = 'rgba(236, 229, 216, 0.62)'
export const FAINT = 'rgba(236, 229, 216, 0.38)'
export const HAIRLINE = 'rgba(236, 229, 216, 0.10)'
export const GOLD = '#d3bc8e'
export const TILE = 'rgba(14, 16, 32, 0.55)'
export const RARITY: Record<number, string> = {
  1: '#8a8a93',
  2: '#6fa982',
  3: '#5aa7c0',
  4: '#b886ca',
  5: '#e6ac54',
}

// layout: one margin all round; the art on the left, the build on the right
const MARGIN = 40
const ART_W = 600
/** the art fades out over the gap between it and the build */
const ART_FADE_W = 720
const RIGHT_X = 644
const RIGHT_END = CARD_WIDTH - MARGIN
const RIGHT_W = RIGHT_END - RIGHT_X
const STAT_ROW_H = 38
const ART_TILE_H = 372
// the artifacts' totals: a slim strip of icon and value pairs, with RV and CV at its end
const TOTALS_PAD = 22
const TOTALS_ROW_H = 34
const TOTALS_ICON = 16
const TOTALS_SIZE = 19

/** An MUI SVG icon as an image URL, filled with `color` (rendered once off-screen) */
const iconCache = new Map<string, string>()
function svgIconUrl(cacheKey: string, element: ReactElement, color: string) {
  const key = `${cacheKey}|${color}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(element))
  const svg = host.querySelector('svg')
  let url = ''
  if (svg) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', '96')
    svg.setAttribute('height', '96')
    svg.setAttribute('fill', color)
    svg.removeAttribute('class')
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`
  }
  root.unmount()
  iconCache.set(key, url)
  return url
}
export const statIconUrl = (statKey: string, color: string) =>
  svgIconUrl(`stat:${statKey}`, <StatIcon statKey={statKey} />, color)
export const elementIconUrl = (element: string, color: string) =>
  svgIconUrl(
    `element:${element}`,
    <ElementIcon ele={element as Parameters<typeof ElementIcon>[0]['ele']} />,
    color
  )

/** HP%, ATK% and DEF% share their flat stat's icon: theirs carry a "%" */
export const PERCENT_KEYS = new Set(['hp_', 'atk_', 'def_'])

/**
 * The icon, a little smaller, with a "%" at its lower right, cut out of it so the two stay apart
 * (drawn at the SVG icons' 96 px, scaled down where used)
 */
export function percentIcon(icon: HTMLImageElement, color: string) {
  const size = 96
  const off = offscreen(size, size)
  const c = off.getContext('2d')
  if (!c) return icon
  c.drawImage(icon, 0, 0, 80, 80)
  c.font = `800 54px ${SANS}`
  c.textAlign = 'right'
  c.textBaseline = 'alphabetic'
  c.lineJoin = 'round'
  c.lineWidth = 14
  c.globalCompositeOperation = 'destination-out'
  c.strokeText('%', size, size - 2)
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = color
  c.fillText('%', size, size - 2)
  return off
}

export function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  if (!src) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(undefined)
    img.src = src
  })
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A small diamond (a point of a medallion's frame) */
function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r * 0.7, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r * 0.7, y)
  ctx.closePath()
  ctx.fill()
}

/** `value` cut with "…" to fit `maxWidth` in the current font */
function fitText(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number
) {
  if (ctx.measureText(value).width <= maxWidth) return value
  let t = value
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth)
    t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

type TextOptions = {
  size: number
  weight?: number
  color?: string
  align?: CanvasTextAlign
  family?: string
  maxWidth?: number
  /** the smallest size the text may shrink to, to fit `maxWidth`, before it is cut */
  minSize?: number
}
/** Draws `value` and returns its width */
export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  {
    size,
    weight = 400,
    color = TEXT,
    align = 'left',
    family = SANS,
    maxWidth,
    minSize = size,
  }: TextOptions
) {
  const font = (px: number) => `${weight} ${px}px ${family}`
  ctx.font = font(size)
  if (maxWidth)
    for (
      let shrunk = size - 1;
      shrunk >= minSize && ctx.measureText(value).width > maxWidth;
      shrunk--
    )
      ctx.font = font(shrunk)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  const shown = maxWidth ? fitText(ctx, value, maxWidth) : value
  ctx.fillText(shown, x, y)
  return ctx.measureText(shown).width
}

/** A small seeded random generator (the same stars for the same character) */
export function seeded(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

/** "#61dbbb" → "97, 219, 187" */
export function hexRgb(hex: string) {
  const v = Number.parseInt(hex.slice(1, 7), 16)
  return `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`
}

export function offscreen(w: number, h: number) {
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  return off
}

/**
 * The splash art (transparent, the character standing in its middle): the character large in the
 * art's column, its feet under the name, faded out toward the build. Drawn off-screen at the
 * card's scale.
 */
function splashLayer(
  splash: HTMLImageElement,
  height: number,
  scale: number
): HTMLCanvasElement {
  const w = Math.round(ART_FADE_W * scale)
  const h = Math.round(height * scale)
  const off = offscreen(w, h)
  const c = off.getContext('2d')
  if (!c) return off
  // card pixels per art pixel: the art's height is 1.3 card heights, from 8% down
  const zoom = (height * 1.3) / splash.naturalHeight
  const centerX = 290
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.setTransform(
    zoom * scale,
    0,
    0,
    zoom * scale,
    (centerX - (splash.naturalWidth / 2) * zoom) * scale,
    -splash.naturalHeight * 0.08 * zoom * scale
  )
  c.drawImage(splash, 0, 0)
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'destination-in'
  const fade = c.createLinearGradient(0, 0, w, 0)
  fade.addColorStop(0, 'rgba(0,0,0,1)')
  fade.addColorStop(0.62, 'rgba(0,0,0,1)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = fade
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
  return off
}

/**
 * Without splash art, the card art "moonlit": highlights pulled down a little, then dissolved into
 * the card through a soft oval and faded edges (its pale background is as light as anime skin, so
 * colors are left alone). Drawn off-screen at the card's scale.
 */
export function moonlitArt(
  art: HTMLImageElement,
  crop: BuildCardData['artCrop'],
  height: number,
  scale: number
): HTMLCanvasElement {
  const w = Math.round(ART_W * scale)
  const h = Math.round(height * scale)
  const off = offscreen(w, h)
  const c = off.getContext('2d', { willReadFrequently: true })
  if (!c) return off
  // cover the panel (a card art without its logo band and its patterned left edge)
  const left = art.naturalWidth * crop.left
  const top = art.naturalHeight * crop.top
  const iw = art.naturalWidth - left
  const ih = art.naturalHeight - top
  const fit = Math.max(w / iw, h / ih)
  const sw = w / fit
  const sh = h / fit
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(art, left + (iw - sw) / 2, top, sw, sh, 0, 0, w, h)

  const img = c.getImageData(0, 0, w, h)
  const px = img.data
  for (let i = 0; i < px.length; i += 4) {
    const light = Math.max(px[i], px[i + 1], px[i + 2]) / 255
    const k = 1 - 0.22 * light ** 4
    px[i] *= k
    px[i + 1] *= k
    px[i + 2] *= k
  }
  c.putImageData(img, 0, 0)

  c.globalCompositeOperation = 'destination-in'
  const oval = c.createRadialGradient(
    w * 0.46,
    h * 0.42,
    h * 0.18,
    w * 0.46,
    h * 0.42,
    h * 0.72
  )
  oval.addColorStop(0, 'rgba(0,0,0,1)')
  oval.addColorStop(0.55, 'rgba(0,0,0,0.92)')
  oval.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = oval
  c.fillRect(0, 0, w, h)
  const horizontal = c.createLinearGradient(0, 0, w, 0)
  horizontal.addColorStop(0, 'rgba(0,0,0,0.3)')
  horizontal.addColorStop(0.2, 'rgba(0,0,0,1)')
  horizontal.addColorStop(0.58, 'rgba(0,0,0,1)')
  horizontal.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = horizontal
  c.fillRect(0, 0, w, h)
  const vertical = c.createLinearGradient(0, 0, 0, h)
  vertical.addColorStop(0, 'rgba(0,0,0,0.55)')
  vertical.addColorStop(0.1, 'rgba(0,0,0,1)')
  vertical.addColorStop(0.62, 'rgba(0,0,0,1)')
  vertical.addColorStop(1, 'rgba(0,0,0,0.12)')
  c.fillStyle = vertical
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
  return off
}

/**
 * The art's colors as a wash: the middle of the art (where the character is), drawn small in two
 * steps (a smooth blur), to be stretched over the card
 */
export function artWash(art: HTMLImageElement) {
  const sx = art.naturalWidth * 0.2
  const sw = art.naturalWidth * 0.6
  const mid = offscreen(96, 96)
  const m = mid.getContext('2d')
  const tiny = offscreen(10, 10)
  const t = tiny.getContext('2d')
  if (!m || !t) return tiny
  m.imageSmoothingQuality = 'high'
  m.drawImage(art, sx, 0, sw, art.naturalHeight, 0, 0, 96, 96)
  t.imageSmoothingQuality = 'high'
  t.drawImage(mid, 0, 0, 10, 10)
  return tiny
}

/** A five-pointed star, filled */
export function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number
) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.48 : r
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
}

/**
 * The art's most vivid color (among its visible, not too dark pixels, sampled small), to light
 * the corner the art leaves empty
 */
export function artTone(art: HTMLImageElement): string | undefined {
  const n = 24
  const small = offscreen(n, n)
  const c = small.getContext('2d', { willReadFrequently: true })
  if (!c) return undefined
  c.drawImage(art, 0, 0, n, n)
  const px = c.getImageData(0, 0, n, n).data
  let best: [number, number, number] | undefined
  let bestScore = 0
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (a < 160 || max < 70) continue
    const score = ((max - min) / max) * (max / 255)
    if (score > bestScore) {
      bestScore = score
      best = [r, g, b]
    }
  }
  return best && `${best[0]}, ${best[1]}, ${best[2]}`
}

/** A star seen through haze: a soft halo round a small bright point */
function twinkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number
) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 6)
  halo.addColorStop(0, `rgba(236, 229, 216, ${alpha * 0.35})`)
  halo.addColorStop(1, 'rgba(236, 229, 216, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(246, 241, 232, ${alpha})`
  ctx.fill()
}

/**
 * The night's depth behind the build: a faint band of haze across the sky, like the Milky Way,
 * tinted by the element, with small stars gathered along it and a few that twinkle. No lines: only
 * light, drawn small (soft) and stretched.
 */
export function milkyWay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rand: () => number,
  tint: string
) {
  // the band runs from above the middle of the card to past its bottom right corner
  const x0 = W * 0.5
  const y0 = -H * 0.12
  const dx = W * 1.08 - x0
  const dy = H * 1.12 - y0
  const len = Math.hypot(dx, dy)
  const nx = -dy / len
  const ny = dx / len
  const gauss = () => rand() + rand() + rand() - 1.5
  // the haze, at an eighth of the size
  const k = 1 / 8
  const haze = offscreen(Math.ceil(W * k), Math.ceil(H * k))
  const h = haze.getContext('2d')
  if (h) {
    for (let i = 0; i < 14; i++) {
      const t = i / 13
      const off = gauss() * 60
      const cx = (x0 + dx * t + nx * off) * k
      const cy = (y0 + dy * t + ny * off) * k
      const r = (110 + rand() * 150) * k
      const g = h.createRadialGradient(cx, cy, 0, cx, cy, r)
      const warm = i % 3 !== 0
      g.addColorStop(0, warm ? 'rgba(236, 229, 216, 0.07)' : `${tint}1c`)
      g.addColorStop(1, warm ? 'rgba(236, 229, 216, 0)' : `${tint}00`)
      h.fillStyle = g
      h.fillRect(0, 0, haze.width, haze.height)
    }
    ctx.drawImage(haze, 0, 0, W, H)
  }
  // small stars, thick in the band and thinning out from it
  for (let i = 0; i < 260; i++) {
    const t = rand()
    const off = gauss() * 95
    const x = x0 + dx * t + nx * off
    const y = y0 + dy * t + ny * off
    const r = 0.3 + rand() ** 3 * 1.1
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(236, 229, 216, ${0.1 + rand() * 0.35})`
    ctx.fill()
  }
  for (let i = 0; i < 5; i++) {
    const t = 0.08 + rand() * 0.6
    const off = gauss() * 60
    twinkle(
      ctx,
      x0 + dx * t + nx * off,
      y0 + dy * t + ny * off,
      1 + rand() * 0.8,
      0.55 + rand() * 0.3
    )
  }
}

/** A faint light behind an item's icon, in its rarity's color */
export function rarityGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
) {
  const g = ctx.createRadialGradient(x, y, 2, x, y, r)
  g.addColorStop(0, `${color}2e`)
  g.addColorStop(1, `${color}00`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

type TotalsItem = { total: BuildCardData['artifactTotals'][number]; x: number }

/**
 * The totals strip: its stats, an icon and a value each, beside the RV and CV at its end. One row
 * when they fit (evenly spaced, never far apart); otherwise as few rows as fit, in columns.
 */
function planTotals(ctx: CanvasRenderingContext2D, data: BuildCardData) {
  ctx.font = `700 ${TOTALS_SIZE}px ${SANS}`
  const items = data.artifactTotals.map((total) => ({
    total,
    w: TOTALS_ICON + 7 + ctx.measureText(total.value).width,
  }))
  const scoresW = drawScores(ctx, data, 0, 0, false)
  const innerX = RIGHT_X + TOTALS_PAD
  const areaW = RIGHT_W - 2 * TOTALS_PAD - scoresW - 44
  const minGap = 14
  const used = items.reduce((w, i) => w + i.w, 0)
  let rows: TotalsItem[][]
  if (used + (items.length - 1) * minGap <= areaW) {
    const gap =
      items.length > 1 ? Math.min(44, (areaW - used) / (items.length - 1)) : 0
    let x = innerX
    rows = [
      items.map(({ total, w }) => {
        const item = { total, x }
        x += w + gap
        return item
      }),
    ]
  } else {
    // columns: as many as fit the widest item
    const widest = Math.max(...items.map((i) => i.w)) + minGap
    const cols = Math.max(1, Math.floor((areaW + minGap) / widest))
    const per = Math.min(
      cols,
      Math.ceil(items.length / Math.ceil(items.length / cols))
    )
    const colW = (areaW + minGap) / per
    rows = []
    items.forEach(({ total }, i) => {
      const r = Math.floor(i / per)
      rows[r] = rows[r] ?? []
      rows[r].push({ total, x: innerX + (i % per) * colW })
    })
  }
  return {
    rows,
    scoresW,
    height: 2 * 10 + Math.max(1, rows.length) * TOTALS_ROW_H,
  }
}

/** The build's RV and CV, right-aligned at `x` (drawn only if `draw`); returns their width */
function drawScores(
  ctx: CanvasRenderingContext2D,
  data: BuildCardData,
  x: number,
  y: number,
  draw = true
) {
  const parts = [
    [data.labels.rv, `${Math.round(data.rv)}%`],
    [data.labels.cv, data.cv.toFixed(1)],
  ] as const
  const label = `600 12px ${SANS}`
  const value = `700 16px ${SANS}`
  let width = 0
  const widths = parts.map(([l, v]) => {
    ctx.font = label
    const lw = ctx.measureText(l).width
    ctx.font = value
    return [lw, ctx.measureText(v).width] as const
  })
  widths.forEach(([lw, vw], i) => (width += lw + 5 + vw + (i ? 18 : 0)))
  if (!draw) return width
  let px = x - width
  parts.forEach(([l, v], i) => {
    const [lw, vw] = widths[i]
    text(ctx, l, px, y, { size: 12, weight: 600, color: FAINT })
    px += lw + 5
    text(ctx, v, px, y, { size: 16, weight: 700, color: GOLD })
    px += vw + 18
  })
  return width
}

/** Where everything goes: the right column's sections stack, and the card is as tall as they are */
function layout(data: BuildCardData, ctx: CanvasRenderingContext2D) {
  const topY = MARGIN
  const statsY = topY + 124
  const statRows = Math.ceil(data.stats.length / 2)
  const artY = statsY + 8 + statRows * STAT_ROW_H + 22
  const hasArtifacts = data.artifacts.some((a) => !!a)
  const totals = planTotals(ctx, data)
  const totalsY = artY + ART_TILE_H + 14
  const contentEnd = hasArtifacts ? totalsY + totals.height : artY + ART_TILE_H
  return {
    topY,
    statsY,
    statRows,
    artY,
    hasArtifacts,
    totalsY,
    totals,
    contentEnd,
    height: contentEnd + MARGIN + 4,
  }
}

/**
 * Draws the build card for `data` on a new canvas, `scale` times its size (for a sharp PNG).
 * Images are the app's own (same origin), so the canvas stays exportable.
 */
export async function renderBuildCard(
  data: BuildCardData,
  scale = 2,
  {
    credit = true,
  }: {
    /** the site's name in the corner (off when the card is part of a bigger picture) */
    credit?: boolean
  } = {}
): Promise<HTMLCanvasElement> {
  // the icons are rendered with React (flushSync): not while React commits the caller's effect
  await new Promise((resolve) => setTimeout(resolve, 0))

  // every image first (in parallel)
  const statKeys = new Set<string>([
    ...data.stats.map((s) => s.key),
    ...data.artifactTotals.map((s) => s.key),
    ...data.artifacts.flatMap((a) =>
      a ? [a.main.key, ...a.subs.map((s) => s.key)] : []
    ),
    ...[data.weapon?.main?.key, data.weapon?.sub?.key].filter(
      (k): k is string => !!k
    ),
  ])
  const [splash, backdrop, weaponIcon, elementIcon, ...rest] =
    await Promise.all([
      loadImage(data.splash ?? ''),
      loadImage(data.backdrop),
      loadImage(data.weapon?.icon ?? ''),
      loadImage(elementIconUrl(data.element, data.elementColor)),
      ...data.talents.map((t) => loadImage(t.icon)),
      ...data.constellationIcons.map((src) => loadImage(src)),
      ...data.artifacts.map((a) => loadImage(a?.icon ?? '')),
      ...data.sets.map((s) => loadImage(s.icon)),
    ])
  const talentIcons = rest.slice(0, 3)
  const constIcons = rest.slice(3, 9)
  const artIcons = rest.slice(9, 14)
  const setIcons = rest.slice(14)
  // the card art only when there is no splash art
  const cardArt = splash ? undefined : await loadImage(data.art)
  const icons = new Map<string, CanvasImageSource | undefined>()
  await Promise.all(
    [...statKeys].flatMap((key) =>
      (
        [
          ['', TEXT],
          ['|gold', GOLD],
          ['|muted', MUTED],
        ] as const
      ).map(async ([suffix, color]) => {
        const icon = await loadImage(statIconUrl(key, color))
        icons.set(
          `${key}${suffix}`,
          icon && PERCENT_KEYS.has(key) ? percentIcon(icon, color) : icon
        )
      })
    )
  )
  // the system fonts must be ready, or the first draw (and measuring) falls back to another one
  await document.fonts?.ready
  const measure = offscreen(1, 1).getContext('2d')
  if (!measure) throw new Error('Canvas is not supported')
  const L = layout(data, measure)
  const W = CARD_WIDTH
  const H = L.height
  const canvas = offscreen(W * scale, H * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported')
  const artLayer = splash
    ? splashLayer(splash, H, scale)
    : cardArt && moonlitArt(cardArt, data.artCrop, H, scale)

  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // ── the night: the namecard, blurred (drawn small, then stretched), darkened, the element's glow
  ctx.fillStyle = NIGHT
  ctx.fillRect(0, 0, W, H)
  if (backdrop) {
    const tiny = offscreen(48, 24)
    const t = tiny.getContext('2d')
    if (t) {
      t.drawImage(backdrop, 0, 0, tiny.width, tiny.height)
      ctx.save()
      ctx.globalAlpha = 0.9
      ctx.drawImage(tiny, -40, -40, W + 80, H + 80)
      ctx.restore()
    }
  }
  ctx.fillStyle = 'rgba(14, 16, 32, 0.78)'
  ctx.fillRect(0, 0, W, H)
  // the art's own colors, blurred to a wash and spread over the build's side
  const washSource = splash ?? cardArt
  if (washSource) {
    ctx.save()
    ctx.globalAlpha = splash ? 0.6 : 0.3
    // (its edges off the card: no seams)
    ctx.drawImage(
      artWash(washSource),
      -ART_W * 0.4,
      -H * 0.25,
      W * 1.4,
      H * 1.5
    )
    ctx.restore()
  }
  const glow = ctx.createRadialGradient(290, H * 0.42, 20, 290, H * 0.42, 640)
  glow.addColorStop(0, `${data.elementColor}4d`)
  glow.addColorStop(1, `${data.elementColor}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  // a few faint stars
  const rand = seeded(data.characterKey)
  for (let i = 0; i < 80; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = 0.4 + rand() * 1.1
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(236, 229, 216, ${0.08 + rand() * 0.3})`
    ctx.fill()
  }
  // the right side a little darker, for the text
  const shade = ctx.createLinearGradient(RIGHT_X - 160, 0, W, 0)
  shade.addColorStop(0, 'rgba(14, 16, 32, 0)')
  shade.addColorStop(0.35, 'rgba(14, 16, 32, 0.3)')
  shade.addColorStop(1, 'rgba(14, 16, 32, 0.45)')
  ctx.fillStyle = shade
  ctx.fillRect(RIGHT_X - 160, 0, W - RIGHT_X + 160, H)
  milkyWay(ctx, W, H, rand, data.elementColor)

  // ── the character
  if (artLayer)
    ctx.drawImage(
      artLayer,
      0,
      0,
      artLayer.width / scale,
      artLayer.height / scale
    )
  // the bottom left darker, for the name: an oval of shade under it, fading out in every
  // direction (a full-width band would also darken the build's corner)
  ctx.save()
  ctx.translate(ART_W * 0.42, H)
  ctx.scale(1.45, 1)
  const foot = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.5)
  foot.addColorStop(0, 'rgba(14, 16, 32, 0.92)')
  foot.addColorStop(0.55, 'rgba(14, 16, 32, 0.72)')
  foot.addColorStop(1, 'rgba(14, 16, 32, 0)')
  ctx.fillStyle = foot
  ctx.fillRect(-W, -H, W * 2, H)
  ctx.restore()

  // the bottom right, which the art leaves empty: a pool of its most vivid color
  const tone = washSource && artTone(washSource)
  const poolColor = tone ?? hexRgb(data.elementColor)
  const pool = ctx.createRadialGradient(
    W * 0.9,
    H * 1.02,
    0,
    W * 0.9,
    H * 1.02,
    720
  )
  pool.addColorStop(0, `rgba(${poolColor}, 0.26)`)
  pool.addColorStop(0.5, `rgba(${poolColor}, 0.1)`)
  pool.addColorStop(1, `rgba(${poolColor}, 0)`)
  ctx.fillStyle = pool
  ctx.fillRect(0, 0, W, H)

  // ── the constellation: a column of medallions at the art's edge, threaded together; the
  // unlocked ones ringed in the element's color, the locked ones dim
  const medX = 572
  const medR = 25
  const medStep = 72
  const medY0 = MARGIN + 42
  ctx.lineWidth = 1.2
  for (let i = 0; i < 5; i++) {
    const lit = i + 1 < data.constellation
    ctx.beginPath()
    ctx.moveTo(medX, medY0 + i * medStep + medR + 10)
    ctx.lineTo(medX, medY0 + (i + 1) * medStep - medR - 10)
    ctx.strokeStyle = lit
      ? `${data.elementColor}99`
      : 'rgba(236, 229, 216, 0.14)'
    ctx.stroke()
  }
  data.constellationIcons.forEach((_, i) => {
    const cy = medY0 + i * medStep
    const lit = i < data.constellation
    const accent = lit ? data.elementColor : 'rgba(236, 229, 216, 0.22)'
    ctx.save()
    // the disc, with a soft light when unlocked
    if (lit) {
      ctx.shadowColor = data.elementColor
      ctx.shadowBlur = 12
    }
    ctx.beginPath()
    ctx.arc(medX, cy, medR, 0, Math.PI * 2)
    ctx.fillStyle = lit ? 'rgba(14, 16, 32, 0.9)' : 'rgba(14, 16, 32, 0.6)'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = lit ? 1.6 : 1.2
    ctx.strokeStyle = accent
    ctx.stroke()
    // a thin outer ring and four points: the frame
    ctx.beginPath()
    ctx.arc(medX, cy, medR + 5, 0, Math.PI * 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = lit
      ? `${data.elementColor}55`
      : 'rgba(236, 229, 216, 0.08)'
    ctx.stroke()
    ctx.fillStyle = accent
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ])
      diamond(ctx, medX + dx * (medR + 5), cy + dy * (medR + 5), 4.5)
    const icon = constIcons[i]
    if (icon) {
      ctx.globalAlpha = lit ? 1 : 0.28
      ctx.drawImage(icon, medX - 15, cy - 15, 30, 30)
    }
    ctx.restore()
  })

  // ── who: talents, the name, element, level and constellation.
  // The last line sits on the bottom margin, level with the totals' bottom edge.
  const left = 52
  const lastY = L.contentEnd
  const metaY = lastY
  const nameY = metaY - 44
  data.talents.forEach((talent, i) => {
    const cx = left + 26 + i * 76
    const cy = nameY - 122
    ctx.beginPath()
    ctx.arc(cx, cy, 26, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(14, 16, 32, 0.75)'
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = talent.boosted ? GOLD : 'rgba(236, 229, 216, 0.16)'
    ctx.stroke()
    const icon = talentIcons[i]
    if (icon) ctx.drawImage(icon, cx - 17, cy - 17, 34, 34)
    text(ctx, String(talent.level), cx, cy + 50, {
      size: 17,
      weight: 700,
      color: talent.boosted ? GOLD : TEXT,
      align: 'center',
    })
  })
  text(ctx, data.name, left - 2, nameY, {
    size: 72,
    minSize: 44,
    weight: 600,
    family: SERIF,
    maxWidth: ART_W - left - 40,
  })
  // element, level, constellation: spaced, no separators
  let mx = left
  if (elementIcon) ctx.drawImage(elementIcon, mx, metaY - 20, 24, 24)
  mx += 32
  mx +=
    text(ctx, data.elementName, mx, metaY, {
      size: 19,
      weight: 600,
      color: data.elementColor,
    }) + 28
  mx +=
    text(ctx, `${data.labels.level} ${data.level}`, mx, metaY, {
      size: 19,
      weight: 500,
      color: MUTED,
    }) + 28
  text(ctx, `C${data.constellation}`, mx, metaY, {
    size: 19,
    weight: 700,
    color: GOLD,
  })

  // ── the weapon, and the set bonuses beside it
  const topY = L.topY
  const setsX = RIGHT_X + 560
  if (data.weapon) {
    const w = data.weapon
    rarityGlow(ctx, RIGHT_X + 48, topY + 48, 56, RARITY[w.rarity] ?? RARITY[1])
    if (weaponIcon) ctx.drawImage(weaponIcon, RIGHT_X, topY, 96, 96)
    // its rarity: stars over the icon's foot, as in the game
    const starStep = 15
    const starsX = RIGHT_X + 48 - ((w.rarity - 1) * starStep) / 2
    ctx.save()
    ctx.lineJoin = 'round'
    for (let i = 0; i < w.rarity; i++) {
      star(ctx, starsX + i * starStep, topY + 96, 8)
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'rgba(14, 16, 32, 0.85)'
      ctx.stroke()
      ctx.fillStyle = '#f2c84b'
      ctx.fill()
    }
    ctx.restore()
    const tx = RIGHT_X + 120
    text(ctx, w.name, tx, topY + 32, {
      size: 30,
      minSize: 20,
      weight: 600,
      family: SERIF,
      maxWidth: setsX - tx - 48,
    })
    let lx = tx
    lx +=
      text(ctx, `${data.labels.level} ${w.level}`, lx, topY + 60, {
        size: 16,
        color: MUTED,
      }) + 20
    if (w.refinement)
      text(ctx, `R${w.refinement}`, lx, topY + 60, {
        size: 16,
        weight: 700,
        color: GOLD,
      })
    let sx = tx
    for (const s of [w.main, w.sub]) {
      if (!s) continue
      const icon = icons.get(`${s.key}|muted`)
      if (icon) ctx.drawImage(icon, sx, topY + 75, 18, 18)
      sx +=
        text(ctx, s.value, sx + 24, topY + 91, { size: 19, weight: 700 }) + 48
    }
  } else
    text(ctx, data.labels.emptySlot, RIGHT_X, topY + 56, {
      size: 18,
      color: MUTED,
    })
  if (data.sets.length) {
    ctx.fillStyle = HAIRLINE
    ctx.fillRect(setsX - 28, topY + 6, 1, 88)
  }
  if (data.sets.length === 1) {
    // one set (4-piece): as large as the weapon beside it
    const [set] = data.sets
    const icon = setIcons[0]
    if (icon) ctx.drawImage(icon, setsX, topY + 12, 72, 72)
    text(ctx, set.pieces, setsX + 88, topY + 40, {
      size: 14,
      weight: 600,
      color: GOLD,
    })
    text(ctx, set.name, setsX + 88, topY + 70, {
      size: 24,
      minSize: 16,
      weight: 600,
      family: SERIF,
      maxWidth: RIGHT_END - setsX - 88,
    })
  } else
    data.sets.forEach((set, i) => {
      const y = topY + 2 + i * 50
      const icon = setIcons[i]
      if (icon) ctx.drawImage(icon, setsX, y, 44, 44)
      text(ctx, set.pieces, setsX + 56, y + 16, {
        size: 13,
        weight: 600,
        color: GOLD,
      })
      text(ctx, set.name, setsX + 56, y + 38, {
        size: 18,
        weight: 600,
        maxWidth: RIGHT_END - setsX - 56,
        minSize: 13,
      })
    })

  // ── final stats, two columns over hairlines
  const statsY = L.statsY
  ctx.fillStyle = HAIRLINE
  ctx.fillRect(RIGHT_X, statsY, RIGHT_W, 1)
  const colGap = 48
  const colW = (RIGHT_W - colGap) / 2
  data.stats.forEach((s, i) => {
    const col = Math.floor(i / L.statRows)
    const row = i % L.statRows
    const x = RIGHT_X + col * (colW + colGap)
    const y = statsY + 8 + row * STAT_ROW_H
    const icon = icons.get(`${s.key}|muted`)
    if (icon) ctx.drawImage(icon, x, y + 10, 18, 18)
    text(ctx, s.label, x + 28, y + 25, {
      size: 16,
      color: MUTED,
      maxWidth: colW - 150,
      minSize: 12,
    })
    text(ctx, s.value, x + colW, y + 26, {
      size: 20,
      weight: 700,
      align: 'right',
    })
    ctx.fillStyle = 'rgba(236, 229, 216, 0.05)'
    ctx.fillRect(x, y + STAT_ROW_H - 1, colW, 1)
  })

  // ── the artifacts: five columns
  const rvCounts = (key: string) =>
    (data.rvKeys as readonly string[]).includes(key)
  const artY = L.artY
  const gap = 14
  const tileW = (RIGHT_W - 4 * gap) / 5
  data.artifacts.forEach((a, i) => {
    const x = RIGHT_X + i * (tileW + gap)
    roundRect(ctx, x, artY, tileW, ART_TILE_H, 16)
    ctx.fillStyle = TILE
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = HAIRLINE
    ctx.stroke()
    if (!a) {
      text(ctx, data.labels.emptySlot, x + tileW / 2, artY + ART_TILE_H / 2, {
        size: 17,
        color: FAINT,
        align: 'center',
      })
      return
    }
    const cx = x + tileW / 2
    rarityGlow(ctx, cx, artY + 62, 50, RARITY[a.rarity] ?? RARITY[1])
    const icon = artIcons[i]
    if (icon) ctx.drawImage(icon, cx - 44, artY + 18, 88, 88)
    // level, top right
    roundRect(ctx, x + tileW - 52, artY + 12, 40, 22, 11)
    ctx.fillStyle = 'rgba(14, 16, 32, 0.75)'
    ctx.fill()
    text(ctx, `+${a.level}`, x + tileW - 32, artY + 28, {
      size: 13,
      weight: 700,
      align: 'center',
    })
    // main stat, centered
    const mainIcon = icons.get(`${a.main.key}|gold`)
    ctx.font = `700 30px ${SANS}`
    const mainW = ctx.measureText(a.main.value).width + 30
    if (mainIcon) ctx.drawImage(mainIcon, cx - mainW / 2, artY + 125, 23, 23)
    text(ctx, a.main.value, cx - mainW / 2 + 30, artY + 146, {
      size: 30,
      weight: 700,
      color: GOLD,
    })
    text(ctx, a.main.label, cx, artY + 170, {
      size: 14,
      color: MUTED,
      align: 'center',
      maxWidth: tileW - 20,
      minSize: 12,
    })
    ctx.fillStyle = HAIRLINE
    ctx.fillRect(x + 16, artY + 186, tileW - 32, 1)
    // substats, colored by how many times they rolled; those that don't count toward RV dimmed
    a.subs.slice(0, 4).forEach((s, j) => {
      const sy = artY + 218 + j * 32
      const color = s.rolls ? data.rollColors[Math.min(s.rolls, 6) - 1] : TEXT
      ctx.save()
      if (!rvCounts(s.key)) ctx.globalAlpha = 0.38
      const subIcon = icons.get(`${s.key}|muted`)
      if (subIcon) ctx.drawImage(subIcon, x + 18, sy - 16, 18, 18)
      text(ctx, s.value, x + 46, sy, { size: 20, weight: 600, color })
      ctx.restore()
    })
    // its Roll Value and Crit Value: small, at the foot
    const my = artY + ART_TILE_H - 16
    const rvW = text(ctx, data.labels.rv, x + 18, my, {
      size: 12,
      weight: 600,
      color: FAINT,
    })
    text(ctx, `${Math.round(a.rv)}%`, x + 18 + rvW + 5, my, {
      size: 13,
      weight: 600,
      color: MUTED,
    })
    const cvW = text(ctx, a.cv.toFixed(1), x + tileW - 16, my, {
      size: 13,
      weight: 600,
      color: MUTED,
      align: 'right',
    })
    text(ctx, data.labels.cv, x + tileW - 16 - cvW - 5, my, {
      size: 12,
      weight: 600,
      color: FAINT,
      align: 'right',
    })
  })

  // ── what the artifacts add up to, on a slim card under them: each stat's icon and total, then
  // the build's RV and CV
  if (L.hasArtifacts) {
    const y0 = L.totalsY
    const { rows, scoresW, height } = L.totals
    roundRect(ctx, RIGHT_X, y0, RIGHT_W, height, 14)
    ctx.fillStyle = TILE
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = HAIRLINE
    ctx.stroke()
    rows.forEach((row, r) => {
      const baseline = y0 + 10 + r * TOTALS_ROW_H + 24
      for (const { total, x } of row) {
        const icon = icons.get(`${total.key}|muted`)
        if (icon)
          ctx.drawImage(
            icon,
            x,
            baseline - TOTALS_ICON + 1,
            TOTALS_ICON,
            TOTALS_ICON
          )
        text(ctx, total.value, x + TOTALS_ICON + 7, baseline, {
          size: TOTALS_SIZE,
          weight: 700,
        })
      }
    })
    const end = RIGHT_END - TOTALS_PAD
    ctx.fillStyle = HAIRLINE
    ctx.fillRect(end - scoresW - 22, y0 + 12, 1, height - 24)
    drawScores(ctx, data, end, y0 + height / 2 + 6)
  }

  // ── made with: small and faint, just under the totals
  if (credit)
    text(ctx, data.labels.siteName, RIGHT_END, H - 22, {
      size: 12,
      weight: 500,
      color: 'rgba(236, 229, 216, 0.24)',
      align: 'right',
    })
  return canvas
}
