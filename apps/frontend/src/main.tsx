import { isDev } from '@genshin-optimizer/common/util'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import NewTab from './app/NewTab'
import './index.css'

// After a redeploy, a cached page may request chunks that no longer exist. Reload once to pick
// up the new version instead of showing the error screen (Vite's recommended handling).
window.addEventListener('vite:preloadError', (event) => {
  const key = 'go-preload-reload'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () =>
  setTimeout(() => sessionStorage.removeItem('go-preload-reload'), 10000)
)
// Cache the site in the browser so repeat visits are instant (see public/sw.js). Production only.
if ('serviceWorker' in navigator && !isDev && location.protocol === 'https:')
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
let mode: 'main' | 'newtab' = 'main'
let root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Detect a storage event, and unmount the main page to show a newTab event.
function handleStorage(this: Window, event: StorageEvent) {
  if (event.key !== 'GONewTabDetection') return
  if (mode === 'newtab') return
  mode = 'newtab'
  this.document.title = 'ERROR'
  root.unmount()
  root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <React.StrictMode>
      <NewTab />
    </React.StrictMode>
  )
}
window.addEventListener('storage', handleStorage)
