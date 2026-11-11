import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { precompute } from '@genshin-optimizer/gi/wr'
import type {
  ArtifactBuildData,
  ArtifactsBySlot,
  DynMinMax,
  MinMax,
} from '../common.js'
import { countBuilds, nodeRangeEvaluator } from '../common.js'
import type { PlotConfig, Setup } from '../type.js'
import type { ExclusionMasks } from './exclusion.js'
import { readKeys } from './SolverWorker.js'
import { yieldTask } from './yieldTask.js'

/**
 * WebGPU brute-force backend: one dense sweep of a whole search space.
 *
 * Each artifact is a short row of the stats the (preprocessed) formula reads, and a build is the
 * sum of its five rows followed by a few multiply-adds: regular work, the same for every build,
 * which is what a GPU is fast at. One compute shader is generated from the formula; each
 * invocation takes one combination of the four smaller slots and loops over the largest one.
 * Artifact-set rules (excluded sets, rainbow) are checked per build in the shader from the five
 * set indices (see `exclusion.ts`), so the GPU never needs the CPU's enumeration of the allowed
 * set combinations (millions of tiny pieces of work when sets are restricted).
 *
 * The GPU works in f32 and is only used as a filter:
 *  - pass 0: maxima (and, when plotting, per-bin maxima) give a cutoff that at least `topN`
 *    builds reach,
 *  - pass 1: every build within a small margin of that cutoff (or of its plot bin's maximum) is
 *    returned as a candidate,
 * and every candidate is re-evaluated exactly (f64, same evaluator as the CPU path) by the caller.
 * Plot bins are the GPU's own: a build is in the bin of its f32 plot value, and candidates carry
 * that bin (see `PlotStore.add`). Only builds right on a bin edge can land on the other side in
 * f64, and those land on either side on the CPU too, depending on the order of its sums (e.g. a
 * stat total of exactly 38.4 with bins 0.02 wide).
 * Dispatches are queued back to back; a run reads back three times in all, whatever its size.
 */

// WebGPU constants (lib.dom has the interfaces but not these objects)
const BUFFER = {
  MAP_READ: 0x1,
  COPY_SRC: 0x4,
  COPY_DST: 0x8,
  UNIFORM: 0x40,
  STORAGE: 0x80,
} as const
const MAP_READ = 0x1

const WORKGROUP = 64
/** Invocations per dispatch at most */
const MAX_INVOCATIONS = 1 << 22
/**
 * Builds per dispatch (each invocation loops over the largest slot): a few milliseconds of GPU
 * time, so that the browser can draw the page between dispatches. Long dispatches hold the GPU,
 * and the whole tab stutters while the optimizer runs.
 */
const DISPATCH_BUILDS = 1 << 24
/**
 * GPU time per slice of work while the page is visible (ms). A sweep otherwise keeps the GPU
 * fully busy and the browser cannot draw the page: the tab stutters for the whole run. Slices are
 * submitted one at a time, each once the previous one is done, so the page's drawing runs between
 * them; a hidden tab has nothing to draw and runs flat out.
 */
const SLICE_MS = 5
const CANDIDATE_CAP = 1 << 20
/**
 * Workgroup maxima (and counts) are folded into this many buckets on the GPU: a fixed, small
 * readback whatever the size of the search (the `topN`-th best bucket maximum is still a value
 * that `topN` distinct builds reach)
 */
const BUCKETS = 1 << 16
/**
 * Plots with at most this many bins keep each workgroup's bin maxima in workgroup memory, merged
 * into the global bins once per workgroup: with few bins, billions of global atomic updates of the
 * same few hundred addresses serialize. (Either way, a build only updates its bin when it beats
 * the bin's best so far, read first: an atomic update per build made the first pass three times
 * slower, with Elemental Mastery's 45K bins.)
 */
const LOCAL_BINS_MAX = 2048
/** Relative f32 slack for cutoffs and constraints; candidates are re-checked in f64 */
const REL = 2e-5
/**
 * Plot candidates per bin at most (builds within `REL` of their bin's best). Many builds can tie
 * for a bin's best, e.g. when the target only depends on the plotted stat; past this, the bin's
 * value is still within `REL` of its best.
 */
const plotCap = (len: number) =>
  Math.max(4, Math.min(1024, Math.floor(CANDIDATE_CAP / 4 / Math.max(1, len))))
/** A candidate's plot bin when it has none (out of range) */
const NO_BIN = 0xffffffff

/** `bin`: the build's plot bin, per the GPU (none: out of range, or no plot) */
export type GPUCandidate = {
  arts: ArtifactBuildData[]
  values: number[]
  bin?: number
}
export type GPURun =
  | { ok: true; tested: number; failed: number; candidates: GPUCandidate[] }
  | { ok: false; reason: 'too-large' | 'overflow' }

