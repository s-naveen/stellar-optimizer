import { describe, expect, it } from 'vitest'
import type { OptNode } from './optimization'
import { mergeIdentical, precompute, precomputeSource } from './optimization'

const read = (key: string): OptNode =>
  ({
    operation: 'read',
    operands: [],
    path: ['dyn', key],
    type: 'number',
  }) as any
const c = (value: number): OptNode =>
  ({ operation: 'const', operands: [], value, type: 'number' }) as any
const op = (operation: string, ...operands: OptNode[]): OptNode =>
  ({ operation, operands }) as any

describe('mergeIdentical', () => {
  // two batches optimized apart: their reads and shared parts are separate nodes
  const batch = () => {
    const atk = op('add', c(100), op('mul', c(100), read('atk_')), read('atk'))
    const crit = op('add', c(1), op('mul', read('critRate_'), read('critDMG_')))
    return { atk, crit, hit: op('mul', atk, crit, c(2.5)) }
  }
  const a = batch(),
    b = batch()
  const formulas = [
    a.hit,
    op('mul', b.atk, b.crit, c(3)),
    op('threshold', read('enerRech_'), c(1.3), b.hit, c(0)),
    op('max', op('res', read('x')), op('sum_frac', read('eleMas'), c(1400))),
    op('mul', b.crit, b.atk, c(3)), // same parts, other order: not merged
  ]
  const binding = (r: any) => r.path[1]

  it('shares identical parts, never reordering operands', () => {
    const merged = mergeIdentical(formulas)
    const count = (fs: OptNode[]) =>
      precomputeSource(fs, {}, binding, 1).split('\n').length
    expect(count(merged)).toBeLessThan(count(formulas))
    expect(merged[0].operands[0]).toBe(merged[1].operands[0]) // a.atk and b.atk merged
    expect(merged[1]).not.toBe(merged[4]) // a*b*3 and b*a*3 kept apart
    expect(
      precomputeSource(merged, {}, binding, 1).match(/values\["atk_"\]/g)
    ).toHaveLength(1)
  })
  it('gives the same values bit for bit', () => {
    const f = precompute(formulas, {}, binding, 1)
    const g = precompute(mergeIdentical(formulas), {}, binding, 1)
    for (let i = 0; i < 200; i++) {
      const values = Object.fromEntries(
        [
          'atk_',
          'atk',
          'critRate_',
          'critDMG_',
          'enerRech_',
          'x',
          'eleMas',
        ].map((k) => [k, (Math.random() - 0.2) * 3])
      )
      expect(g([{ values }])).toEqual(f([{ values }]))
    }
  })
})
