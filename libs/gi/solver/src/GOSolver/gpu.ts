import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { precompute } from '@genshin-optimizer/gi/wr'
import type { ArtifactBuildData, ArtifactsBySlot } from '../common.js'
import { countBuilds } from '../common.js'
import type { PlotConfig, Setup } from '../type.js'
import { readKeys } from './SolverWorker.js'

/**
 * WebGPU brute-force backend.
 *
 * One compute shader is generated from the (setup) formula. Each invocation takes one
 * combination of the four smaller slots and loops over the largest one. The GPU works in f32
 * and is only used as a filter:
 *  - pass 0: per-workgroup maxima (and, when plotting, per-bin maxima) give a cutoff that at
 *    least `topN` builds reach,
 *  - pass 1: every build within a small margin of that cutoff (or of its plot bin's maximum) is
 *    returned as a candidate,
 * and every candidate is re-evaluated exactly (f64, same evaluator as the CPU path) by the caller.
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
/** Invocations per dispatch, so that each dispatch stays short */
const MAX_INVOCATIONS = 1 << 22
const CANDIDATE_CAP = 1 << 20
/** Relative f32 slack for cutoffs and constraints; candidates are re-checked in f64 */
const REL = 2e-5

export type GPUCandidate = { arts: ArtifactBuildData[]; values: number[] }
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
  private readonly params: GPUBuffer
  private readonly counters: GPUBuffer
  private readonly out: GPUBuffer
  private readonly bins?: GPUBuffer
  private readonly evaluate: ReturnType<typeof precompute<5>>
  private readonly topN: number
  private wg?: GPUBuffer
  private lost = false

  /** `undefined` when WebGPU is unavailable or the formula cannot be compiled */
  static async create(
    setup: Setup,
    plot: PlotConfig | undefined
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
    const src = shaderSource(
      nodes,
      setup.constraints.map((c) => c.min),
      readKeys(nodes),
      setup.arts,
      setup.plotBase ? plot : undefined
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
    return new GPUSolver(device, pipeline, nodes, setup, plot)
  }

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    nodes: OptNode[],
    setup: Setup,
    plot: PlotConfig | undefined
  ) {
    this.device = device
    this.pipeline = pipeline
    this.topN = setup.topN
    this.keys = readKeys(nodes)
    this.K = this.keys.length
    device.lost.then(() => (this.lost = true))

    const arts = allArtifactSlotKeys.flatMap((slot) => setup.arts.values[slot])
    this.rowOf = new Map(arts.map((art, i) => [art, i]))
    const table = new Float32Array(Math.max(1, arts.length * this.K))
    arts.forEach((art, i) =>
      this.keys.forEach((k, j) => (table[i * this.K + j] = art.values[k] ?? 0))
    )
    this.table = this.buffer(table.byteLength, BUFFER.STORAGE | BUFFER.COPY_DST)
    device.queue.writeBuffer(this.table, 0, table)
    this.params = this.buffer(80, BUFFER.UNIFORM | BUFFER.COPY_DST)
    this.counters = this.buffer(
      8,
      BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC
    )
    this.out = this.buffer(CANDIDATE_CAP * 8, BUFFER.STORAGE | BUFFER.COPY_SRC)
    if (setup.plotBase && plot)
      this.bins = this.buffer(
        Math.max(4, plot.len * 4),
        BUFFER.STORAGE | BUFFER.COPY_DST
      )
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
  async run(arts: ArtifactsBySlot, threshold: number): Promise<GPURun> {
    if (this.lost) throw new Error('WebGPU device lost')
    const lists = allArtifactSlotKeys
      .map((slot) => arts.values[slot])
      .sort((a, b) => a.length - b.length)
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
    const slotRows = this.buffer(
      rows.length * 4,
      BUFFER.STORAGE | BUFFER.COPY_DST
    )
    this.device.queue.writeBuffer(slotRows, 0, new Uint32Array(rows))

    const batches: {
      start: number
      count: number
      wx: number
      wy: number
      wgBase: number
    }[] = []
    let wgTotal = 0
    for (let start = 0; start < outer; start += MAX_INVOCATIONS) {
      const count = Math.min(MAX_INVOCATIONS, outer - start)
      const groups = Math.ceil(count / WORKGROUP)
      const wx = Math.min(groups, 65535),
        wy = Math.ceil(groups / wx)
      batches.push({ start, count, wx, wy, wgBase: wgTotal })
      wgTotal += wx * wy
    }
    if (!this.wg || this.wg.size < wgTotal * 4) {
      this.wg?.destroy()
      this.wg = this.buffer(wgTotal * 4, BUFFER.STORAGE | BUFFER.COPY_SRC)
    }
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        this.params,
        this.table,
        slotRows,
        this.wg,
        this.counters,
        this.out,
        ...(this.bins ? [this.bins] : []),
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    })
    const dispatch = (mode: number, thr: number, countFailed: boolean) => {
      for (const b of batches) {
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
        u.set(
          [
            b.start,
            b.count,
            b.wgBase,
            mode,
            CANDIDATE_CAP,
            countFailed ? 1 : 0,
          ],
          10
        )
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
    }

    // pass 0: cutoff that at least `topN` distinct builds reach (one per workgroup)
    this.device.queue.writeBuffer(this.counters, 0, new Uint32Array([0, 0]))
    dispatch(0, 0, true)
    const wgMax = new Float32Array(await this.read(this.wg, wgTotal * 4))
    const failed = new Uint32Array(await this.read(this.counters, 8))[1]
    const best = new Array<number>(this.topN).fill(Number.NEGATIVE_INFINITY)
    for (let i = 0; i < wgMax.length; i++) {
      const v = wgMax[i]
      if (!(v > best[this.topN - 1])) continue
      let j = this.topN - 1
      while (j > 0 && best[j - 1] < v) {
        best[j] = best[j - 1]
        j--
      }
      best[j] = v
    }
    let cut = Math.max(threshold, best[this.topN - 1])
    cut = Number.isFinite(cut) ? cut - Math.abs(cut) * REL : -3e38

    // pass 1: candidates
    this.device.queue.writeBuffer(this.counters, 0, new Uint32Array([0, 0]))
    dispatch(1, cut, false)
    const found = new Uint32Array(await this.read(this.counters, 8))[0]
    slotRows.destroy()
    if (found > CANDIDATE_CAP) return { ok: false, reason: 'overflow' }
    const pairs = new Uint32Array(
      found ? await this.read(this.out, found * 8) : new ArrayBuffer(0)
    )
    const candidates: GPUCandidate[] = []
    for (let c = 0; c < found; c++) {
      let r = pairs[2 * c]
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
        lists[4][pairs[2 * c + 1]],
      ]
      candidates.push({
        arts: picked,
        values: this.evaluate(picked as typeof picked & { length: 5 }),
      })
    }
    return { ok: true, tested: total, failed, candidates }
  }

  private buffer(size: number, usage: number) {
    return this.device.createBuffer({
      size: Math.max(4, Math.ceil(size / 4) * 4),
      usage,
    })
  }
  private async read(src: GPUBuffer, size: number): Promise<ArrayBuffer> {
    const dst = this.buffer(size, BUFFER.MAP_READ | BUFFER.COPY_DST)
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(src, 0, dst, 0, Math.ceil(size / 4) * 4)
    this.device.queue.submit([enc.finish()])
    await dst.mapAsync(MAP_READ)
    const data = dst.getMappedRange().slice(0, size)
    dst.unmap()
    dst.destroy()
    return data
  }
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
  plot: PlotConfig | undefined
): string | undefined {
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
  return `
struct Params { n0:u32, n1:u32, n2:u32, n3:u32, n4:u32, s0:u32, s1:u32, s2:u32, s3:u32, s4:u32,
  start:u32, count:u32, wgBase:u32, mode:u32, cap:u32, countFailed:u32, thr:f32, q0:f32, q1:f32, q2:f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> T: array<f32>;
@group(0) @binding(2) var<storage, read> S: array<u32>;
@group(0) @binding(3) var<storage, read_write> WG: array<f32>;
@group(0) @binding(4) var<storage, read_write> CNT: array<atomic<u32>, 2>;
@group(0) @binding(5) var<storage, read_write> OUT: array<vec2<u32>>;
${plot ? '@group(0) @binding(6) var<storage, read_write> BIN: array<atomic<u32>>;' : ''}
var<workgroup> red: array<f32, ${WORKGROUP}>;
fn resf(r:f32)->f32 { if (r<0.0) { return 1.0-r/2.0; } else if (r>=0.75) { return 1.0/(r*4.0+1.0); } return 1.0-r; }
${
  plot
    ? `const PSCALE: f32 = ${wlit(plot.scale)};
const PBASE: i32 = ${plot.base | 0};
const PLEN: i32 = ${plot.len | 0};
fn enc(v:f32)->u32 { let b = bitcast<u32>(v); if ((b & 0x80000000u) != 0u) { return ~b; } return b | 0x80000000u; }
fn dec(u:u32)->f32 { if ((u & 0x80000000u) != 0u) { return bitcast<f32>(u & 0x7fffffffu); } return bitcast<f32>(~u); }
fn binThr(bk:i32)->f32 {
  var t = dec(atomicLoad(&BIN[u32(bk)]));
  if (bk > 0) { let u = atomicLoad(&BIN[u32(bk - 1)]); if (u != 0u) { t = min(t, dec(u)); } }
  if (bk + 1 < PLEN) { let u = atomicLoad(&BIN[u32(bk + 1)]); if (u != 0u) { t = min(t, dec(u)); } }
  return t - abs(t) * ${wlit(REL)};
}`
    : ''
}
@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32,
        @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let li = gid.x + gid.y * nwg.x * ${WORKGROUP}u;
  var best: f32 = -3.0e38;
  var failed: u32 = 0u;
  if (li < P.count) {
    var q = P.start + li;
    let i3 = q % P.n3; q = q / P.n3;
    let i2 = q % P.n2; q = q / P.n2;
    let i1 = q % P.n1; let i0 = q / P.n1;
    let o0 = S[P.s0 + i0] * ${K}u; let o1 = S[P.s1 + i1] * ${K}u; let o2 = S[P.s2 + i2] * ${K}u; let o3 = S[P.s3 + i3] * ${K}u;
    ${ks.map((k) => `let p${k}:f32=${baseLits[k]}+T[o0+${k}u]+T[o1+${k}u]+T[o2+${k}u]+T[o3+${k}u];`).join('\n    ')}
    for (var i4: u32 = 0u; i4 < P.n4; i4 = i4 + 1u) {
      let o4 = S[P.s4 + i4] * ${K}u;
      ${ks.map((k) => `let r${k}:f32=p${k}+T[o4+${k}u];`).join('\n      ')}
      ${cons.code}
      if (!(${consOk})) { failed = failed + 1u; continue; }
      ${target.code}
      let v:f32 = ${target.outs[0]};
      ${plotG ? `${plotG.code}\n      let x:f32 = ${plotG.outs[0]};\n      let bk:i32 = i32(floor(x / PSCALE)) - PBASE;\n      let inb = bk >= 0 && bk < PLEN;` : ''}
      if (P.mode == 0u) {
        best = max(best, v);
        ${plot ? 'if (inb) { atomicMax(&BIN[u32(bk)], enc(v)); }' : ''}
      } else {
        var take = v >= P.thr;
        ${plot ? 'if (!take) { take = !inb || v >= binThr(bk); }' : ''}
        if (take) {
          let s = atomicAdd(&CNT[0], 1u);
          if (s < P.cap) { OUT[s] = vec2<u32>(P.start + li, i4); }
        }
      }
    }
  }
  if (P.countFailed != 0u && failed > 0u) { atomicAdd(&CNT[1], failed); }
  if (P.mode == 0u) {
    red[lid] = best;
    workgroupBarrier();
    for (var s: u32 = ${WORKGROUP / 2}u; s > 0u; s = s >> 1u) {
      if (lid < s) { red[lid] = max(red[lid], red[lid + s]); }
      workgroupBarrier();
    }
    if (lid == 0u) { WG[P.wgBase + wid.x + wid.y * nwg.x] = red[0]; }
  }
}
`
}