export class GPUSolver {
  private readonly device: GPUDevice
  private readonly pipeline: GPUComputePipeline
  private readonly keys: string[]
  private readonly K: number
  /** Table row of each artifact (by object: ids are not unique, '' marks empty slots) */
  private readonly rowOf: Map<ArtifactBuildData, number>
  private readonly table: GPUBuffer
  /** The table's values (f32), and where its two range rows start (see `run`) */
  private readonly tableData: Float32Array
  private readonly rangeRows: number
  private readonly params: GPUBuffer
  private readonly counters: GPUBuffer
  private readonly out: GPUBuffer
  /** u32 per candidate in `out`: its build (two), then its plot bin when plotting */
  private readonly stride: number
  /** Per plot bin: the best value (encoded, see `enc`), then the number of candidates taken */
  private readonly bins?: GPUBuffer
  private readonly plotLen: number
  /** Set rules: each table row's set index, then the allowed piece counts per set index */
  private readonly rules?: GPUBuffer
  /** Per bucket: the best value (encoded), then (set rules) the number of allowed builds */
  private readonly wg: GPUBuffer
  private readonly evaluate: ReturnType<typeof precompute<5>>
  /** The target's range for given stat ranges (to choose the free slot, see `run`) */
  private readonly targetRange: (reads: DynMinMax) => MinMax[]
  private readonly base: Record<string, number>
  private readonly topN: number
  private lost = false

