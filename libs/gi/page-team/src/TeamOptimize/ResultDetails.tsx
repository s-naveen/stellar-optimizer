import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { TeamOptHit, TeamOptResult } from '@genshin-optimizer/gi/ui'
import {
  DataContext,
  FieldDisplayList,
  NodeFieldDisplay,
  teamOptBonusStats,
  teamOptMembers,
  teamOptResultGear,
  teamOptUIData,
  teamRotationHits,
} from '@genshin-optimizer/gi/ui'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { Box, ListItem, Skeleton, Typography } from '@mui/material'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatHits, formatRate } from './format'
import { numSx, type } from './ui'

/** Each member's final stats and attacks with the result, and with what is equipped now */
export interface ResultDetailsData {
  /** Per member: its Basic Stats (as on its page) with the result */
  after: Partial<Record<CharacterKey, [string, CalcResult][]>>
  /** ...and with what is equipped now */
  now: Partial<Record<CharacterKey, Partial<Record<string, CalcResult>>>>
  /** Per member: its data with the result (where the formulas' values come from) */
  data: Partial<Record<CharacterKey, UIData>>
  /** Per member and attack: its hits with the result, run by run, each with its formula */
  hits: Partial<Record<CharacterKey, TeamOptHit[][]>>
  /** ...and with what is equipped now */
  nowHits: Partial<Record<CharacterKey, TeamOptHit[][]>>
}

/** A member's Basic Stats, as its page lists them (HP, ATK, ..., its element's DMG Bonus) */
export function basicStats(data: UIData): [string, CalcResult][] {
  // only the `basic` part of `getDisplay()`: the talents' damage is not needed here
  const nodes = new Map<string, NumNode>()
  for (const d of data.data) {
    const basic = (d as { display?: { basic?: Record<string, NumNode> } })
      .display?.basic
    for (const [key, node] of Object.entries(basic ?? {}))
      if (node?.operation) nodes.set(key, node)
  }
  return [...nodes].map(([key, node]) => [key, data.get(node)])
}

/** An attack's damage per rotation: each run's hits times one of its hits */
const attackTotal = (runs: readonly TeamOptHit[] | undefined) =>
  runs?.reduce((total, run) => total + run.hits * (run.hit?.value ?? 0), 0)

const cache = new WeakMap<TeamOptResult, Map<string, ResultDetailsData>>()

/**
 * What the expanded result cards show, computed once they are opened (in the background) and
 * kept per result; `version` (e.g. after equipping the result) computes "now" again.
 */
export function useResultDetails(
  teamId: string,
  teamOpt: TeamOpt,
  result: TeamOptResult,
  open: boolean,
  version: unknown
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const key = JSON.stringify([gender, version])
  const [details, setDetails] = useState(() => cache.get(result)?.get(key))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `gender` and `version`
  useEffect(() => {
    if (!open) return undefined
    const cached = cache.get(result)?.get(key)
    if (cached) {
      setDetails(cached)
      return undefined
    }
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const gear = teamOptResultGear(database, teamId, result)
      const rotation = {
        attacks: teamOpt.attacks,
        mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
        onField: teamOpt.onField,
        bonusStats: teamOptBonusStats(teamOpt, keys),
      }
      const after = teamOptUIData(database, teamId, gender, teamOpt, result)
      const now = teamOptUIData(database, teamId, gender, teamOpt)
      const value: ResultDetailsData = {
        after: {},
        now: {},
        data: after ?? {},
        hits:
          teamRotationHits(database, teamId, gender, {
            ...rotation,
            ...gear,
          }) ?? {},
        nowHits: teamRotationHits(database, teamId, gender, rotation) ?? {},
      }
      for (const characterKey of keys) {
        const a = after?.[characterKey]
        const n = now?.[characterKey]
        if (a) value.after[characterKey] = basicStats(a)
        if (n) value.now[characterKey] = Object.fromEntries(basicStats(n))
      }
      const perResult = cache.get(result) ?? new Map()
      perResult.set(key, value)
      cache.set(result, perResult)
      setDetails(value)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, database, teamId, teamOpt, result, key])
  return open ? details : undefined
}

/** A section's label in an expanded card (sentence case, as every label) */
const labelSx = { ...type.label, display: 'block', fontWeight: 600 } as const

/** The stat and damage rows: the character page's, a little denser */
export const listSx = {
  m: 0,
  '& .MuiListItem-root': { px: 1, py: 0.25 },
  '& .MuiTypography-root': { fontSize: '0.8125rem' },
} as const

/**
 * A member's final stats with the result and the damage of each of its attacks, as its page
 * shows them: every value with its formula (the ? on each row), against what is equipped now.
 * An attack's hits that get different buffs (a buff for its first hits only) are listed apart.
 * Memoized: its card re-renders on a toggle's press, these rows need not.
 */
