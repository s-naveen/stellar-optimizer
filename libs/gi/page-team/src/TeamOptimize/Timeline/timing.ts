import type {
  TeamOptBuffTrigger,
  TeamOptTimedBuff,
} from '@genshin-optimizer/gi/db'
import { i18n } from '@genshin-optimizer/gi/i18n'
import type { IFieldDisplay } from '@genshin-optimizer/gi/sheets'
import type { ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import type { TeamBuff } from '../buffs'

/**
 * Default timings of the team's buffs for the timeline: how long one lasts and what starts it,
 * read from the game data the sheets show (a "Duration" field, a "CD" field, and the condition's
 * own name: "after a reaction", "after using a burst"...)
 */

type TextProps = { ns?: unknown; key18?: unknown; children?: ReactNode }

/** The translation key of a sheet text (`st('afterReaction')`), when it is one */
export function textKey(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined
  const props = node.props as TextProps
  if (typeof props.key18 === 'string') return props.key18
  for (const child of Children.toArray(props.children)) {
    const key = textKey(child)
    if (key) return key
  }
  return undefined
}

/** A sheet text as words, as far as they are known now (its translations, when loaded) */
export function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return `${node}`
  if (Array.isArray(node)) return node.map(plainText).join('')
  if (!isValidElement(node)) return ''
  const props = node.props as TextProps
  let text = ''
  if (typeof props.key18 === 'string') {
    const key =
      typeof props.ns === 'string' ? `${props.ns}:${props.key18}` : props.key18
    if (i18n.exists(key)) {
      const value = i18n.t(key)
      if (typeof value === 'string') text = value.replace(/<[^>]*>/g, '')
    }
  }
  return text + Children.toArray(props.children).map(plainText).join('')
}

/** A field's number, when it is a plain one (`value: 8`) */
function fieldNumber(fields: readonly IFieldDisplay[], key: string) {
  for (const field of fields)
    if ('text' in field && textKey(field.text) === key) {
      const value = field.value
      if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return value
    }
  return undefined
}

/** What a condition's translation key says starts it */
const TRIGGER_KEYS: [RegExp, TeamOptBuffTrigger][] = [
  [/reaction/i, 'reaction'],
  [/skillOrBurst/i, 'skillOrBurst'],
  [/hitOp\.burst/i, 'burstHit'],
  [/hitOp\.skill/i, 'skillHit'],
  [/afterUse\.burst|\bburst/i, 'burst'],
  [/afterUse\.skill|\bskill/i, 'skill'],
  [/hitOp\.normalOrCharged/i, 'hit'],
  [/hitOp\.normal/i, 'normal'],
  [/hitOp\.charged/i, 'charged'],
  [/hitOp\.plunging/i, 'plunging'],
  [/hitOp\.none|hitOp|afterHit/i, 'hit'],
]
/** What a condition's (English) words say starts it */
const ELE = String.raw`(?:elemental|ele\.?)\s*`
const TRIGGER_WORDS: [RegExp, TeamOptBuffTrigger][] = [
  [/reaction/i, 'reaction'],
  [new RegExp(`skill\\s*(?:or|/)\\s*(?:${ELE})?burst`, 'i'), 'skillOrBurst'],
  [
    new RegExp(
      `${ELE}burst(?:\\s*dmg)?\\s*hits|hit\\w*.*with an? ${ELE}burst`,
      'i'
    ),
    'burstHit',
  ],
  [
    new RegExp(
      `${ELE}skill(?:\\s*dmg)?\\s*hits|hit\\w*.*with an? ${ELE}skill`,
      'i'
    ),
    'skillHit',
  ],
  [
    new RegExp(
      `(?:us(?:e|ing)|cast(?:ing)?|after)\\s+(?:an?\\s+)?${ELE}burst`,
      'i'
    ),
    'burst',
  ],
  [
    new RegExp(
      `(?:us(?:e|ing)|cast(?:ing)?|after)\\s+(?:an?\\s+)?${ELE}skill`,
      'i'
    ),
    'skill',
  ],
  [/charged attack/i, 'charged'],
  [/normal attack/i, 'normal'],
  [/plunging attack/i, 'plunging'],
]

