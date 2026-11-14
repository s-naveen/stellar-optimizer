import { statName } from '@genshin-optimizer/gi/ui'

const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
})
const compactPrecise = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 3,
})

/** Damage per rotation, short: 12.4K, 3.45M */
export function formatDamage(value: number | undefined, precise = false) {
  if (value === undefined || !Number.isFinite(value)) return '–'
  return (precise ? compactPrecise : compact).format(value)
}

/** Damage per rotation, or per second (DPS) when the rotation's length is known */
/** A rotation's length when the team has none set (seconds) */
export const defaultRotationTime = 20

export function formatRate(
  value: number | undefined,
  rotationTime: number | undefined,
  precise = false
) {
  return formatDamage(
    value !== undefined && rotationTime ? value / rotationTime : value,
    precise
  )
}

/** A relative change: +9.6%, −0.4% */
export function formatGain(ratio: number) {
  if (!Number.isFinite(ratio)) return '–'
  const pct = ratio * 100
  const digits = Math.abs(pct) < 10 ? 1 : 0
  const text = Math.abs(pct).toFixed(digits)
  if (text === (0).toFixed(digits)) return '±0%'
  return `${pct > 0 ? '+' : '−'}${text}%`
}

/** Hits per rotation: integers as they are, averages with up to two decimals */
export function formatHits(hits: number) {
  return Number.isInteger(hits) ? `${hits}` : `${Math.round(hits * 100) / 100}`
}

/** A main stat's short name; HP%, ATK% and DEF% keep their % (their names alone read as flat) */
export function mainStatLabel(key: string) {
  const name = statName(key)
  return ['hp_', 'atk_', 'def_'].includes(key) && !name.includes('%')
    ? `${name}%`
    : name
}
