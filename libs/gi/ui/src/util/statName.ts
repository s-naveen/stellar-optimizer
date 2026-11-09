import { i18n } from '@genshin-optimizer/gi/i18n'
import { KeyMap } from '@genshin-optimizer/gi/keymap'

/**
 * A stat's name in the current language, for display: the `keymap` namespace (official game
 * terms, e.g. "Elemental Mastery" is 元素精通 in Chinese), else KeyMap's English name (also for
 * keys no translation has yet). KeyMap itself stays English: some code relies on its strings.
 */
export function statName(key: string): string {
  const english = KeyMap.get(key)
  if (!i18n.isInitialized) return english
  return i18n.t(key, { ns: 'keymap', defaultValue: english })
}