export const MemberDetails = memo(function MemberDetails({
  characterKey,
  details,
  teamOpt,
  rotationTime,
  compare = false,
}: {
  characterKey: CharacterKey
  details: ResultDetailsData | undefined
  teamOpt: TeamOpt
  rotationTime?: number
  /** Changes against the equipped build are shown */
  compare?: boolean
}) {
  const { t } = useTranslation('page_team')
  const data = details?.data[characterKey]
  const stats = details?.after[characterKey]
  const now = compare ? details?.now[characterKey] : undefined
  const attacks = teamOpt.attacks[characterKey] ?? []
  const hits = details?.hits[characterKey]
  const nowHits = compare ? details?.nowHits[characterKey] : undefined
  // the rows' formulas are this member's
  const context = useMemo(() => data && { data, teamData: {} as never }, [data])
  if (!details)
    return (
      <Box
        aria-busy
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
      >
        <Skeleton variant="text" width={72} sx={{ fontSize: 12.5 }} />
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
          <Skeleton key={i} variant="rounded" height={22} />
        ))}
      </Box>
    )
  if (!context) return null
  return (
    <DataContext.Provider value={context}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 1,
              mb: 0.75,
            }}
          >
            <Typography component="span" sx={labelSx}>
              {t('teamOpt.result.stats', 'Final stats')}
            </Typography>
            {compare && (
              <Typography sx={{ ...type.label, fontWeight: 400 }}>
                {t('teamOpt.result.vsNow', 'change vs equipped now')}
              </Typography>
            )}
          </Box>
          <FieldDisplayList sx={listSx}>
            {stats?.map(([key, calc]) => (
              <NodeFieldDisplay
                key={key}
                calcRes={calc}
                compareCalcRes={now?.[key]}
                component={ListItem}
                // as on the character's page: these are listed at 0 too
                showZero={
                  key === 'eleMas' || key.endsWith('dmg_') || key === 'heal_'
                }
              />
            ))}
          </FieldDisplayList>
        </Box>
        <Box>
          <Typography component="span" sx={{ ...labelSx, mb: 0.75 }}>
            {t('teamOpt.result.hitsTitle', 'Damage per hit, in the rotation')}
          </Typography>
          {!attacks.length ? (
            <Typography sx={{ ...type.label, fontWeight: 400 }}>
              {t('teamOpt.result.noAttacks', 'No attacks in the rotation.')}
            </Typography>
          ) : (
            <FieldDisplayList sx={listSx}>
              {attacks.map((attack, i) => {
                const runs = hits?.[i] ?? []
                const total = attackTotal(runs) ?? 0
                const before = attackTotal(nowHits?.[i])
                const change =
                  before !== undefined && before > 0
                    ? total / before - 1
                    : undefined
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the rotation's attacks, in order
                  <ListItem key={i} sx={{ display: 'block' }}>
                    {runs.map((run, r) => (
                      <Box
                        // biome-ignore lint/suspicious/noArrayIndexKey: an attack's runs, in order
                        key={r}
                        sx={{ '& > *': { py: 0 } }}
                      >
                        <NodeFieldDisplay
                          calcRes={run.hit}
                          compareCalcRes={nowHits?.[i]?.[r]?.hit}
                          component={Box}
                          showZero
                        />
                        {runs.length > 1 && (
                          <Typography
                            component="div"
                            sx={{ ...type.label, ...numSx, fontWeight: 400 }}
                          >
                            {run.excluded.length
                              ? t('teamOpt.result.runWithout', {
                                  count: run.excluded.length,
                                  hits: formatHits(run.hits),
                                  defaultValue:
                                    '×{{hits}} without {{count}} limited buff',
                                })
                              : t('teamOpt.result.runWith', {
                                  hits: formatHits(run.hits),
                                  defaultValue: '×{{hits}} with every buff',
                                })}
                          </Typography>
                        )}
                      </Box>
                    ))}
                    {/* the attack in the rotation: its hits, what they add up to */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 1,
                      }}
                    >
                      <Typography
                        sx={{ ...type.label, ...numSx, fontWeight: 400 }}
                      >
                        {t('teamOpt.result.attackHits', {
                          hits: formatHits(attack.hits),
                          defaultValue: '×{{hits}} per rotation',
                        })}
                      </Typography>
                      <Typography
                        sx={{ ...numSx, fontSize: 12.5, whiteSpace: 'nowrap' }}
                      >
                        <Box component="span" sx={{ fontWeight: 600 }}>
                          {formatRate(total, rotationTime)}
                          {rotationTime ? ' DPS' : ''}
                        </Box>
                        {change !== undefined && Math.abs(change) >= 0.0005 && (
                          <Box
                            component="span"
                            sx={{
                              ml: 0.75,
                              fontWeight: 600,
                              color: change > 0 ? 'success.main' : 'error.main',
                            }}
                          >
                            {formatGain(change)}
                          </Box>
                        )}
                      </Typography>
                    </Box>
                  </ListItem>
                )
              })}
            </FieldDisplayList>
          )}
        </Box>
      </Box>
    </DataContext.Provider>
  )
})