export function triggerOf(buff: TeamBuff): TeamOptBuffTrigger | undefined {
  const node = buff.label ?? buff.name
  const key = textKey(node)
  if (key)
    for (const [pattern, trigger] of TRIGGER_KEYS)
      if (pattern.test(key)) return trigger
  const words = plainText(node)
  if (words)
    for (const [pattern, trigger] of TRIGGER_WORDS)
      if (pattern.test(words)) return trigger
  // a talent's buff: the part of the kit it is in (Bennett's burst field: `burst`...)
  const path = buff.ref.path.join('.')
  if (/burst/i.test(path)) return 'burst'
  if (/skill/i.test(path)) return 'skill'
  return undefined
}

type Timing = Pick<TeamOptTimedBuff, 'trigger' | 'duration' | 'cooldown'>
/**
 * Timings known from the game for sets and weapons whose sheets do not say them in a way the
 * detection below can read (no "Duration" field, a condition named by a key of its own), or say
 * them wrongly for the timeline. Matched on the conditional's path.
 */
const KNOWN: [RegExp, Timing][] = [
  // artifact sets
  [/^ViridescentVenerer\.swirl/, { trigger: 'reaction', duration: 10 }],
  [/^NoblesseOblige\./, { trigger: 'burst', duration: 12 }],
  [/^Instructor\./, { trigger: 'reaction', duration: 8 }],
  [
    /^ShimenawasReminiscence\.usedEnergy$/,
    { trigger: 'skill', duration: 10, cooldown: 10 },
  ],
  [/^NymphsDream\.set4$/, { trigger: 'hit', duration: 8 }],
  [/^VermillionHereafter\.afterBurst$/, { trigger: 'burst', duration: 16 }],
  [
    /^NighttimeWhispersInTheEchoingWoods\.afterSkill$/,
    { trigger: 'skill', duration: 10 },
  ],
  [/^ArchaicPetra\.element$/, { trigger: 'reaction', duration: 10 }],
  [/^DeepwoodMemories\.set4$/, { trigger: 'skillOrBurst', duration: 8 }],
  [/^ADayCarvedFromRisingWinds\.set4$/, { trigger: 'hit', duration: 6 }],
  [
    /^ScrollOfTheHeroOfCinderCity\.react_/,
    { trigger: 'reaction', duration: 15 },
  ],
  [
    /^ScrollOfTheHeroOfCinderCity\.nightsoul_/,
    { trigger: 'reaction', duration: 20 },
  ],
  [/^TenacityOfTheMillelith\./, { trigger: 'skillHit', duration: 3 }],
  [/^PaleFlame\./, { trigger: 'skillHit', duration: 7 }],
  // weapons: the Millennial Movement series, from their sigils (approximated by what grants them)
  [
    /^ElegyForTheEnd\./,
    { trigger: 'skillOrBurst', duration: 12, cooldown: 20 },
  ],
  [/^FreedomSworn\./, { trigger: 'reaction', duration: 12, cooldown: 20 }],
  [/^SongOfBrokenPines\./, { trigger: 'hit', duration: 12, cooldown: 20 }],
]

/** A timing known from the game, by the conditional's path */
export function knownTiming(path: readonly string[]): Timing | undefined {
  const key = path.join('.')
  return KNOWN.find(([pattern]) => pattern.test(key))?.[1]
}

/**
 * A buff's default timing, when the game data gives how long it lasts. Its trigger, when its name
 * does not say, is left to be set by hand (`manual`).
 */
export function defaultTiming(buff: TeamBuff): TeamOptTimedBuff | undefined {
  const known = knownTiming(buff.ref.path)
  if (known)
    return { owner: buff.ref.owner, path: [...buff.ref.path], ...known }
  const fields =
    buff.fields?.[buff.value] ?? Object.values(buff.fields ?? {})[0] ?? []
  const duration = fieldNumber(fields, 'duration')
  if (!duration) return undefined
  const cooldown = fieldNumber(fields, 'cd')
  return {
    owner: buff.ref.owner,
    path: [...buff.ref.path],
    trigger: triggerOf(buff) ?? 'manual',
    duration,
    ...(cooldown ? { cooldown } : {}),
  }
}

/** The team's buffs that only last a while, with their default timings */
export function timedBuffDefaults(buffs: readonly TeamBuff[]) {
  return buffs.flatMap((buff) => {
    const timing = defaultTiming(buff)
    return timing ? [{ buff, timing }] : []
  })
}
