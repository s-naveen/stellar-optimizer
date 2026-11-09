import {
  assertUnreachable,
  objKeyMap,
  objMap,
  range,
} from '@genshin-optimizer/common/util'
import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtSetExclusion,
  ArtSetExclusionKey,
} from '@genshin-optimizer/gi/db'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import {
  allOperations,
  constant,
  dynRead,
  forEachNodes,
  mapFormulas,
  max,
  min,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'

type MicropassOperation =
  | 'reaffine'
  | 'pruneArtRange'
  | 'pruneNodeRange'
  | 'pruneOrder'
export function pruneAll(
  nodes: OptNode[],
  minimum: number[],
  arts: ArtifactsBySlot,
  numTop: number,
  exclusion: ArtSetExclusion,
  forced: Partial<Record<MicropassOperation, boolean>>
): { nodes: OptNode[]; arts: ArtifactsBySlot } {
  let should = forced
  /** If `key` makes progress, all operations in `value` should be performed */
  const deps: Record<
    MicropassOperation,
    Partial<Record<MicropassOperation, true>>
  > = {
    pruneOrder: { pruneNodeRange: true },
    pruneArtRange: { pruneNodeRange: true },
    pruneNodeRange: { reaffine: true },
    reaffine: { pruneOrder: true, pruneArtRange: true, pruneNodeRange: true },
  }
  let count = 0
  while (Object.values(should).some((x) => x) && count++ < 20) {
    if (should.pruneOrder) {
      delete should.pruneOrder
      const newArts = pruneOrder(arts, numTop, exclusion)
      if (arts !== newArts) {
        arts = newArts
        should = { ...should, ...deps.pruneOrder }
      }
    }
    if (should.pruneArtRange) {
      delete should.pruneArtRange
      const newArts = pruneArtRange(nodes, arts, minimum)
      if (arts !== newArts) {
        arts = newArts
        should = { ...should, ...deps.pruneArtRange }
      }
    }
    if (should.pruneNodeRange) {
      delete should.pruneNodeRange
      const newNodes = pruneNodeRange(nodes, arts)
      if (nodes !== newNodes) {
        nodes = newNodes
        should = { ...should, ...deps.pruneNodeRange }
      }
    }
    if (should.reaffine) {
      delete should.reaffine
      const { nodes: newNodes, arts: newArts } = reaffine(nodes, arts)
      if (nodes !== newNodes || arts !== newArts) {
        nodes = newNodes
        arts = newArts
        should = { ...should, ...deps.reaffine }
      }
    }
  }
  return { nodes, arts }
}

export function pruneExclusion(
  nodes: OptNode[],
  exclusion: ArtSetExclusion
): OptNode[] {
  const maxValues: Partial<Record<keyof typeof exclusion, number>> = {}
  for (const [key, e] of Object.entries(exclusion)) {
    if (!e.includes(4)) continue
    maxValues[key] = e.includes(2) ? 1 : 3
  }
  return mapFormulas(
    nodes,
    (f) => f,
    (f) => {
      if (f.operation !== 'threshold') return f

      const [v, t, pass, fail] = f.operands
      if (v.operation === 'read' && t.operation === 'const') {
        const key = v.path[v.path.length - 1],
          thres = t.value
        if (key in maxValues) {
          const max: number = maxValues[key as keyof typeof maxValues] ?? 0
          if (max < thres) return fail
          if (
            thres === 2 &&
            (exclusion[key as keyof typeof exclusion] ?? []).includes(2)
          )
            return threshold(v, 4, pass, fail)
        }
      }
      return f
    }
  )
}

function reaffine(
  nodes: OptNode[],
  arts: ArtifactsBySlot,
  forceRename = false
): { nodes: OptNode[]; arts: ArtifactsBySlot } {
  const affineNodes = new Set<OptNode>(),
    topLevelAffine = new Set<OptNode>()

  function visit(node: OptNode, isAffine: boolean): OptNode {
    if (isAffine) affineNodes.add(node)
    else
      node.operands.forEach(
        (op) => affineNodes.has(op) && topLevelAffine.add(op)
      )
    return node
  }

  const dynKeys = new Set<string>()

  nodes = mapFormulas(
    nodes,
    (_) => _,
    (f) => {
      const { operation } = f
      switch (operation) {
        case 'read':
          dynKeys.add(f.path[1])
          return visit(f, true)
        case 'add': {
          const affineOps = f.operands.filter((op) => affineNodes.has(op))
          const nonAffineOps = f.operands.filter((op) => !affineNodes.has(op))
          if (nonAffineOps.length === 0) return visit(f, true)
          if (affineOps.length <= 1) return visit(f, false)
          const affine = visit(sum(...affineOps), true)
          return visit(sum(affine, ...nonAffineOps), false)
        }
        case 'mul': {
          const nonConst = f.operands.filter((op) => op.operation !== 'const')
          return visit(
            f,
            nonConst.length === 0 ||
              (nonConst.length === 1 && affineNodes.has(nonConst[0]))
          )
        }
        case 'const':
          return visit(f, true)
        case 'res':
        case 'threshold':
        case 'sum_frac':
        case 'max':
        case 'min':
          return visit(f, false)
        default:
          assertUnreachable(operation)
      }
    }
  )

  nodes
    .filter((node) => affineNodes.has(node))
    .forEach((node) => topLevelAffine.add(node))
  if (
    [...topLevelAffine].every(
      ({ operation }) => operation === 'read' || operation === 'const'
    ) &&
    Object.keys(arts.base).length === dynKeys.size
  )
    return { nodes, arts }

  let current = -1
  function nextDynKey(): string {
    while (dynKeys.has(`${++current}`));
    return `${current}`
  }

  const affine = [...topLevelAffine].filter((f) => f.operation !== 'const')
  const affineMap = new Map(
    affine.map((node) => [
      node as OptNode,
      !forceRename && node.operation === 'read' && node.path[0] === 'dyn'
        ? node
        : dynRead(nextDynKey()),
    ])
  )
  nodes = mapFormulas(
    nodes,
    (f) => affineMap.get(f) ?? f,
    (f) => f
  )

  const affineValues = affineEvaluator([...affineMap.keys()])
  const affineKeys = [...affineMap.values()].map((v) => v.path[1])
  function reaffineArt(stat: DynStat): DynStat {
    const values = affineValues(stat)
    return Object.fromEntries(affineKeys.map((key, i) => [key, values[i]]))
  }
  const result = {
    nodes,
    arts: {
      base: reaffineArt(arts.base),
      values: objKeyMap(allArtifactSlotKeys, (slot) =>
        arts.values[slot].map(({ id, set, values }) => ({
          id,
          set,
          values: reaffineArt(values),
        }))
      ),
    },
  }
  const offsets = Object.entries(reaffineArt({}))
  for (const arts of Object.values(result.arts.values))
    for (const { values } of arts)
      for (const [key, baseValue] of offsets) values[key] -= baseValue
  return result
}
/**
 * Remove artifacts that cannot be in top `numTop` builds.
 *
 * Pass `numTop = Infinity` to disable (e.g. when plotting, where every build that is the best
 * at some plot value matters, not only the overall top builds).
 */
function pruneOrder(
  arts: ArtifactsBySlot,
  numTop: number,
  exclusion: ArtSetExclusion
): ArtifactsBySlot {
  if (!Number.isFinite(numTop)) return arts
  let progress = false
  /**
   * Note:
   * This function assumes that every base (reaffined) stats are monotonically increasing. That is, artifacts
   * with higher stats are better. This remains true as long as the main and substats are in increasing. Set
   * effects that decrease enemy resistance (which is monotonically decreasing) does not violate this assumption
   * as set effects are not handled here.
   */
  const allowRainbow = !exclusion.rainbow?.length,
    keys = Object.keys(arts.base)
  const noSwitchIn = new Set(
    Object.entries(exclusion)
      .filter(([_, v]) => v.length)
      .map(([k]) => k) as ArtifactSetKey[]
  )
  const noSwitchOut = new Set(
    Object.entries(exclusion)
      .filter(([_, v]) => v.includes(2) && !v.includes(4))
      .map(([k]) => k) as ArtifactSetKey[]
  )
  const values = objKeyMap(allArtifactSlotKeys, (slot) => {
    const list = arts.values[slot]
    const stats = list.map((art) => keys.map((k) => art.values[k] ?? 0))
    const newList = list.filter((art, a) => {
      let count = 0
      const mine = stats[a]
      return list.every((other, o) => {
        const theirs = stats[o]
        // every stat at least as high (NaN: not), and one of them higher
        let otherBetterEqual = true,
          otherMaybeBetter = false
        for (let k = 0; k < mine.length; k++) {
          if (!(theirs[k] >= mine[k])) {
            otherBetterEqual = false
            break
          }
          if (theirs[k] > mine[k]) otherMaybeBetter = true
        }
        const otherBetter =
          otherBetterEqual && (otherMaybeBetter || other.id > art.id)
        const canSwitch =
          (allowRainbow &&
            !noSwitchIn.has(other.set!) &&
            !noSwitchOut.has(art.set!)) ||
          art.set === other.set
        if (otherBetter && canSwitch) count++
        return count < numTop
      })
    })
    if (newList.length !== list.length) progress = true
    return newList
  })
  return progress ? { base: arts.base, values } : arts
}
/** Remove artifacts that cannot reach `minimum` in any build */
export function pruneArtRange(
  nodes: OptNode[],
  arts: ArtifactsBySlot,
  minimum: number[]
): ArtifactsBySlot {
  const baseRange = Object.fromEntries(
    Object.entries(arts.base).map(([key, x]) => [key, { min: x, max: x }])
  )
  const wrap = { arts }
  const rangesOf = nodeRangeEvaluator(nodes)
  while (true) {
    const artRanges = objKeyMap(allArtifactSlotKeys, (slot) =>
      computeArtRange(wrap.arts.values[slot])
    )
    const otherArtRanges = objKeyMap(allArtifactSlotKeys, (key) =>
      addArtRange(
        Object.entries(artRanges)
          .map((a) => (a[0] === key ? baseRange : a[1]))
          .filter((x) => x)
      )
    )

    let progress = false
    const values = objKeyMap(allArtifactSlotKeys, (slot) => {
      const result = wrap.arts.values[slot].filter((art) => {
        const read = addArtRange([computeArtRange([art]), otherArtRanges[slot]])
        return rangesOf(read).every(
          (range, i) => range.max >= (minimum[i] ?? Number.NEGATIVE_INFINITY)
        )
      })
      if (result.length !== wrap.arts.values[slot].length) progress = true
      return result
    })
    if (!progress) break
    wrap.arts = { base: wrap.arts.base, values }
  }
  return wrap.arts
}
function pruneNodeRange(nodes: OptNode[], arts: ArtifactsBySlot): OptNode[] {
  const baseRange = Object.fromEntries(
    Object.entries(arts.base).map(([key, x]) => [key, { min: x, max: x }])
  )
  const reads = addArtRange([
    baseRange,
    ...Object.values(arts.values).map((values) => computeArtRange(values)),
  ])
  const nodeRange = computeNodeRange(nodes, reads)

  return mapFormulas(
    nodes,
    (f) => {
      {
        const { min, max } = nodeRange.get(f)!
        if (min === max) return constant(min)
      }
      const { operation } = f
      const operandRanges = f.operands.map((x) => nodeRange.get(x)!)
      switch (operation) {
        case 'threshold': {
          const [value, threshold, pass, fail] = operandRanges
          if (value.min >= threshold.max) return f.operands[2]
          else if (value.max < threshold.min) return f.operands[3]
          if (
            pass.max === pass.min &&
            fail.max === fail.min &&
            pass.min === fail.min &&
            Number.isFinite(pass.min)
          )
            return constant(pass.max)
          break
        }
        case 'min': {
          const newOperands = f.operands.filter((_, i) => {
            const op1 = operandRanges[i]
            return operandRanges.every((op2) => op1.min <= op2.max)
          })
          if (newOperands.length < operandRanges.length)
            return min(...newOperands)
          break
        }
        case 'max': {
          const newOperands = f.operands.filter((_, i) => {
            const op1 = operandRanges[i]
            return operandRanges.every((op2) => op1.max >= op2.min)
          })
          if (newOperands.length < operandRanges.length)
            return max(...newOperands)
          break
        }
      }
      return f
    },
    (f) => f
  )
}
function addArtRange(ranges: DynMinMax[]): DynMinMax {
  const result: DynMinMax = {}
  ranges.forEach((range) => {
    Object.entries(range).forEach(([key, value]) => {
      if (result[key]) {
        result[key].min += value.min
        result[key].max += value.max
      } else result[key] = { ...value }
    })
  })
  return result
}
function computeArtRange(arts: ArtifactBuildData[]): DynMinMax {
  const result: DynMinMax = {}
  if (arts.length) {
    Object.keys(arts[0].values)
      .filter((key) => arts.every((art) => art.values[key]))
      .forEach(
        (key) =>
          (result[key] = { min: arts[0].values[key], max: arts[0].values[key] })
      )
    arts.forEach(({ values }) => {
      for (const [key, value] of Object.entries(values)) {
        // Some artifacts lack `key` (i.e., 0), so the range must include 0
        if (!result[key])
          result[key] = { min: Math.min(0, value), max: Math.max(0, value) }
        else {
          if (result[key].max < value) result[key].max = value
          if (result[key].min > value) result[key].min = value
        }
      }
    })
  }
  return result
}
export function computeFullArtRange(arts: ArtifactsBySlot): DynMinMax {
  const baseRange = Object.fromEntries(
    Object.entries(arts.base).map(([key, x]) => [key, { min: x, max: x }])
  )
  return addArtRange([
    baseRange,
    ...Object.values(arts.values).map((values) => computeArtRange(values)),
  ])
}
export function computeNodeRange(
  nodes: OptNode[],
  reads: DynMinMax
): Map<OptNode, MinMax> {
  const range = new Map<OptNode, MinMax>()

  forEachNodes(
    nodes,
    (_) => {},
    (f) =>
      range.set(
        f,
        nodeRange(
          f,
          f.operands.map((op) => range.get(op)!),
          reads
        )
      )
  )
  return range
}
/**
 * `computeNodeRange` for many `reads` (one per artifact...): the nodes are walked once, then each
 * call only evaluates them in order. Returns the ranges of `nodes` themselves.
 */
export function nodeRangeEvaluator(
  nodes: OptNode[]
): (reads: DynMinMax) => MinMax[] {
  const order: OptNode[] = []
  const index = new Map<OptNode, number>()
  forEachNodes(
    nodes,
    (_) => {},
    (f) => {
      if (index.has(f)) return
      index.set(f, order.length)
      order.push(f)
    }
  )
  // Straight-line code, the same arithmetic as `nodeRange` (each operation as `allOperations`
  // and `computeMinMax` do it, operands in the same order): bit-identical ranges, without a
  // walk, an array or an object per node and artifact
  const consts: number[] = []
  const lines: string[] = []
  const L = (n: OptNode) => `L[${index.get(n)}]`
  const H = (n: OptNode) => `H[${index.get(n)}]`
  order.forEach((f, i) => {
    const ops = f.operands as OptNode[]
    const l = `L[${i}]`,
      h = `H[${i}]`
    const { operation } = f
    switch (operation) {
      case 'read': {
        if (f.path[0] !== 'dyn')
          throw new Error(`Found non-dyn path ${f.path} while computing range`)
        lines.push(
          `r = reads[${JSON.stringify(f.path[1])}]; if (r === undefined || r === null) { ${l} = 0; ${h} = 0 } else { ${l} = r.min; ${h} = r.max }`
        )
        break
      }
      case 'const':
        consts.push(f.value)
        lines.push(`${l} = C[${consts.length - 1}]; ${h} = ${l}`)
        break
      case 'add':
        lines.push(
          `${l} = 0 + ${ops.map(L).join(' + ')}; ${h} = 0 + ${ops.map(H).join(' + ')}`
        )
        break
      case 'min':
      case 'max':
        lines.push(
          `${l} = Math.${operation}(${ops.map(L).join(', ')}); ${h} = Math.${operation}(${ops.map(H).join(', ')})`
        )
        break
      case 'res':
        lines.push(`${l} = RES([${H(ops[0])}]); ${h} = RES([${L(ops[0])}])`)
        break
      case 'mul': {
        // (reduce without a seed: one operand is its own range)
        lines.push(`a = ${L(ops[0])}; b = ${H(ops[0])}`)
        for (const op of ops.slice(1))
          lines.push(
            `p = a * ${L(op)}; q = a * ${H(op)}; s = b * ${L(op)}; t = b * ${H(op)}; a = Math.min(p, q, s, t); b = Math.max(p, q, s, t)`
          )
        lines.push(`${l} = a; ${h} = b`)
        break
      }
      case 'threshold': {
        const [v, t, pass, fail] = ops
        lines.push(
          `if (${L(v)} >= ${H(t)}) { ${l} = ${L(pass)}; ${h} = ${H(pass)} } else if (${H(v)} < ${L(t)}) { ${l} = ${L(fail)}; ${h} = ${H(fail)} } else { ${h} = Math.max(${H(pass)}, ${H(fail)}); ${l} = Math.min(${L(pass)}, ${L(fail)}) }`
        )
        break
      }
      case 'sum_frac': {
        const [x, c] = ops
        lines.push(
          `a = ${L(x)} + ${L(c)}; b = ${H(x)} + ${H(c)}; if (a <= 0 && b >= 0) { if (${L(x)} <= 0 && ${H(x)} >= 0) { ${l} = NaN; ${h} = NaN } else { ${l} = -Infinity; ${h} = Infinity } } else { p = ${L(x)} / a; q = ${L(x)} / b; s = ${H(x)} / a; t = ${H(x)} / b; ${h} = Math.max(p, q, s, t); ${l} = Math.min(p, q, s, t) }`
        )
        break
      }
      default:
        assertUnreachable(operation)
    }
  })
  const roots = nodes.map((node) => index.get(node)!)
  const body = `let r, a, b, p, q, s, t;\n${lines.join('\n')}\nreturn [${roots.map((i) => `{ min: L[${i}], max: H[${i}] }`).join(', ')}]`
  // (compiled like the kernel: from the formula's own nodes)
  const run = new Function('reads', 'L', 'H', 'C', 'RES', body) as (
    reads: DynMinMax,
    L: Float64Array,
    H: Float64Array,
    C: number[],
    RES: (x: number[]) => number
  ) => MinMax[]
  const lo = new Float64Array(order.length),
    hi = new Float64Array(order.length)
  return (reads) => run(reads, lo, hi, consts, allOperations.res)
}
/** The range of node `f`, given its operands' ranges */
function nodeRange(f: OptNode, operands: MinMax[], reads: DynMinMax): MinMax {
  const { operation } = f
  let current: MinMax
  switch (operation) {
    case 'read':
      if (f.path[0] !== 'dyn')
        throw new Error(`Found non-dyn path ${f.path} while computing range`)
      current = reads[f.path[1]] ?? { min: 0, max: 0 }
      break
    case 'const':
      current = computeMinMax([f.value])
      break
    case 'add':
    case 'min':
    case 'max':
      current = {
        min: allOperations[operation](operands.map((x) => x.min)),
        max: allOperations[operation](operands.map((x) => x.max)),
      }
      break
    case 'res':
      current = {
        min: allOperations[operation]([operands[0].max]),
        max: allOperations[operation]([operands[0].min]),
      }
      break
    case 'mul':
      current = operands.reduce((accu, current) =>
        computeMinMax([
          accu.min * current.min,
          accu.min * current.max,
          accu.max * current.min,
          accu.max * current.max,
        ])
      )
      break
    case 'threshold':
      if (operands[0].min >= operands[1].max) current = operands[2]
      else if (operands[0].max < operands[1].min) current = operands[3]
      else current = computeMinMax([], [operands[2], operands[3]])
      break
    case 'sum_frac': {
      const [x, c] = operands,
        sum = { min: x.min + c.min, max: x.max + c.max }
      if (sum.min <= 0 && sum.max >= 0)
        current =
          x.min <= 0 && x.max >= 0
            ? { min: Number.NaN, max: Number.NaN }
            : {
                min: Number.NEGATIVE_INFINITY,
                max: Number.POSITIVE_INFINITY,
              }
      // TODO: Check this
      else
        current = computeMinMax([
          x.min / sum.min,
          x.min / sum.max,
          x.max / sum.min,
          x.max / sum.max,
        ])
      break
    }
    default:
      assertUnreachable(operation)
  }
  return current
}
/**
 * The values of affine `nodes` (reads, constants, sums and products) for one artifact's stats,
 * exactly as `constantFold` computes them (the same operations, in the same order); a missing
 * stat counts as its read's empty accumulation (0 for a sum). The nodes are walked once.
 */
function affineEvaluator(nodes: OptNode[]): (stat: DynStat) => number[] {
  const order: OptNode[] = []
  const index = new Map<OptNode, number>()
  forEachNodes(
    nodes,
    (_) => {},
    (f) => {
      if (index.has(f)) return
      index.set(f, order.length)
      order.push(f)
    }
  )
  const operands = order.map((f) => f.operands.map((op) => index.get(op)!))
  const roots = nodes.map((node) => index.get(node)!)
  return (stat) => {
    const values: number[] = new Array(order.length)
    for (let i = 0; i < order.length; i++) {
      const f = order[i]
      switch (f.operation) {
        case 'const':
          values[i] = f.value
          break
        case 'read': {
          const key = f.path[1]
          // biome-ignore lint/suspicious/noPrototypeBuiltins: `Object.hasOwn` is not in this lib target
          const own = Object.prototype.hasOwnProperty.call(stat, key)
          values[i] =
            f.path[0] === 'dyn' && own
              ? stat[key]
              : f.accu === undefined
                ? Number.NaN
                : allOperations[f.accu]([])
          break
        }
        case 'add':
        case 'mul':
          values[i] = allOperations[f.operation](
            operands[i].map((j) => values[j])
          )
          break
        default:
          throw new Error(`Unexpected ${f.operation} node in an affine one`)
      }
    }
    return roots.map((i) => values[i])
  }
}
function computeMinMax(
  values: readonly number[],
  minMaxes: readonly MinMax[] = []
): MinMax {
  const max = Math.max(...values, ...minMaxes.map((x) => x.max))
  const min = Math.min(...values, ...minMaxes.map((x) => x.min))
  return { min, max }
}

export function filterArts(
  arts: ArtifactsBySlot,
  filters: RequestFilter
): ArtifactsBySlot {
  return {
    base: arts.base,
    values: objKeyMap(allArtifactSlotKeys, (slot) => {
      const filter = filters[slot]
      switch (filter.kind) {
        case 'id':
          return arts.values[slot].filter((art) => filter.ids.has(art.id))
        case 'exclude':
          return arts.values[slot].filter((art) => !filter.sets.has(art.set!))
        case 'required':
          return arts.values[slot].filter((art) => filter.sets.has(art.set!))
      }
    }),
  }
}

export function mergeBuilds(
  builds: SolverBuild[][],
  maxNum: number
): SolverBuild[] {
  return builds
    .flat()
    .sort((a, b) => b.value - a.value)
    .slice(0, maxNum)
}
/**
 * Keep the best build per plot bin, using at most `maxCount` bins.
 *
 * Bins are `[k * scale, (k + 1) * scale)` with `scale = minScale * 2^j`. Coarser bins are
 * computed from the finest integer keys by integer division, so every bin at a coarser scale
 * is an exact union of finer bins. This makes merging pre-binned data (one best build per
 * fine bin, as produced by the workers) exact.
 */
export function mergePlot(
  plots: PlotData[],
  minScale = 0.01,
  maxCount = 1500
): PlotData {
  const entries: { key: number; build: SolverBuild }[] = []
  for (const plot of plots)
    for (const build of Object.values(plot)) {
      if (!build) continue
      const key = Math.floor(build.plot! / minScale)
      if (Number.isFinite(key)) entries.push({ key, build })
    }
  let divisor = 1,
    keys = new Set(entries.map(({ key }) => key))
  while (keys.size > maxCount) {
    divisor *= 2
    keys = new Set([...keys].map((key) => Math.floor(key / 2)))
  }
  const scale = minScale * divisor
  const result: PlotData = {}
  for (const { key, build } of entries) {
    const x = Math.floor(key / divisor) * scale
    if (!result[x] || result[x]!.value < build.value) result[x] = build
  }
  return result
}

export function countBuilds(arts: ArtifactsBySlot): number {
  return allArtifactSlotKeys.reduce(
    (_count, slot) => _count * arts.values[slot].length,
    1
  )
}

export function* filterFeasiblePerm(
  filters: Iterable<RequestFilter>,
  _artSets: ArtifactsBySlot
): Iterable<RequestFilter> {
  const artSets = objMap(
    _artSets.values,
    (values) => new Set(values.map((v) => v.set))
  )
  filter_loop: for (const filter of filters) {
    for (const [slot, f] of Object.entries(filter)) {
      const available = artSets[slot]!
      switch (f.kind) {
        case 'required':
          if ([...f.sets].every((s) => !available.has(s))) continue filter_loop
          break
        case 'exclude':
          if ([...available].every((s) => f.sets.has(s!))) continue filter_loop
          break
        case 'id':
          break
      }
    }
    yield filter
  }
}
export function exclusionToAllowed(
  exclusion: number[] | undefined
): Set<number> {
  return new Set(
    exclusion?.includes(2)
      ? exclusion.includes(4)
        ? [0, 1]
        : [0, 1, 4, 5]
      : exclusion?.includes(4)
        ? [0, 1, 2, 3]
        : [0, 1, 2, 3, 4, 5]
  )
}
/**
 * A *disjoint* set of `RequestFilter` satisfying the exclusion rules.
 *
 * With `available` (the sets each slot has artifacts of), branches that would put a set in a
 * slot without artifacts of it are cut as they are generated: the result is that of
 * `filterFeasiblePerm` on the full set, without enumerating (and dropping) the rest, which can
 * be millions of filters when many sets are limited to one piece.
 */
export function* artSetPerm(
  exclusion: ArtSetExclusion,
  artSets: Set<ArtifactSetKey>,
  available?: Partial<Record<ArtifactSlotKey, Set<ArtifactSetKey | undefined>>>
): Iterable<RequestFilter> {
  /**
   * This generation algorithm is separated into two parts:
   * - "Shape" generation
   *   - It first generates all build "shapes", e.g., AABBC, ABBCD
   *   - It then filters the generated shapes according to the rainbow exclusion, e.g., removes ABBCD if excluding 3 rainbows
   *   - It then merges the remaining shapes into wildcards, e.g. AABAA + AABAB + AABAC => AABA*
   * - Shape filling
   *   - From the given shapes, it tries to fill in all non-rainbow slots, e.g., slots A and B of AABBC, with actual artifacts
   *   - It then fills the rainbow slots, e.g., slot C of AABBC while ensuring the exclusion rule of each sets
   */
  const allowedRainbows = exclusionToAllowed(exclusion.rainbow)
  let shapes: number[][] = []
  function populateShapes(
    current: number[],
    list: Set<number>,
    rainbows: number[]
  ) {
    if (current.length === 5) {
      if (allowedRainbows.has(rainbows.length)) shapes.push(current)
      return
    }
    for (const i of list)
      populateShapes(
        [...current, i],
        list,
        rainbows.filter((j) => j !== i)
      )
    populateShapes(
      [...current, current.length],
      new Set([...list, current.length]),
      [...rainbows, current.length]
    )
  }
  populateShapes([0], new Set([0]), [0])
  function indexOfShape(shape: number[], replacing: number) {
    if (range(replacing + 1, 4).some((i) => shape[i] !== 5)) return undefined
    shape = [...shape]
    shape[replacing] = 5
    return shape.reduce((a, b) => a * 6 + b, 0)
  }
  for (let replacing = 4; replacing >= 0; replacing--) {
    const required: Map<number, number> = new Map()
    for (const shape of shapes) {
      const id = indexOfShape(shape, replacing)
      if (id === undefined) continue
      required.set(
        id,
        (required.get(id) ?? new Set(shape.slice(0, replacing)).size + 1) - 1
      )
    }
    for (const [id, remaining] of required.entries()) {
      if (remaining === 0) {
        const shape = [
          ...shapes.find((shape) => indexOfShape(shape, replacing) === id)!,
        ]
        shape[replacing] = 5
        shapes = shapes.filter((shape) => indexOfShape(shape, replacing) !== id)
        shapes.push(shape)
      }
    }
  }

  // Shapes are now calculated and merged, proceed to fill in the sets

  const noFilter = { kind: 'exclude' as const, sets: new Set<ArtifactSetKey>() }
  const result: RequestFilter = objKeyMap(allArtifactSlotKeys, (_) => noFilter)

  const counts = {
    ...objMap(exclusion as Record<ArtSetExclusionKey, (2 | 4)[]>, (_) => 0),
    ...objKeyMap([...artSets], () => 0),
  }
  const allowedCounts = objMap(
    exclusion as Record<ArtSetExclusionKey, (2 | 4)[]>,
    exclusionToAllowed
  )
  // Allowed piece counts as bit masks (bit `n`: `n` pieces allowed), for the sets with a rule
  const ruled = [...artSets].filter(
    (set) => allowedCounts[set as ArtSetExclusionKey]
  )
  const allowedMask: Partial<Record<ArtifactSetKey, number>> = {}
  for (const set of ruled)
    allowedMask[set] = [...allowedCounts[set as ArtSetExclusionKey]!].reduce(
      (mask, n) => mask | (1 << n),
      0
    )
  // One (immutable) filter object per set and per excluded list, shared by every yielded filter:
  // there can be millions of them, and consumers dedupe slot filters by identity.
  const requiredOf: Partial<
    Record<ArtifactSetKey, { kind: 'required'; sets: Set<ArtifactSetKey> }>
  > = {}
  const required1 = (set: ArtifactSetKey) =>
    (requiredOf[set] ??= { kind: 'required', sets: new Set([set]) })
  const excludeOf = new Map<
    string,
    { kind: 'exclude'; sets: Set<ArtifactSetKey> }
  >()
  const excludeFilter = (sets: Set<ArtifactSetKey>) => {
    const key = [...sets].sort().join(',')
    let f = excludeOf.get(key)
    if (!f) excludeOf.set(key, (f = { kind: 'exclude', sets }))
    return f
  }
  /** Whether every slot (index) of `slots` has artifacts of `set` */
  const fits = (slots: number[], set: ArtifactSetKey) =>
    !available ||
    slots.every((j) => available[allArtifactSlotKeys[j]]?.has(set) ?? false)

  function* check(shape: number[]) {
    const used: Set<ArtifactSetKey> = new Set(),
      rainbows: number[] = []
    let groupped: number[][] = []
    for (const i of shape) {
      groupped.push([])
      if (i === 5) rainbows.push(groupped.length - 1)
      else groupped[i].push(groupped.length - 1)
    }
    groupped = groupped
      .filter((v) => v.length)
      .sort((a, b) => b.length - a.length)
    let usableRainbows = rainbows.length

    // Inception.. because js doesn't like functions inside a for-loop
    function* check(i: number): IterableIterator<RequestFilter> {
      if (i === groupped.length) return yield* check_free(0)

      for (const set of artSets) {
        if (used.has(set)) continue
        if (!fits(groupped[i], set)) continue
        const length = groupped[i].length,
          allowedSet = allowedCounts[set as ArtSetExclusionKey]
        let requiredRainbows = 0

        if (allowedSet && !allowedSet.has(length)) {
          // Look ahead and see if we have enough rainbows to fill to the next `allowedSet` if we use the current set
          requiredRainbows =
            (range(length + 1, 5).find((l) => allowedSet.has(l)) ?? 6) - length
          if (requiredRainbows > usableRainbows) continue // Not enough rainbows. Next..
        }

        used.add(set)
        counts[set] = groupped[i].length
        groupped[i].forEach(
          (j) => (result[allArtifactSlotKeys[j]] = required1(set))
        )
        usableRainbows -= requiredRainbows

        yield* check(i + 1)

        usableRainbows += requiredRainbows
        counts[set] = 0
        used.delete(set)
      }
    }
    // We separate filling rainbow slots from groupped slots because it has an entirely
    // different set of rules regarding what can be filled and what states to be kept.
    function* check_free(i: number): IterableIterator<RequestFilter> {
      const remaining = rainbows.length - i,
        isolated: ArtifactSetKey[] = [],
        missing: ArtifactSetKey[] = [],
        rejected: ArtifactSetKey[] = []
      let required = 0
      for (const set of ruled) {
        const mask = allowedMask[set]!,
          count = counts[set]
        // no allowed count within count+1..count+remaining
        if (((mask >> (count + 1)) & ((1 << remaining) - 1)) === 0)
          rejected.push(set)
        else if (!(mask & (1 << count))) {
          let next = count + 1
          while (!(mask & (1 << next))) next++
          required += next - count
          missing.push(set)
          // some count within count..count+remaining not allowed
        } else if ((~mask >> count) & ((1 << (remaining + 1)) - 1))
          isolated.push(set)
      }
      if (required > remaining) return
      if (i === rainbows.length) {
        yield { ...result }
        return
      }
      const slot = [rainbows[i]]
      if (required === remaining) {
        for (const set of missing) {
          if (!fits(slot, set)) continue
          counts[set]++
          result[allArtifactSlotKeys[rainbows[i]]] = required1(set)
          yield* check_free(i + 1)
          counts[set]--
        }
        return
      }
      for (const set of [...isolated, ...missing]) {
        if (!fits(slot, set)) continue
        counts[set]++
        result[allArtifactSlotKeys[rainbows[i]]] = required1(set)
        yield* check_free(i + 1)
        counts[set]--
      }
      const excluded = new Set([...missing, ...rejected, ...isolated])
      // some set the slot has must be left
      if (
        available &&
        [...(available[allArtifactSlotKeys[rainbows[i]]] ?? [])].every((set) =>
          excluded.has(set!)
        )
      )
        return
      result[allArtifactSlotKeys[rainbows[i]]] = excludeFilter(excluded)
      yield* check_free(i + 1)
    }
    yield* check(0)
  }
  for (const shape of shapes) yield* check(shape)
}

export type RequestFilter = Record<
  ArtifactSlotKey,
  | { kind: 'required'; sets: Set<ArtifactSetKey> }
  | { kind: 'exclude'; sets: Set<ArtifactSetKey> }
  | { kind: 'id'; ids: Set<string> }
>

export type DynStat = { [key in string]: number }
export type ArtifactBuildData = {
  id: string
  set?: ArtifactSetKey
  values: DynStat
}
export type ArtifactsBySlot = {
  base: DynStat
  values: Record<ArtifactSlotKey, ArtifactBuildData[]>
}

export type PlotData = Partial<Record<number, SolverBuild>>
export interface SolverBuild {
  value: number
  plot?: number
  artifactIds: string[]
}

export type DynMinMax = { [key in string]: MinMax }
export type MinMax = { min: number; max: number }
