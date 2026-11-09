import { useState } from 'react'

/**
 * False until `open` is first true, then true for good. A modal that renders its content only once
 * opened (and keeps it, so it can animate closed) costs nothing in the page it sits in until used.
 */
export function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened || open
}
