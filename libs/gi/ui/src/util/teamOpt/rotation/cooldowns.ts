/** Sequential charge recovery, matching kqmsim's character cooldown queue. */
export class Cooldowns {
  private queues = new Map<string, { end: number; duration: number }[]>()

  constructor(private capacity: (key: string) => number = () => 1) {}

  private queue(key: string, now: number) {
    const queue = (this.queues.get(key) ?? []).filter((c) => c.end > now)
    this.queues.set(key, queue)
    return queue
  }

  readyAt(key: string, now: number) {
    const queue = this.queue(key, now)
    return queue.length < this.capacity(key) ? now : queue[0].end
  }

  spend(key: string, now: number, duration: number, delay = 0) {
    const queue = this.queue(key, now)
    queue.push({
      end: Math.max(now + delay, queue.at(-1)?.end ?? now) + duration,
      duration,
    })
  }

  set(key: string, now: number, duration: number) {
    this.queues.set(
      key,
      duration > 0 ? [{ end: now + duration, duration }] : []
    )
  }

  /** Restart the active recharge, preserve waiting durations, then consume ready charges. */
  restart(key: string, now: number, duration: number) {
    const queue = this.queue(key, now)
    if (queue.length) {
      queue.shift()
      queue.push({ end: now, duration })
    }
    while (queue.length < this.capacity(key)) queue.push({ end: now, duration })
    let end = now
    for (const charge of queue) {
      end += charge.duration
      charge.end = end
    }
  }

  reduce(key: string, now: number, frames: number) {
    const queue = this.queue(key, now)
    const shift = Math.min(frames, (queue[0]?.end ?? now) - now)
    for (const charge of queue) charge.end -= shift
  }

  reset(key: string, now: number, count = 1) {
    const queue = this.queue(key, now)
    queue.splice(0, count)
    let end = now
    for (const charge of queue) {
      end += charge.duration
      charge.end = end
    }
  }
}
