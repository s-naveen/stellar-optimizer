import { objPathValue } from '@genshin-optimizer/common/util'
import type { OptConfig } from '@genshin-optimizer/gi/db'
import type { Data, NumNode } from '@genshin-optimizer/gi/wr'
import { resolveInfo } from '../util'
// Put in gi/ui due to dependency on `resolveInfo`
export function statFilterToNumNode(
  workerData: Data,
  statFilters: OptConfig['statFilters']
): Array<{ value: NumNode; minimum: number; path: string[] }> {
  return Object.entries(statFilters)
    .flatMap(([pathStr, settings]) =>
      settings
        .filter((setting) => !setting.disabled)
        .map((setting) => {
          // (the stat's path in the character's data: what names it)
          const path = JSON.parse(pathStr) as string[]
          const filterNode: NumNode = objPathValue(
            workerData.display ?? {},
            path
          )
          const infoResolved = filterNode?.info && resolveInfo(filterNode.info)
          const minimum =
            infoResolved?.unit === '%' ? setting.value / 100 : setting.value // TODO: Conversion
          return { value: filterNode, minimum: minimum, path }
        })
    )
    .filter((x) => x.value && x.minimum > Number.NEGATIVE_INFINITY)
}
