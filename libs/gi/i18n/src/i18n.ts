import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Backend from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'

// Probably a way to auto-populate this.
export const languageCodeList = [
  'chs',
  'cht',
  'de',
  'en',
  'es',
  'fr',
  'id',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'th',
  'tr',
  'vi',
]

/** Content hash of the locale files, set by the frontend build (apps/frontend/vite.config.mts). */
declare const __GO_LOCALES_VERSION__: string | undefined
// `typeof` keeps this safe where no build defines it (tests, other apps)
const localesVersion =
  typeof __GO_LOCALES_VERSION__ === 'string' ? __GO_LOCALES_VERSION__ : ''

/**
 * @see: https://www.i18next.com/translation-function/essentials
 * @see: https://react.i18next.com/latest/using-with-hooks
 */
i18n
  // load translation using http ->
  // see /public/locales (i.e. https://github.com/i18next/react-i18next/tree/master/example/react/public/locales)
  // learn more: https://github.com/i18next/i18next-http-backend
  .use(Backend)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // detect user language
  // learn more: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  // Configure localization.
  .init({
    // debug: process.env.NODE_ENV === "development",
    // Use English strings by default, if the current language does not include
    // the specified string.
    fallbackLng: 'en',
    // fallbackLng: 'dev', // Switch to this to force the fallback value on missing strings.

    // Namespaces loaded (in parallel) before the first render. Besides 'ui', these are needed by
    // the app shell (the error boundary) or by nearly every page; loading them here avoids an
    // extra network round trip per namespace later. Keep this list small.
    ns: ['languages', 'ui', 'page_error', 'charNames_gen'],
    // Specify the default namespace.
    defaultNS: 'ui',

    // Only use the language code, skipping the region code.
    // For example, en-US becomes simply en.
    load: 'languageOnly',

    returnNull: false,

    backend: {
      // Path to load localization data from.
      loadPath: './assets/locales/{{lng}}/{{ns}}.json',
      // The locale files have no hash in their names and the service worker serves them
      // stale-while-revalidate: a new version in the URL makes the first visit after a deploy that
      // changed any text fetch it fresh.
      queryStringParams: localesVersion ? { v: localesVersion } : {},
    },
    interpolation: {
      escapeValue: false, //react does interlopation already
      skipOnVariables: false, // Enables passing nested interpolation
    },
  })
i18n.services.formatter?.add('percent', (value, _lng, options) => {
  return (value * 100).toFixed(options.fixed)
})
i18n.services.formatter?.add('fixed', (value, _lng, options) => {
  return value.toFixed(options.fixed)
})
console.log('i18n initialized')

/**
 * Start loading translation namespaces in parallel, without suspending.
 *
 * Components suspend on their namespace one at a time (a list of artifact cards fetches one
 * artifact set's namespace per round trip), so calling this with everything a page will need,
 * before it renders, saves several network round trips. Safe to call during render: already
 * loaded or in-flight namespaces are not requested again.
 */
export function preloadNamespaces(namespaces: Iterable<string>) {
  const load = () => {
    const missing = [...new Set(namespaces)].filter(
      (ns) => !i18n.hasLoadedNamespace(ns)
    )
    if (missing.length) i18n.loadNamespaces(missing)
  }
  // Before init finishes, extra namespaces would delay initialization (and the first render).
  if (i18n.isInitialized) return load()
  const onInit = () => {
    i18n.off('initialized', onInit)
    load()
  }
  i18n.on('initialized', onInit)
}

export { i18n }
