import type { OptNode } from '@genshin-optimizer/gi/wr'
import type { MinMax } from '../common.js'

/**
 * Compiled enumeration kernel for one 5-slot search space.
 *
 * The generated function walks all builds with 5 nested loops over `Float64Array`s of
 * artifact stats, keeping incremental partial sums per loop level. At the outer levels it
 * evaluates an interval upper bound of the constraints and the target (exact partial sums
 * plus the per-key [min, max] of the remaining slots) and skips the whole sub-tree when no
 * build in it can satisfy the constraints or beat the current threshold. At the leaves the
 * constraints are evaluated first, so the (usually much larger) target formula only runs
 * for feasible builds. Nothing is allocated per build.
 *
 * Arithmetic is identical to `precompute` in `gi/wr` (same operations in the same order), so
 * build values match the previous engine bit-for-bit for the same inputs.
 */

/** Data for one kernel call; arrays are in loop order (level 0 = outermost). */
export type KernelData = {
  /** `A[l]` holds `n[l] * K` stat values, one row of `K` per artifact */
  A: Float64Array[]
  n: number[]
  /** `K` base values */
  base: Float64Array
  /**
   * `R[l]` (l < 4): for each key `k`, the sum over levels `l+1..4` of the per-level minimum
   * (`R[l][2k]`) and maximum (`R[l][2k+1]`)
   */
  R: Float64Array[]
}

export type KernelPlot = {
  /** bin index = floor(x / scale) - base, valid when in [0, V.length). Same expression as `mergePlot`. */
  scale: number
  base: number
  /** best value, its plot value, its loop indices (5 per bin) and a dirty flag, per bin */
  V: Float64Array
  X: Float64Array
  I: Int32Array
  D: Uint8Array
  /** called for builds whose bin falls outside the arrays */
  miss: (
    x: number,
    v: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    i4: number
  ) => void
}

export type KernelState = {
  /** local top-N values (descending) and their loop indices (5 per entry) */
  topV: Float64Array
  topI: Int32Array
  /** builds must be strictly greater than this to be recorded (and, when bounding the target, to be explored) */
  thr: number
  tested: number
  failed: number
  skipped: number
  plot?: KernelPlot
}

export type Kernel = (data: KernelData, state: KernelState) => void

export type KernelSpec = {
  /** `[target, ...constraints, plot?]` */
  nodes: OptNode[]
  /** minimum of each constraint `nodes[1..mins.length]` */
  mins: number[]
  plot: boolean
  /** dyn key -> column in the stat rows */
  column: Map<string, number>
  K: number
  /** node ranges over the whole search space, used to specialise interval products by sign */
  ranges?: Map<OptNode, MinMax>
  /** prune sub-trees whose target cannot beat `thr` (must be off when plotting) */
  boundTarget: boolean
  /** loop levels (0..3) at which bounds are checked */
  boundLevels: number[]
}

export function newKernelState(topN: number, thr: number): KernelState {
  return {
    topV: new Float64Array(topN).fill(Number.NEGATIVE_INFINITY),
    topI: new Int32Array(topN * 5).fill(-1),
    thr,
    tested: 0,
    failed: 0,
    skipped: 0,
  }
}

const kernelCache = new Map<string, Kernel>()
/** Compile (or reuse) the kernel for `spec` */
export function compileKernel(spec: KernelSpec): Kernel {
  const src = kernelSource(spec)
  let kernel = kernelCache.get(src)
  if (!kernel) {
    if (kernelCache.size >= 64) kernelCache.clear()
    kernel = new Function(src)() as Kernel
    kernelCache.set(src, kernel)
  }
  return kernel
}

// Same as `res` in `gi/wr` optimization.ts
const RES =
  'function res(r){if(r<0)return 1-r/2;else if(r>=0.75)return 1/(r*4+1);return 1-r}'

