import type { CharacterKey } from '@genshin-optimizer/gi/consts'

/** HP bookkeeping is separate from damage: drains stop at their kit threshold,
 * healing is capped, and only effective HP changes contribute to Fanfare. */
export class Health {
  private current = new Map<CharacterKey, number>()
  constructor(private readonly maximum: (key: CharacterKey) => number) {}

  private max(key: CharacterKey) {
    const max = this.maximum(key)
    if (!Number.isFinite(max) || max <= 0)
      throw new Error(
        `${key}: health tracking requires a positive, finite Max HP`
      )
    if (!this.current.has(key)) this.current.set(key, max)
    // Increasing Max HP does not heal. Decreasing it cannot leave HP above the cap.
    this.current.set(key, Math.min(this.current.get(key)!, max))
    return max
  }
  ratio(key: CharacterKey) {
    const max = this.max(key)
    return this.current.get(key)! / max
  }
  drain(key: CharacterKey, fraction: number, threshold = 0) {
    const max = this.max(key)
    const before = this.current.get(key)!
    const amount =
      before / max > threshold
        ? Math.min(before, Math.max(0, fraction) * max)
        : 0
    this.current.set(key, before - amount)
    return { amount, ratio: amount / max, overheal: 0 }
  }
  heal(key: CharacterKey, requested: number) {
    const max = this.max(key)
    const before = this.current.get(key)!
    const amount = Math.min(max - before, Math.max(0, requested))
    this.current.set(key, before + amount)
    return {
      amount,
      ratio: amount / max,
      overheal: Math.max(0, requested - amount),
    }
  }
}
