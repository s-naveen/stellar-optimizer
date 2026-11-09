import { cartesian, objKeyMap } from '@genshin-optimizer/common/util'
import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import {
  dynRead,
  precompute,
  prod,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'
import type { ArtifactBuildData, ArtifactsBySlot } from './common'
import {
  artSetPerm,
  exclusionToAllowed,
  filterFeasiblePerm,
  pruneAll,
} from './common'

function* allCombinations(
  sets: Record<ArtifactSlotKey, Iterable<ArtifactSetKey>>
): Iterable<Record<ArtifactSlotKey, ArtifactSetKey>> {
  for (const flower of sets.flower)
    for (const circlet of sets.circlet)
      for (const goblet of sets.goblet)
        for (const plume of sets.plume)
          for (const sands of sets.sands)
            yield { flower, circlet, goblet, plume, sands }
}

describe('common.ts', () => {
  describe('artSetPerm should handle', () => {
    const filter: ArtSetExclusion = {
      Adventurer: [2, 4],
      ArchaicPetra: [4],
      Berserker: [2, 4],
      rainbow: [2, 4],
    }
    const artSets: Set<ArtifactSetKey> = new Set([
      'Adventurer',
      'ArchaicPetra',
      'Berserker',
      'BloodstainedChivalry',
    ])
    const perm = [...artSetPerm(filter, artSets)],
      allowedRainbows = exclusionToAllowed(filter.rainbow)

    for (const combination of allCombinations(
      objKeyMap(allArtifactSlotKeys, (_) => artSets)
    )) {
      let shouldMatch = true,
        rainbowCount = 0
      for (const key of new Set([
        ...Object.keys(filter),
        ...Object.values(combination),
      ])) {
        const allowed = exclusionToAllowed(filter[key as keyof typeof filter])
        const count = Object.values(combination).filter((x) => x === key).length
        if (count === 1) rainbowCount++
        if (!allowed.has(count)) shouldMatch = false
      }
      if (!allowedRainbows.has(rainbowCount)) shouldMatch = false
      const matchCount = perm.filter((filters) =>
        allArtifactSlotKeys.every((slot) => {
          const art = combination[slot]
          const filter = filters[slot]
          switch (filter.kind) {
            case 'id':
              throw new Error('ID filter in artSetPerm')
            case 'required':
              return filter.sets.has(art)
            case 'exclude':
              return !filter.sets.has(art)
          }
        })
      ).length

      test(`Set ${Object.values(combination)}`, () => {
        expect(matchCount).toEqual(shouldMatch ? 1 : 0)
      })
    }
  })

  function testFormulasEqual(
    f1: { nodes: OptNode[]; arts: ArtifactsBySlot },
    f2: { nodes: OptNode[]; arts: ArtifactsBySlot }
  ) {
    const compute1 = precompute(f1.nodes, f1.arts.base, (f) => f.path[1], 5)
    const compute2 = precompute(f2.nodes, f2.arts.base, (f) => f.path[1], 5)
    const truth = cartesian(
      ...allArtifactSlotKeys.map((slot) => f1.arts.values[slot])
    ).map((aa) => compute1(aa as any))
    const test = cartesian(
      ...allArtifactSlotKeys.map((slot) => f2.arts.values[slot])
    ).map((aa) => compute2(aa as any))

    truth.forEach((trut, i) =>
      trut.forEach((tru, j) => expect(tru).toBeCloseTo(test[i][j]))
    )
  }

  describe('reaffine', () => {
    const arts: ArtifactsBySlot = {
      base: { atk: 10, atk_: 0.01, glad: 0, clam: 0 },
      values: objKeyMap(
        allArtifactSlotKeys,
        () =>
          [
            { id: '', values: { atk: 1, glad: 1 } },
            { id: '', values: { atk_: 1, clam: 1 } },
          ] as ArtifactBuildData[]
      ),
    }
    test('basic', () => {
      const node = sum(1, dynRead('atk'), prod(1500, dynRead('atk_')))
      const z = pruneAll(
        [node],
        [Number.NEGATIVE_INFINITY],
        arts,
        5,
        {},
        { reaffine: true }
      )

      expect(z.nodes[0].operation).toEqual('read')
      expect(Object.keys(z.arts.base).length).toEqual(1)

      testFormulasEqual({ nodes: [node], arts }, z)
    })
    test('partial', () => {
      const node = sum(
        1,
        dynRead('atk'),
        prod(1500, dynRead('atk_')),
        threshold(dynRead('glad'), 2, 0.18, 0)
      )
      const z = pruneAll(
        [node],
        [Number.NEGATIVE_INFINITY],
        arts,
        5,
        {},
        { reaffine: true }
      )

      expect(Object.keys(z.arts.base).length).toEqual(2)
      testFormulasEqual({ nodes: [node], arts }, z)
    })
  })
})

describe('artSetPerm with slot availability', () => {
  const pool: ArtifactSetKey[] = [
    'Adventurer',
    'ArchaicPetra',
    'Berserker',
    'BloodstainedChivalry',
    'BraveHeart',
    'CrimsonWitchOfFlames',
  ]
  const show = (
    filters: Iterable<
      ReturnType<typeof artSetPerm> extends Iterable<infer F> ? F : never
    >
  ) =>
    [...filters].map((filter) =>
      allArtifactSlotKeys
        .map((slot) => {
          const f = filter[slot]
          return f.kind === 'id'
            ? 'id'
            : `${f.kind}:${[...f.sets].sort().join('+')}`
        })
        .join('|')
    )
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let trial = 0; trial < 60; trial++) {
    const exclusion: ArtSetExclusion = {}
    for (const set of pool) {
      const r = random()
      if (r < 0.35) exclusion[set as keyof ArtSetExclusion] = [2, 4]
      else if (r < 0.5) exclusion[set as keyof ArtSetExclusion] = [4]
      else if (r < 0.6) exclusion[set as keyof ArtSetExclusion] = [2]
    }
    const r = random()
    if (r < 0.3) exclusion.rainbow = [2, 4]
    else if (r < 0.45) exclusion.rainbow = [4]
    const artSets = new Set(pool.filter(() => random() < 0.85))
    // each slot has a random part of the sets
    const available = objKeyMap(
      allArtifactSlotKeys,
      () => new Set([...artSets].filter(() => random() < 0.6))
    )
    const arts = {
      base: {},
      values: objKeyMap(allArtifactSlotKeys, (slot) =>
        [...available[slot]].map((set, i) => ({
          id: `${slot}${i}`,
          set,
          values: {},
        }))
      ),
    }
    test(`trial ${trial}`, () => {
      const pruned = show(artSetPerm(exclusion, artSets, available))
      const full = show(
        filterFeasiblePerm(artSetPerm(exclusion, artSets), arts)
      )
      expect(pruned).toEqual(full)
    })
  }
})