  /**
   * `undefined` when WebGPU is unavailable or the formula cannot be compiled. With `rules`, only
   * the builds they allow are part of the search (see `exclusion.ts`).
   */
  static async create(
    setup: Setup,
    plot: PlotConfig | undefined,
    rules?: ExclusionMasks
  ): Promise<GPUSolver | undefined> {
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined
    if (!gpu) return undefined
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    })
    if (!adapter || adapter.info?.isFallbackAdapter) return undefined
    const nodes = [
      setup.optTarget,
      ...setup.constraints.map((c) => c.value),
      ...(setup.plotBase ? [setup.plotBase] : []),
    ]
    const setRules = setRulesFor(setup, rules)
    const rows = allArtifactSlotKeys.reduce(
      (n, slot) => n + setup.arts.values[slot].length,
      0
    )
    const src = shaderSource(
      nodes,
      setup.constraints.map((c) => c.min),
      readKeys(nodes),
      setup.arts,
      setup.plotBase ? plot : undefined,
      setRules && { rainbow: setRules.rainbow, maskOffset: rows },
      rows
    )
    if (!src) return undefined
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    })
    const module = device.createShaderModule({ code: src })
    const info = await module.getCompilationInfo()
    if (info.messages.some((m) => m.type === 'error')) {
      device.destroy()
      return undefined
    }
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })
    return new GPUSolver(device, pipeline, nodes, setup, plot, setRules)
  }

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    nodes: OptNode[],
    setup: Setup,
    plot: PlotConfig | undefined,
    setRules: SetRules | undefined
  ) {
    this.device = device
    this.pipeline = pipeline
    this.topN = setup.topN
    this.keys = readKeys(nodes)
    this.K = this.keys.length
    device.lost.then(() => (this.lost = true))

    const arts = allArtifactSlotKeys.flatMap((slot) => setup.arts.values[slot])
    this.rowOf = new Map(arts.map((art, i) => [art, i]))
    // (two more rows: the fifth slot's lowest and highest value of each stat, written per run)
    const table = new Float32Array(Math.max(1, (arts.length + 2) * this.K))
    arts.forEach((art, i) =>
      this.keys.forEach((k, j) => (table[i * this.K + j] = art.values[k] ?? 0))
    )
    this.tableData = table
    this.rangeRows = arts.length * this.K
    this.table = this.buffer(table.byteLength, BUFFER.STORAGE | BUFFER.COPY_DST)
    device.queue.writeBuffer(this.table, 0, table)
    this.params = this.buffer(80, BUFFER.UNIFORM | BUFFER.COPY_DST)
    this.counters = this.buffer(
      8,
      BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC
    )
    const plotting = !!(setup.plotBase && plot)
    this.stride = plotting ? 3 : 2
    this.out = this.buffer(
      CANDIDATE_CAP * this.stride * 4,
      BUFFER.STORAGE | BUFFER.COPY_SRC
    )
    this.wg = this.buffer(
      BUCKETS * 4 * (setRules ? 2 : 1),
      BUFFER.STORAGE | BUFFER.COPY_SRC | BUFFER.COPY_DST
    )
    // (few storage buffers: devices allow 8 per shader by default)
    if (setRules) {
      const data = new Uint32Array(arts.length + setRules.masks.length)
      arts.forEach((art, i) => (data[i] = setRules.index.get(art.set) ?? 0))
      data.set(setRules.masks, arts.length)
      this.rules = this.buffer(
        data.byteLength,
        BUFFER.STORAGE | BUFFER.COPY_DST
      )
      device.queue.writeBuffer(this.rules, 0, data)
    }
    this.plotLen = plotting ? plot!.len : 0
    if (plotting)
      this.bins = this.buffer(
        Math.max(8, this.plotLen * 8),
        BUFFER.STORAGE | BUFFER.COPY_DST
      )
    this.targetRange = nodeRangeEvaluator([nodes[0]])
    this.base = setup.arts.base
    this.evaluate = precompute(
      nodes,
      setup.arts.base,
      (f) => f.path[1] as string,
      5
    )
  }

  destroy() {
    this.device.destroy()
  }

  /**
   * Brute-force `arts` (a subset of the setup artifacts, same objects). Returns candidate builds,
   * already evaluated exactly; the caller applies constraints/threshold/plot bins to them.
   */
  /** `onProgress`: the fraction of the sweep done so far (both passes), now and then */
  /**
   * `collect`: the problem asks its target to beat a value (a constraint on the target itself),
   * so few builds meet the constraints: the first sweep also collects them all, and the second
   * one is only needed when there are too many
   */
  async run(
    arts: ArtifactsBySlot,
    threshold: number,
    onProgress?: (fraction: number) => void,
    collect = false
  ): Promise<GPURun> {
    if (this.lost) throw new Error('WebGPU device lost')
    // The innermost (free) slot: the one whose pieces move the target least. Each invocation
    // bounds its prefix's builds (four pieces fixed) over that slot, and a tight bound skips
    // more of them. (By size, the free slot was often the circlet, whose main stats move the
    // target most.) The order changes what is skipped, never which builds are covered.
    const slotLists = allArtifactSlotKeys.map((slot) => arts.values[slot])
    const free = this.freeSlot(slotLists)
    const lists = [
      ...slotLists
        .filter((_, i) => i !== free)
        .sort((a, b) => a.length - b.length),
      slotLists[free],
    ]
    // Candidates are re-evaluated with their pieces in one fixed order (slots by size, as the
    // sweep used to be ordered): the sums' rounding, and so every value to the last bit, does
    // not depend on which slot the sweep left free
    const scoreOrder = [...slotLists].sort((a, b) => a.length - b.length)
    const toScore = scoreOrder.map((list) => lists.indexOf(list))
    const n = lists.map((l) => l.length)
    const outer = n[0] * n[1] * n[2] * n[3]
    if (!outer || !n[4])
      return { ok: true, tested: 0, failed: 0, candidates: [] }
    if (outer >= 2 ** 31) return { ok: false, reason: 'too-large' }
    const total = countBuilds(arts)

    // Per-level artifact rows
    const offsets: number[] = []
    const rows: number[] = []
    for (const list of lists) {
      offsets.push(rows.length)
      for (const art of list) rows.push(this.rowOf.get(art)!)
    }
    // Each stat's range over the fifth (largest) slot: the shader bounds every build of a
    // prefix (four pieces fixed) with it, from the table's own f32 values
    const { K, tableData } = this
    const ranges = new Float32Array(2 * K)
    ranges.fill(Number.POSITIVE_INFINITY, 0, K)
    ranges.fill(Number.NEGATIVE_INFINITY, K)
    for (const art of lists[4]) {
      const row = this.rowOf.get(art)! * K
      for (let k = 0; k < K; k++) {
        const v = tableData[row + k]
        if (v < ranges[k]) ranges[k] = v
        if (v > ranges[K + k]) ranges[K + k] = v
      }
    }
    this.device.queue.writeBuffer(this.table, this.rangeRows * 4, ranges)
    const slotRows = this.buffer(
      rows.length * 4,
      BUFFER.STORAGE | BUFFER.COPY_DST
    )
    this.device.queue.writeBuffer(slotRows, 0, new Uint32Array(rows))

    const batches: { start: number; count: number; wx: number; wy: number }[] =
      []
    const perDispatch = Math.max(
      WORKGROUP,
      Math.min(
        MAX_INVOCATIONS,
        Math.floor(DISPATCH_BUILDS / n[4] / WORKGROUP) * WORKGROUP
      )
    )
    for (let start = 0; start < outer; start += perDispatch) {
      const count = Math.min(perDispatch, outer - start)
      const groups = Math.ceil(count / WORKGROUP)
      const wx = Math.min(groups, 65535),
        wy = Math.ceil(groups / wx)
      batches.push({ start, count, wx, wy })
    }
    const buffers: (GPUBuffer | undefined)[] = [
      this.params,
      this.table,
      slotRows,
      this.wg,
      this.counters,
      this.out,
      this.bins,
      this.rules,
    ]
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: buffers.flatMap((buffer, binding) =>
        buffer ? [{ binding, resource: { buffer } }] : []
      ),
    })
    const submit = (
      b: (typeof batches)[number],
      mode: number,
      thr: number,
      countFailed: boolean
    ) => {
      const p = new ArrayBuffer(80),
        u = new Uint32Array(p),
        f = new Float32Array(p)
      u.set([
        n[0],
        n[1],
        n[2],
        n[3],
        n[4],
        offsets[0],
        offsets[1],
        offsets[2],
        offsets[3],
        offsets[4],
      ])
      u.set([b.start, b.count, 0, mode, CANDIDATE_CAP, countFailed ? 1 : 0], 10)
      f[16] = Math.fround(thr)
      this.device.queue.writeBuffer(this.params, 0, p)
      const enc = this.device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, bind)
      pass.dispatchWorkgroups(b.wx, b.wy)
      pass.end()
      this.device.queue.submit([enc.finish()])
    }
    /** The progress a pass reports (`onProgress`): from `base`, `span` for all its dispatches */
    let doneDispatches = 0
    let progress = { base: 0, span: 0.5 }
    const dispatch = async (
      mode: number,
      thr: number,
      countFailed: boolean
    ) => {
      doneDispatches = 0
      const paced = () =>
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      // Short slices of work, at most two queued: the browser's own GPU work (drawing the page)
      // runs between slices instead of waiting behind the whole sweep, and the next slice is
      // already queued while the GPU reports the previous one done (that report can be slow)
      const queued: { count: number; done: Promise<number> }[] = []
      let i = 0,
        perSlice = 1,
        last = performance.now()
      const retire = async () => {
        const { count, done } = queued.shift()!
        const at = await done
        if (this.lost) throw new Error('WebGPU device lost')
        doneDispatches += count
        onProgress?.(
          progress.base + (progress.span * doneDispatches) / batches.length
        )
        // the time between two slices finishing is about the GPU time of one: aim at SLICE_MS
        const ms = Math.max(0.5, at - last)
        last = at
        perSlice = Math.max(
          1,
          Math.min(4096, Math.round((count * SLICE_MS) / ms))
        )
      }
      while (i < batches.length) {
        if (!paced()) {
          doneDispatches += batches.length - i
          for (; i < batches.length; i++)
            submit(batches[i], mode, thr, countFailed)
          break
        }
        const start = i
        for (const end = Math.min(batches.length, i + perSlice); i < end; i++)
          submit(batches[i], mode, thr, countFailed)
        queued.push({
          count: i - start,
          done: this.device.queue
            .onSubmittedWorkDone()
            .then(() => performance.now()),
        })
        if (queued.length >= 2) await retire()
      }
      while (queued.length) await retire()
    }

    // pass 0: cutoff that at least `topN` distinct builds reach (bucket maxima)
    const wgWords = BUCKETS * (this.rules ? 2 : 1)
    this.device.queue.writeBuffer(this.wg, 0, new Uint32Array(wgWords))
    if (this.bins)
      this.device.queue.writeBuffer(
        this.bins,
        0,
        new Uint32Array(Math.max(2, 2 * this.plotLen))
      )
    this.device.queue.writeBuffer(this.counters, 0, new Uint32Array([0, 0]))
    // (collecting while sweeping: not when plotting, whose candidates depend on each bin's best)
    const collecting = collect && !this.bins
    progress = { base: 0, span: collecting ? 1 : 0.5 }
    await dispatch(collecting ? 2 : 0, 0, true)
    const [wgRaw, cnt0] = await this.read([
      [this.wg, wgWords * 4],
      [this.counters, 8],
    ])
    const wgMax = new Uint32Array(wgRaw, 0, BUCKETS)
    const failed = new Uint32Array(cnt0)[1]
    /** The builds that met the constraints, all collected (`collecting`) */
    const collected = new Uint32Array(cnt0)[0]
    // allowed builds: counted by the shader when set rules apply (excluded ones are not part of
    // the search), all of them otherwise
    let tested = total
    if (this.rules) {
      tested = 0
      for (const c of new Uint32Array(wgRaw, BUCKETS * 4, BUCKETS)) tested += c
    }
    const best = new Array<number>(this.topN).fill(Number.NEGATIVE_INFINITY)
    for (let i = 0; i < wgMax.length; i++) {
      if (!wgMax[i]) continue // empty bucket
      const v = dec(wgMax[i])
      // (-3e38: a workgroup without any valid build)
      if (!(v > -3e38) || !(v > best[this.topN - 1])) continue
      let j = this.topN - 1
      while (j > 0 && best[j - 1] < v) {
        best[j] = best[j - 1]
        j--
      }
      best[j] = v
    }
    // No build meets the constraints, not even within the shader's f32 slack: there is nothing to
    // collect, and the second sweep is skipped. (Each step of Team Optimize asks its member to
    // beat its current build, and most of the time nothing does.)
    if (!(best[0] > Number.NEGATIVE_INFINITY)) {
      slotRows.destroy()
      onProgress?.(1)
      return { ok: true, tested, failed, candidates: [] }
    }
    let found = collected
    if (!collecting || collected > CANDIDATE_CAP) {
      let cut = Math.max(threshold, best[this.topN - 1])
      cut = Number.isFinite(cut) ? cut - Math.abs(cut) * REL : -3e38
      // pass 1: candidates
      progress = collecting ? { base: 1, span: 0 } : { base: 0.5, span: 0.5 }
      this.device.queue.writeBuffer(this.counters, 0, new Uint32Array([0, 0]))
      await dispatch(1, cut, false)
      found = new Uint32Array((await this.read([[this.counters, 8]]))[0])[0]
    }
    if (found > CANDIDATE_CAP) {
      slotRows.destroy()
      console.warn(`WebGPU sweep: ${found} candidates, over ${CANDIDATE_CAP}`)
      return { ok: false, reason: 'overflow' }
    }
    const { stride } = this
    const pairs = new Uint32Array(
      found
        ? (await this.read([[this.out, found * stride * 4]]))[0]
        : new ArrayBuffer(0)
    )
    slotRows.destroy()
    const candidates: GPUCandidate[] = []
    for (let c = 0; c < found; c++) {
      // (exact re-evaluation runs on the page's thread: in chunks, so that it keeps drawing)
      if (c % 20_000 === 19_999) await yieldTask()
      let r = pairs[stride * c]
      const i3 = r % n[3]
      r = Math.floor(r / n[3])
      const i2 = r % n[2]
      r = Math.floor(r / n[2])
      const i1 = r % n[1]
      const i0 = Math.floor(r / n[1])
      const picked = [
        lists[0][i0],
        lists[1][i1],
        lists[2][i2],
        lists[3][i3],
        lists[4][pairs[stride * c + 1]],
      ]
      const bin = stride > 2 ? pairs[stride * c + 2] : NO_BIN
      const ordered = toScore.map((i) => picked[i])
      candidates.push({
        arts: ordered,
        values: this.evaluate(ordered as typeof ordered & { length: 5 }),
        bin: bin === NO_BIN ? undefined : bin,
      })
    }
    return { ok: true, tested, failed, candidates }
  }

  /**
   * The slot that moves the target least: the target's range with that slot's pieces free and
   * every other slot at its middle (per stat). Ties: the largest slot.
   */
  private freeSlot(slotLists: ArtifactBuildData[][]): number {
    const { keys } = this
    const ranges = slotLists.map((list) => {
      const r: Record<string, MinMax> = {}
      for (const k of keys) {
        let min = Number.POSITIVE_INFINITY,
          max = Number.NEGATIVE_INFINITY
        for (const art of list) {
          const v = art.values[k] ?? 0
          if (v < min) min = v
          if (v > max) max = v
        }
        r[k] = list.length ? { min, max } : { min: 0, max: 0 }
      }
      return r
    })
    let best = -1,
      bestWidth = Number.POSITIVE_INFINITY
    slotLists.forEach((list, s) => {
      if (!list.length) return
      const reads: DynMinMax = {}
      for (const k of keys) {
        let mid = this.base[k] ?? 0
        for (let t = 0; t < ranges.length; t++)
          if (t !== s) mid += (ranges[t][k].min + ranges[t][k].max) / 2
        reads[k] = { min: mid + ranges[s][k].min, max: mid + ranges[s][k].max }
      }
      const [{ min, max }] = this.targetRange(reads)
      const width = max - min
      if (
        width < bestWidth ||
        (width === bestWidth &&
          best >= 0 &&
          list.length > slotLists[best].length) ||
        (!(width >= 0) && best < 0)
      ) {
        best = s
        bestWidth = Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
      }
    })
    if (best >= 0) return best
    // (no usable widths): the largest slot, as before
    let largest = 0
    slotLists.forEach((list, s) => {
      if (list.length > slotLists[largest].length) largest = s
    })
    return largest
  }

  private buffer(size: number, usage: number) {
    return this.device.createBuffer({
      size: Math.max(4, Math.ceil(size / 4) * 4),
      usage,
    })
  }
  /** Read several buffers (`[buffer, bytes]`) back in one round trip */
  private async read(parts: [GPUBuffer, number][]): Promise<ArrayBuffer[]> {
    const sizes = parts.map(([, size]) => Math.ceil(size / 4) * 4)
    const dst = this.buffer(
      sizes.reduce((a, b) => a + b, 0),
      BUFFER.MAP_READ | BUFFER.COPY_DST
    )
    const enc = this.device.createCommandEncoder()
    let offset = 0
    parts.forEach(([src], i) => {
      if (sizes[i]) enc.copyBufferToBuffer(src, 0, dst, offset, sizes[i])
      offset += sizes[i]
    })
    this.device.queue.submit([enc.finish()])
    await dst.mapAsync(MAP_READ)
    const all = dst.getMappedRange()
    offset = 0
    const out = parts.map(([, size], i) => {
      const data = all.slice(offset, offset + size)
      offset += sizes[i]
      return data
    })
    dst.unmap()
    dst.destroy()
    return out
  }
}