export function kernelSource(spec: KernelSpec): string {
  const { nodes, mins, plot, column, K, boundTarget, boundLevels } = spec
  const nCons = mins.length
  const target = nodes[0]
  const cons = nodes.slice(1, 1 + nCons)
  const plotNodes = plot ? [nodes[1 + nCons]] : []
  const col = (key: string) => {
    const c = column.get(key)
    if (c === undefined) throw new Error(`Missing column for dyn key ${key}`)
    return c
  }
  const ks = [...Array(K).keys()]
  const skipCount = ['c1', 'c2', 'c3', 'c4']

  const out: string[] = []
  out.push('"use strict";', RES, 'return function kernel(D,S){')
  out.push('const A0=D.A[0],A1=D.A[1],A2=D.A[2],A3=D.A[3],A4=D.A[4];')
  out.push('const n0=D.n[0],n1=D.n[1],n2=D.n[2],n3=D.n[3],n4=D.n[4];')
  out.push('const c1=n1*n2*n3*n4,c2=n2*n3*n4,c3=n3*n4,c4=n4;')
  if (boundLevels.length)
    out.push('const R0=D.R[0],R1=D.R[1],R2=D.R[2],R3=D.R[3];')
  out.push(
    'const topV=S.topV,topI=S.topI,N=topV.length;let thr=S.thr,tested=0,failed=0,skipped=0;'
  )
  if (plot)
    out.push(
      'const P=S.plot,PV=P.V,PX=P.X,PI=P.I,PD=P.D,PSCALE=P.scale,PBASE=P.base,PLEN=PV.length,MISS=P.miss;'
    )
  out.push(ks.map((k) => `const b${k}=D.base[${k}];`).join(''))
  const prev = (l: number, k: number) => (l === 0 ? `b${k}` : `p${l - 1}_${k}`)

  for (let l = 0; l < 5; l++) {
    out.push(`for(let i${l}=0;i${l}<n${l};i${l}++){const o${l}=i${l}*${K};`)
    if (l < 4) {
      out.push(
        ks
          .map((k) => `const p${l}_${k}=${prev(l, k)}+A${l}[o${l}+${k}];`)
          .join('')
      )
      if (boundLevels.includes(l) && (nCons || boundTarget)) {
        const iv = emitInterval(
          [cons, boundTarget ? [target] : []],
          (key) => {
            const k = col(key)
            return [
              `(p${l}_${k}+R${l}[${2 * k}])`,
              `(p${l}_${k}+R${l}[${2 * k + 1}])`,
            ]
          },
          `u${l}_`,
          spec.ranges
        )
        out.push('{', iv.codes[0])
        // NaN bounds never prune
        if (nCons)
          out.push(
            `if(${cons.map((_, i) => `${iv.outs[0][i][1]}<${lit(mins[i])}`).join('||')}){skipped+=${skipCount[l]};continue}`
          )
        if (boundTarget)
          out.push(
            iv.codes[1],
            `if(${iv.outs[1][0][1]}<=thr){skipped+=${skipCount[l]};continue}`
          )
        out.push('}')
      }
    } else {
      out.push(ks.map((k) => `const r${k}=${prev(4, k)}+A4[o4+${k}];`).join(''))
      out.push('tested++;')
      const pe = emitPoint([cons, [target], plotNodes], (key) => `r${col(key)}`)
      out.push(pe.codes[0])
      // `!(c>=m)` so that NaN fails, like `min.every((m, i) => m <= result[i])` did
      if (nCons)
        out.push(
          `if(${cons.map((_, i) => `!(${pe.outs[0][i]}>=${lit(mins[i])})`).join('||')}){failed++;continue}`
        )
      out.push(pe.codes[1], `const v=${pe.outs[1][0]};`)
      if (plot)
        out.push(
          pe.codes[2],
          `{const x=${pe.outs[2][0]};const bk=Math.floor(x/PSCALE)-PBASE;` +
            'if(bk>=0&&bk<PLEN){if(v>PV[bk]){PV[bk]=v;PX[bk]=x;const q=bk*5;PI[q]=i0;PI[q+1]=i1;PI[q+2]=i2;PI[q+3]=i3;PI[q+4]=i4;PD[bk]=1}}' +
            'else MISS(x,v,i0,i1,i2,i3,i4)}'
        )
      out.push(
        'if(v>thr){let j=N-1;while(j>0&&topV[j-1]<v){topV[j]=topV[j-1];const a=j*5,b=a-5;' +
          'topI[a]=topI[b];topI[a+1]=topI[b+1];topI[a+2]=topI[b+2];topI[a+3]=topI[b+3];topI[a+4]=topI[b+4];j--}' +
          'topV[j]=v;const a=j*5;topI[a]=i0;topI[a+1]=i1;topI[a+2]=i2;topI[a+3]=i3;topI[a+4]=i4;' +
          'if(topV[N-1]>thr)thr=topV[N-1]}'
      )
    }
  }
  out.push('}}}}}')
  out.push('S.thr=thr;S.tested+=tested;S.failed+=failed;S.skipped+=skipped;}')
  return out.join('\n')
}

function lit(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Number.POSITIVE_INFINITY) return 'Infinity'
  if (v === Number.NEGATIVE_INFINITY) return '(-Infinity)'
  return v < 0 || Object.is(v, -0) ? `(${v})` : `${v}`
}

/** Point evaluation of several node groups sharing common sub-expressions */
function emitPoint(groups: OptNode[][], readVar: (key: string) => string) {
  const names = new Map<OptNode, string>()
  let i = 0,
    lines: string[] = []
  const visit = (n: OptNode): string => {
    const got = names.get(n)
    if (got !== undefined) return got
    const ops = (n.operands as OptNode[]).map(visit)
    let expr: string
    switch (n.operation) {
      case 'const':
        names.set(n, lit(n.value))
        return names.get(n)!
      case 'read':
        names.set(n, readVar(n.path[1] as string))
        return names.get(n)!
      case 'add':
        expr = ops.join('+')
        break
      case 'mul':
        expr = ops.join('*')
        break
      case 'min':
      case 'max':
        expr = `Math.${n.operation}(${ops.join(',')})`
        break
      case 'res':
        expr = `res(${ops[0]})`
        break
      case 'sum_frac':
        expr = `${ops[0]}/(${ops[0]}+${ops[1]})`
        break
      case 'threshold':
        expr = `(${ops[0]}>=${ops[1]})?${ops[2]}:${ops[3]}`
        break
      default:
        throw new Error(`Unsupported operation ${(n as OptNode).operation}`)
    }
    const name = `x${i++}`
    lines.push(`const ${name}=${expr};`)
    names.set(n, name)
    return name
  }
  const codes: string[] = [],
    outs: string[][] = []
  for (const group of groups) {
    lines = []
    outs.push(group.map(visit))
    codes.push(lines.join(''))
  }
  return { codes, outs }
}

