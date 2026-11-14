/** Set by the frontend build; defaults to off outside that build. */
declare const __GO_KQM_THEORYCRAFTING__: boolean

export const kqmTheorycraftingEnabled =
  typeof __GO_KQM_THEORYCRAFTING__ !== 'undefined' && __GO_KQM_THEORYCRAFTING__