/** Set index per set (`undefined`: empty slot) and the shader's mask tables, for set rules */
type SetRules = {
  index: Map<string | undefined, number>
  /** allowed piece counts per set index (bit `n`: `n` pieces) */
  masks: Uint32Array
  rainbow: number
}
function setRulesFor(
  setup: Setup,
  rules: ExclusionMasks | undefined
): SetRules | undefined {
  if (!rules) return undefined
  const ALL = 0x3f // 0..5 pieces
  const ruled = Object.values(rules.sets).some((m) => m !== ALL)
  if (!ruled && (rules.rainbow & ALL) === ALL) return undefined // nothing to check
  const index = new Map<string | undefined, number>()
  for (const slot of allArtifactSlotKeys)
    for (const art of setup.arts.values[slot])
      if (!index.has(art.set)) index.set(art.set, index.size)
  const masks = new Uint32Array(Math.max(1, index.size)).fill(ALL)
  for (const [set, i] of index)
    if (set !== undefined)
      masks[i] = rules.sets[set as keyof typeof rules.sets] ?? ALL
  return { index, masks, rainbow: rules.rainbow }
}

/** Inverse of the shader's `enc` (order-preserving f32 <-> u32) */
const f32 = new Float32Array(1),
  u32 = new Uint32Array(f32.buffer)
