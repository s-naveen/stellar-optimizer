import type { OptNode } from './optimization'
import {
  assignReads,
  constantFold,
  constantFolder,
  optimizeFolded,
  precompute,
} from './optimization'
import type { Data, NumNode, ReadNode, StrNode } from './type'
import {
  constant,
  customRead,
  customStringRead,
  equal,
  lookup,
  prod,
  resetData,
  stringPrio,
  subscript,
  sum,
  threshold,
} from './utils'

/** A string with a branch per state, chosen by a numeric read (0: none) */
function switched(key: string, states: string[]): StrNode {
  const read = customRead(['dyn', key])
  let node: StrNode = constant(undefined)
  states.forEach((state, i) => {
    node = threshold(read, i + 1, constant(state), node)
  })
  return node
}
const keep = (r: ReadNode<number | string | undefined>) => r.path[0] !== 'dyn'
const value = (values: Record<string, number>) => (read: ReadNode<number>) =>
  read.path[1].startsWith('sw') ? values[read.path[1]] : undefined
const run = (nodes: OptNode[], values: Record<string, number> = {}) =>
  precompute(nodes, {}, (r) => r.path[1], 1)([{ values }])

describe('formulas folded once for several states', () => {
  const stat = customRead(['dyn', 'atk'])
  // a conditional read by a match, a lookup and a priority of strings, as sheets do
  const cond = customStringRead(['conditional', 'Sheet', 'buff'])
  const other = customStringRead(['conditional', 'Sheet', 'other'])
  const formula = sum(
    prod(stat, equal(cond, 'on', 2, 1)),
    lookup(cond, { on: constant(10), half: constant(5) }, constant(0)),
    equal(stringPrio(other, cond), 'x', 100, 0),
    subscript(
      lookup(cond, { on: constant(1), half: constant(2) }, constant(0)),
      [7, 8, 9]
    )
  )
  const dataFor = (state: string | undefined, o?: string): Data =>
    ({
      conditional: {
        Sheet: {
          ...(state === undefined ? {} : { buff: constant(state) }),
          ...(o === undefined ? {} : { other: constant(o) }),
        },
      },
    }) as Data
  const shared: Data = {
    conditional: {
      Sheet: {
        buff: switched('swBuff', ['on', 'half']),
        other: switched('swOther', ['x']),
      },
    },
  } as Data
  const cases: [string | undefined, string | undefined][] = [
    [undefined, undefined],
    ['on', undefined],
    ['half', undefined],
    [undefined, 'x'],
    ['on', 'x'],
    ['half', 'x'],
  ]

  test('each state taken from the shared fold equals its own fold', () => {
    const fold = constantFolder(keep)
    const holds = new WeakMap<OptNode, boolean>()
    const folded = fold([resetData(formula, shared)], {})
    for (const [state, o] of cases) {
      const own = constantFold(
        [resetData(formula, dataFor(state, o))],
        {},
        keep
      )
      const taken = optimizeFolded(
        assignReads(
          folded,
          value({
            swBuff: ['on', 'half'].indexOf(state as string) + 1,
            swOther: o === 'x' ? 1 : 0,
          }),
          holds
        )
      )
      // (no switch is left, and the numbers are the same)
      const reads: string[] = []
      const visit = (n: OptNode) => {
        if (n.operation === 'read') reads.push(n.path[1])
        n.operands.forEach(visit)
      }
      taken.forEach(visit)
      expect(reads.filter((r) => r.startsWith('sw'))).toEqual([])
      for (const atk of [0, 3, 250.5])
        expect(run(taken, { atk })).toEqual(run(own, { atk }))
    }
  })

  test('a folder gives the same node for a formula folded again in the same data', () => {
    const fold = constantFolder(keep)
    const node = resetData(prod(stat, equal(cond, 'on', 2, 1)), shared)
    const [first] = fold([node], {})
    const [again] = fold([node], {})
    expect(again).toBe(first)
    // (as `constantFold` folds it)
    expect(first).toEqual(constantFold([node as NumNode], {}, keep)[0])
  })

  test('parts without a switch are returned as they are', () => {
    const plain = prod(stat, 3) as OptNode
    const withSwitch = threshold(
      customRead(['dyn', 'swA']),
      1,
      plain,
      constant(0)
    ) as OptNode
    const holds = new WeakMap<OptNode, boolean>()
    expect(assignReads([plain], value({ swA: 1 }), holds)[0]).toBe(plain)
    // (the branch taken is the very node, the other one is not visited)
    expect(assignReads([withSwitch], value({ swA: 1 }), holds)[0]).toBe(plain)
    expect(assignReads([withSwitch], value({ swA: 0 }), holds)[0]).toEqual(
      constant(0)
    )
  })
})
