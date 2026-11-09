import type { ReactNode } from 'react'
import { createContext } from 'react'

export type SrcDstDisplayContextObj = {
  srcDisplay: Record<string, ReactNode>
  dstDisplay: Record<string, ReactNode>
  /**
   * When true (default), empty targeted conditionals can pick src.
   * When false, src is taken from TagContext.
   */
  showSrcPicker?: boolean
  /**
   * When true (default), empty targeted conditionals can pick dst.
   * When false, hide the dst dropdown.
   */
  showDstPicker?: boolean
}
export const SrcDstDisplayContext = createContext<SrcDstDisplayContextObj>({
  srcDisplay: {},
  dstDisplay: {},
  showSrcPicker: true,
  showDstPicker: true,
})