function dec(u: number): number {
  u32[0] = u & 0x80000000 ? u & 0x7fffffff : ~u
  return f32[0]
}

/** WGSL literal; `undefined` for NaN (not representable) */
function wlit(v: number): string | undefined {
  if (Number.isNaN(v)) return undefined
  if (!Number.isFinite(v)) return v > 0 ? '3.0e38' : '(-3.0e38)'
  const c = Math.max(-3e38, Math.min(3e38, v))
  let s = String(Math.fround(c) === 0 ? 0 : c)
  if (!/[.eE]/.test(s)) s += '.0'
  return s.startsWith('-') ? `(${s})` : s
}

function shaderSource(
  nodes: OptNode[],
  mins: number[],
  keys: string[],
  arts: ArtifactsBySlot,
  plot: PlotConfig | undefined,
  /**
   * Set rules: the allowed rainbow piece counts (bit mask), and where the masks start in the
   * rules buffer (after one set index per table row)
   */
  setRules: { rainbow: number; maskOffset: number } | undefined,
  /** Table rows (artifacts): two more rows follow, the fifth slot's stat ranges (see `run`) */
  tableRows: number
): string | undefined {
  const rainbow = setRules?.rainbow
  const K = keys.length
  const col = new Map(keys.map((k, i) => [k, i]))
  const nCons = mins.length
  const names = new Map<OptNode, string>()
  let ok = true,
    i = 0,
    lines: string[] = []
  const visit = (n: OptNode): string => {
    const got = names.get(n)
    if (got !== undefined) return got
    const ops = (n.operands as OptNode[]).map(visit)
    let e: string
    switch (n.operation) {
      case 'const': {
        const l = wlit(n.value)
        if (l === undefined) ok = false
        names.set(n, l ?? '0.0')
        return names.get(n)!
      }
      case 'read':
        names.set(n, `r${col.get(n.path[1] as string)}`)
        return names.get(n)!
      case 'add':
        e = ops.join('+')
        break
      case 'mul':
        e = ops.join('*')
        break
      case 'min':
      case 'max':
        e = ops.reduce((a, b) => `${n.operation}(${a},${b})`)
        break
      case 'res':
        e = `resf(${ops[0]})`
        break
      case 'sum_frac':
        e = `${ops[0]}/(${ops[0]}+${ops[1]})`
        break
      case 'threshold':
        e = `select(${ops[3]},${ops[2]},${ops[0]}>=${ops[1]})`
        break
      default:
        ok = false
        return '0.0'
    }
    const nm = `x${i++}`
    lines.push(`let ${nm}:f32=${e};`)
    names.set(n, nm)
    return nm
  }
  const group = (ns: OptNode[]) => {
    lines = []
    const outs = ns.map(visit)
    return { code: lines.join('\n      '), outs }
  }
  const cons = group(nodes.slice(1, 1 + nCons))
  const target = group([nodes[0]])
  // Bounds of the target and constraints over all the builds of a prefix (four pieces fixed, the
  // fifth free; `l${k}`/`h${k}`: each stat's range over the fifth slot). In f32, sums, products,
  // minima, maxima and the threshold's select are monotone: the corners bound exactly what the
  // scalar code computes for each of those builds. (`sum_frac` straddling 0: unbounded.)
  const inames = new Map<OptNode, [string, string]>()
  const ilines: string[] = []
  let ii = 0
  const ivisit = (n: OptNode): [string, string] => {
    const got = inames.get(n)
    if (got) return got
    const ops = (n.operands as OptNode[]).map(ivisit)
    let lo: string, hi: string
    switch (n.operation) {
      case 'const': {
        const l = wlit(n.value) ?? '0.0'
        inames.set(n, [l, l])
        return [l, l]
      }
      case 'read': {
        const c = col.get(n.path[1] as string)
        inames.set(n, [`l${c}`, `h${c}`])
        return [`l${c}`, `h${c}`]
      }
      case 'add':
        lo = ops.map((o) => o[0]).join('+')
        hi = ops.map((o) => o[1]).join('+')
        break
      case 'mul': {
        // left to right, as the scalar code: [a, b]·[c, d] spans its corners' products
        let [a, b] = ops[0]
        for (const [c, d] of ops.slice(1)) {
          const y = `y${ii++}`
          ilines.push(
            `let ${y}a:f32=${a}*${c}; let ${y}b:f32=${a}*${d}; let ${y}c:f32=${b}*${c}; let ${y}d:f32=${b}*${d};`,
            `let ${y}l:f32=min(min(${y}a,${y}b),min(${y}c,${y}d)); let ${y}h:f32=max(max(${y}a,${y}b),max(${y}c,${y}d));`
          )
          a = `${y}l`
          b = `${y}h`
        }
        inames.set(n, [a, b])
        return [a, b]
      }
      case 'min':
      case 'max':
        lo = ops.map((o) => o[0]).reduce((x, y) => `${n.operation}(${x},${y})`)
        hi = ops.map((o) => o[1]).reduce((x, y) => `${n.operation}(${x},${y})`)
        break
      case 'res':
        // decreasing
        lo = `resf(${ops[0][1]})`
        hi = `resf(${ops[0][0]})`
        break
      case 'threshold': {
        // surely ≥: pass; surely <: fail; else either
        const [v, t, pass, fail] = ops
        lo = `select(select(min(${pass[0]},${fail[0]}),${fail[0]},${v[1]}<${t[0]}),${pass[0]},${v[0]}>=${t[1]})`
        hi = `select(select(max(${pass[1]},${fail[1]}),${fail[1]},${v[1]}<${t[0]}),${pass[1]},${v[0]}>=${t[1]})`
        break
      }
      case 'sum_frac': {
        const [x, c] = ops
        const y = `y${ii++}`
        ilines.push(
          `let ${y}s:f32=${x[0]}+${c[0]}; let ${y}t:f32=${x[1]}+${c[1]}; let ${y}k:bool=${y}s>0.0||${y}t<0.0;`,
          `let ${y}a:f32=${x[0]}/${y}s; let ${y}b:f32=${x[0]}/${y}t; let ${y}c:f32=${x[1]}/${y}s; let ${y}d:f32=${x[1]}/${y}t;`
        )
        lo = `select(-3.0e38,min(min(${y}a,${y}b),min(${y}c,${y}d)),${y}k)`
        hi = `select(3.0e38,max(max(${y}a,${y}b),max(${y}c,${y}d)),${y}k)`
        break
      }
      default:
        ok = false
        return ['0.0', '0.0']
    }
    const z = `z${ii++}`
    ilines.push(`let ${z}l:f32=${lo}; let ${z}h:f32=${hi};`)
    inames.set(n, [`${z}l`, `${z}h`])
    return [`${z}l`, `${z}h`]
  }
  const iTarget = ivisit(nodes[0])
  const iCons = nodes.slice(1, 1 + nCons).map(ivisit)
  // A prefix none of whose builds can meet a constraint (or, in pass 1, reach the cut) is
  // skipped. The margin is ten times the constraint check's own f32 slack: any build that check
  // lets through is never in a skipped prefix.
  const below4 = (m: number) => wlit(m - (Math.abs(m) * 1e-4 + 1e-6))
  const deadConds = mins.map((m, j) => `(${iCons[j][1]}<${below4(m)})`)
  if (!plot)
    deadConds.push(
      `(P.mode == 1u && ${iTarget[1]} < P.thr - (abs(P.thr) * 1e-4 + 1e-6))`
    )
  const prune = deadConds.length > 0
  const plotG = plot ? group([nodes[1 + nCons]]) : undefined
  const baseLits = keys.map((k) => wlit(arts.base[k] ?? 0))
  if (!ok || baseLits.some((l) => l === undefined)) return undefined
  const consOk = nCons
    ? mins
        .map(
          (m, j) =>
            `(${cons.outs[j]}>=${wlit(m - (Math.abs(m) * 1e-5 + 1e-6))})`
        )
        .join('&&')
    : 'true'
  const ks = [...Array(K).keys()]
  // Plot bins (the GPU's, from the f32 plot value; see the top of this file). Pass 1 takes the
  // builds near their bin's best, at most `plotCap` per bin (counted after the bin maxima in BIN),
  // and reports each one's bin. (Leaving the builds right on a bin edge out of the bin maxima let
  // through hundreds of millions of candidates: with Elemental Mastery, every build without any
  // is on the edge of bin 0, and that bin had no maximum.)
  const PLOT_TAKE = plot
    ? `if (inb) { pb = u32(bk); }
        if (!take) {
          if (!inb) { take = true; }
          else if (v >= below(binMax(bk))) { take = atomicAdd(&BIN[${plot.len}u + pb], 1u) < ${plotCap(plot.len)}u; }
        }`
    : ''
  const rules = rainbow !== undefined
  const localBins = !!plot && plot.len <= LOCAL_BINS_MAX
  const BINS = localBins ? 'LB' : 'BIN'
  const ruleBindings = `@group(0) @binding(7) var<storage, read> RS: array<u32>;
const MOFF: u32 = ${setRules?.maskOffset ?? 0}u;
var<workgroup> redc: array<u32, ${WORKGROUP}>;`
  // Set rules: g0..g4 are the five set indices. A piece's count is 1 + the other pieces of its
  // set; "rainbow" pieces have a count of 1 (see `buildAllowed` in exclusion.ts).
  const pairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ]
  const outerRules = rules
    ? `let g0 = RS[w0]; let g1 = RS[w1]; let g2 = RS[w2]; let g3 = RS[w3];
    ${pairs.map(([a, b]) => `let e${a}${b} = select(0u, 1u, g${a} == g${b});`).join(' ')}`
    : ''
  const innerRules = rules
    ? `let g4 = RS[w4];
      let e04 = select(0u, 1u, g0 == g4); let e14 = select(0u, 1u, g1 == g4); let e24 = select(0u, 1u, g2 == g4); let e34 = select(0u, 1u, g3 == g4);
      let c0 = 1u + e01 + e02 + e03 + e04; let c1 = 1u + e01 + e12 + e13 + e14; let c2 = 1u + e02 + e12 + e23 + e24;
      let c3 = 1u + e03 + e13 + e23 + e34; let c4 = 1u + e04 + e14 + e24 + e34;
      let rb = select(0u, 1u, c0 == 1u) + select(0u, 1u, c1 == 1u) + select(0u, 1u, c2 == 1u) + select(0u, 1u, c3 == 1u) + select(0u, 1u, c4 == 1u);
      if ((((${rainbow! >>> 0}u >> rb) & (RS[MOFF + g0] >> c0) & (RS[MOFF + g1] >> c1) & (RS[MOFF + g2] >> c2) & (RS[MOFF + g3] >> c3) & (RS[MOFF + g4] >> c4)) & 1u) == 0u) { continue; }
      allowed = allowed + 1u;`
    : ''
  return `
struct Params { n0:u32, n1:u32, n2:u32, n3:u32, n4:u32, s0:u32, s1:u32, s2:u32, s3:u32, s4:u32,
  start:u32, count:u32, wgBase:u32, mode:u32, cap:u32, countFailed:u32, thr:f32, q0:f32, q1:f32, q2:f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> T: array<f32>;
@group(0) @binding(2) var<storage, read> S: array<u32>;
@group(0) @binding(3) var<storage, read_write> WG: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> CNT: array<atomic<u32>, 2>;
@group(0) @binding(5) var<storage, read_write> OUT: array<u32>;
${plot ? '@group(0) @binding(6) var<storage, read_write> BIN: array<atomic<u32>>;' : ''}
${rules ? ruleBindings : ''}
var<workgroup> red: array<f32, ${WORKGROUP}>;
${localBins ? `var<workgroup> LB: array<atomic<u32>, ${plot!.len}>;` : ''}
// order-preserving f32 -> u32 (for atomic maxima); 0 never occurs, so it marks empty
fn enc(v:f32)->u32 { let b = bitcast<u32>(v); if ((b & 0x80000000u) != 0u) { return ~b; } return b | 0x80000000u; }
fn resf(r:f32)->f32 { if (r<0.0) { return 1.0-r/2.0; } else if (r>=0.75) { return 1.0/(r*4.0+1.0); } return 1.0-r; }
${
  plot
    ? `const PSCALE: f32 = ${wlit(plot.scale)};