/** Interval evaluation (sound outer bounds) of several node groups sharing sub-expressions */
function emitInterval(
  groups: OptNode[][],
  readVar: (key: string) => [string, string],
  prefix: string,
  ranges?: Map<OptNode, MinMax>
) {
  const names = new Map<OptNode, [string, string]>()
  let i = 0,
    lines: string[] = []
  const nonNegative = (n: OptNode) => {
    const r = ranges?.get(n)
    return !!r && r.min >= 0
  }
  const visit = (n: OptNode): [string, string] => {
    const got = names.get(n)
    if (got !== undefined) return got
    const ops = (n.operands as OptNode[]).map(visit)
    if (n.operation === 'const') {
      const c = lit(n.value)
      names.set(n, [c, c])
      return [c, c]
    }
    if (n.operation === 'read') {
      const r = readVar(n.path[1] as string)
      names.set(n, r)
      return r
    }
    const lo = `${prefix}${i}l`,
      hi = `${prefix}${i}h`,
      t = `${prefix}${i}t`
    i++
    switch (n.operation) {
      case 'add':
        lines.push(
          `const ${lo}=${ops.map((o) => o[0]).join('+')},${hi}=${ops.map((o) => o[1]).join('+')};`
        )
        break
      case 'mul': {
        if ((n.operands as OptNode[]).every(nonNegative)) {
          lines.push(
            `const ${lo}=${ops.map((o) => o[0]).join('*')},${hi}=${ops.map((o) => o[1]).join('*')};`
          )
          break
        }
        let [cl, ch] = ops[0]
        for (let j = 1; j < ops.length; j++) {
          const [ol, oh] = ops[j]
          const q = `${t}${j}`
          lines.push(
            `const ${q}a=${cl}*${ol},${q}b=${cl}*${oh},${q}c=${ch}*${ol},${q}d=${ch}*${oh};` +
              `const ${q}l=Math.min(${q}a,${q}b,${q}c,${q}d),${q}h=Math.max(${q}a,${q}b,${q}c,${q}d);`
          )
          cl = `${q}l`
          ch = `${q}h`
        }
        lines.push(`const ${lo}=${cl},${hi}=${ch};`)
        break
      }
      case 'min':
      case 'max':
        lines.push(
          `const ${lo}=Math.${n.operation}(${ops.map((o) => o[0]).join(',')}),` +
            `${hi}=Math.${n.operation}(${ops.map((o) => o[1]).join(',')});`
        )
        break
      case 'res': // monotonically decreasing
        lines.push(`const ${lo}=res(${ops[0][1]}),${hi}=res(${ops[0][0]});`)
        break
      case 'sum_frac': {
        // x / (x + c): monotone in x and in the sum separately as long as the sum does not
        // cross zero, so the extremes are at the corners. Otherwise unbounded.
        const [x, c] = ops
        lines.push(
          `const ${t}sl=${x[0]}+${c[0]},${t}sh=${x[1]}+${c[1]};let ${lo}=-Infinity,${hi}=Infinity;` +
            `if(${t}sl>0||${t}sh<0){const ${t}a=${x[0]}/${t}sl,${t}b=${x[0]}/${t}sh,${t}c=${x[1]}/${t}sl,${t}d=${x[1]}/${t}sh;` +
            `${lo}=Math.min(${t}a,${t}b,${t}c,${t}d);${hi}=Math.max(${t}a,${t}b,${t}c,${t}d)}`
        )
        break
      }
      case 'threshold': {
        const [v, th, pass, fail] = ops
        lines.push(
          `const ${lo}=(${v[0]}>=${th[1]})?${pass[0]}:(${v[1]}<${th[0]})?${fail[0]}:Math.min(${pass[0]},${fail[0]}),` +
            `${hi}=(${v[0]}>=${th[1]})?${pass[1]}:(${v[1]}<${th[0]})?${fail[1]}:Math.max(${pass[1]},${fail[1]});`
        )
        break
      }
      default:
        throw new Error(`Unsupported operation ${(n as OptNode).operation}`)
    }
    names.set(n, [lo, hi])
    return [lo, hi]
  }
  const codes: string[] = [],
    outs: [string, string][][] = []
  for (const group of groups) {
    lines = []
    outs.push(group.map(visit))
    codes.push(lines.join(''))
  }
  return { codes, outs }
}

/** Exposed for tests only */
export const testing = { emitInterval, emitPoint, lit, RES }
