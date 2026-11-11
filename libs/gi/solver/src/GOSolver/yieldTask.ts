/*
 * Yielding to the browser without timers: in a background tab (or a minimised / covered window)
 * browsers clamp `setTimeout` to 1 s or more (Chrome's intensive throttling: once a minute) and
 * stop `requestAnimationFrame`, which stalled the optimizers' page-thread steps. A MessageChannel
 * message is a new task too, but it is not throttled.
 */

/** Resolves on a new task of the page's event loop (not throttled in background tabs) */
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0)
      return
    }
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => {
      port1.close()
      resolve()
    }
    port2.postMessage(null)
  })
}

/**
 * Resolves once the browser has had a chance to paint. In a hidden page (nothing is painted) it
 * resolves on the next task; if the page is hidden while waiting, it stops waiting for the paint.
 */
export function nextPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden) return yieldTask()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHidden)
      resolve()
    }
    const onHidden = () => {
      if (document.hidden) void yieldTask().then(finish)
    }
    // (a fallback, should no frame come)
    const timer = setTimeout(finish, 100)
    document.addEventListener('visibilitychange', onHidden)
    requestAnimationFrame(() => void yieldTask().then(finish))
  })
}