const PBASE: i32 = ${plot.base | 0};
const PLEN: i32 = ${plot.len | 0};
fn dec(u:u32)->f32 { if ((u & 0x80000000u) != 0u) { return bitcast<f32>(u & 0x7fffffffu); } return bitcast<f32>(~u); }
// A bin's best value from pass 0; none: -3e38
fn binMax(bk:i32)->f32 { let u = atomicLoad(&BIN[u32(bk)]); if (u == 0u) { return -3.0e38; } return dec(u); }
fn below(t:f32)->f32 { return t - abs(t) * ${wlit(REL)}; }`
    : ''
}
@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32,
        @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let li = gid.x + gid.y * nwg.x * ${WORKGROUP}u;
  var best: f32 = -3.0e38;
  var failed: u32 = 0u;
  var allowed: u32 = 0u;
  ${
    localBins
      ? `if (P.mode == 0u) { for (var b: u32 = lid; b < ${plot!.len}u; b = b + ${WORKGROUP}u) { atomicStore(&LB[b], 0u); } }
  workgroupBarrier();`
      : ''
  }
  if (li < P.count) {
    var q = P.start + li;
    let i3 = q % P.n3; q = q / P.n3;
    let i2 = q % P.n2; q = q / P.n2;
    let i1 = q % P.n1; let i0 = q / P.n1;
    // table rows of the four outer pieces (w*: rows; r*: stat sums, below)
    let w0 = S[P.s0 + i0]; let w1 = S[P.s1 + i1]; let w2 = S[P.s2 + i2]; let w3 = S[P.s3 + i3];
    let o0 = w0 * ${K}u; let o1 = w1 * ${K}u; let o2 = w2 * ${K}u; let o3 = w3 * ${K}u;
    ${outerRules}
    ${ks.map((k) => `let p${k}:f32=${baseLits[k]}+T[o0+${k}u]+T[o1+${k}u]+T[o2+${k}u]+T[o3+${k}u];`).join('\n    ')}
    ${
      prune
        ? `${ks.map((k) => `let l${k}:f32=p${k}+T[${tableRows * K + k}u]; let h${k}:f32=p${k}+T[${(tableRows + 1) * K + k}u];`).join(' ')}
    ${ilines.join('\n    ')}
    let dead = ${deadConds.join(' || ')};
    if (dead) {
      ${
        rules
          ? `if (P.mode != 1u) { for (var i4: u32 = 0u; i4 < P.n4; i4 = i4 + 1u) { let w4 = S[P.s4 + i4]; ${innerRules} failed = failed + 1u; } }`
          : 'failed = failed + P.n4;'
      }
    } else {`
        : ''
    }
    for (var i4: u32 = 0u; i4 < P.n4; i4 = i4 + 1u) {
      let w4 = S[P.s4 + i4];
      ${innerRules}
      let o4 = w4 * ${K}u;
      ${ks.map((k) => `let r${k}:f32=p${k}+T[o4+${k}u];`).join('\n      ')}
      ${cons.code}
      if (!(${consOk})) { failed = failed + 1u; continue; }
      ${target.code}
      let v:f32 = ${target.outs[0]};
      ${plotG ? `${plotG.code}\n      let x:f32 = ${plotG.outs[0]};\n      let bk:i32 = i32(floor(x / PSCALE)) - PBASE;\n      let inb = bk >= 0 && bk < PLEN;` : ''}
      if (P.mode != 1u) {
        best = max(best, v);
        ${
          plot
            ? ''
            : `if (P.mode == 2u) {
          let s = atomicAdd(&CNT[0], 1u);
          if (s < P.cap) { OUT[s * 2u] = P.start + li; OUT[s * 2u + 1u] = i4; }
        }`
        }
        ${plot ? `if (inb) { let e = enc(v); if (e > atomicLoad(&${BINS}[u32(bk)])) { atomicMax(&${BINS}[u32(bk)], e); } }` : ''}
      } else {
        var take = v >= P.thr;
        ${plot ? 'var pb: u32 = 0xffffffffu;' : ''}
        ${PLOT_TAKE}
        if (take) {
          let s = atomicAdd(&CNT[0], 1u);
          if (s < P.cap) {
            OUT[s * ${plot ? 3 : 2}u] = P.start + li; OUT[s * ${plot ? 3 : 2}u + 1u] = i4;
            ${plot ? 'OUT[s * 3u + 2u] = pb;' : ''}
          }
        }
      }
    }
    ${prune ? '}' : ''}
  }
  ${
    localBins
      ? `workgroupBarrier();
  if (P.mode == 0u) { for (var b: u32 = lid; b < ${plot!.len}u; b = b + ${WORKGROUP}u) { let u = atomicLoad(&LB[b]); if (u != 0u) { atomicMax(&BIN[b], u); } } }`
      : ''
  }
  if (P.countFailed != 0u && failed > 0u) { atomicAdd(&CNT[1], failed); }
  if (P.mode != 1u) {
    red[lid] = best;
    ${rules ? 'redc[lid] = allowed;' : ''}
    workgroupBarrier();
    for (var s: u32 = ${WORKGROUP / 2}u; s > 0u; s = s >> 1u) {
      if (lid < s) { red[lid] = max(red[lid], red[lid + s]); ${rules ? 'redc[lid] = redc[lid] + redc[lid + s];' : ''} }
      workgroupBarrier();
    }
    if (lid == 0u) {
      let bucket = (P.start / ${WORKGROUP}u + wid.x + wid.y * nwg.x) % ${BUCKETS}u;
      atomicMax(&WG[bucket], enc(red[0]));
      ${rules ? `atomicAdd(&WG[${BUCKETS}u + bucket], redc[0]);` : ''}
    }
  }
}
`
}
