/**
 * KQM mode on a real database export (not committed): KQM_DB=<GOOD json> [KQM_TEAM=<name>]
 * Logs the run's time, the team's damage and each member's build and rankings.
 */
import { readFileSync } from 'node:fs'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase, defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  evaluateTeamRotation,
  optimizeTeamKqm,
  teamOptBonusStats,
  teamOptMembers,
} from '../'

const file = process.env['KQM_DB']
describe.skipIf(!file)('KQM mode on a real export', () => {
  it('runs', async () => {
    const db = new ArtCharDatabase(1, new SandboxStorage({}))
    db.importGOOD(JSON.parse(readFileSync(file!, 'utf8')), false, false)
    const name = process.env['KQM_TEAM'] ?? 'Tsaritsa'
    const team = db.teams.values.find((t) => t.name === name)
    expect(team).toBeTruthy()
    const teamId = db.teams.keys.find((k) => db.teams.get(k) === team)!
    const teamOpt = structuredClone(team!.teamOpt!)
    if (process.env['KQM_ER'])
      teamOpt.kqm = {
        ...(teamOpt.kqm ?? defaultTeamOptKqm),
        energyRecharge: /^\d+$/.test(process.env['KQM_ER'])
          ? Object.fromEntries(
              teamOptMembers(db, teamId).map((m) => [
                m.characterKey,
                Number(process.env['KQM_ER']),
              ])
            )
          : JSON.parse(process.env['KQM_ER']),
      }
    if (process.env['KQM_TALENTS'])
      teamOpt.kqm = {
        ...(teamOpt.kqm ?? defaultTeamOptKqm),
        talents: Number(process.env['KQM_TALENTS']) as 9 | 10,
      }
    const sands = process.env['KQM_SANDS']
      ? JSON.parse(process.env['KQM_SANDS'])
      : {}
    for (const member of teamOptMembers(db, teamId))
      if (sands[member.characterKey]) {
        const configId = member.teamChar.optConfigId
        const config = db.optConfigs.get(configId)!
        db.optConfigs.set(configId, {
          mainStatKeys: {
            ...config.mainStatKeys,
            sands: [sands[member.characterKey]],
          },
        })
      }
    const now = evaluateTeamRotation(db, teamId, 'F', {
      arts: {},
      attacks: teamOpt.attacks,
      onField: teamOpt.onField,
      bonusStats: teamOptBonusStats(
        teamOpt,
        Object.keys(teamOpt.attacks) as never
      ),
    })
    const t0 = performance.now()
    let steps = 0
    const result = await optimizeTeamKqm({
      database: db,
      teamId,
      gender: 'F',
      teamOpt,
      onStep: (s) => {
        steps++
        if (s.stage) return
        console.log(
          `  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s.phase} r${s.round} ${s.characterKey}`
        )
      },
    })
    const secs = (performance.now() - t0) / 1000
    console.log('TRN', JSON.stringify((globalThis as any).__TRN))
    expect(result).toBeTruthy()
    console.log('ER', JSON.stringify(result!.energyRecharge))
    // the chosen builds are at the top of their own rankings
    const above = Object.entries(result!.rankings).flatMap(([ck, r]) =>
      [...(r?.sets ?? []), ...(r?.weapons ?? [])]
        .filter((o) => !o.unmet && o.total > result!.after.total * (1 + 1e-9))
        .map(
          (o) =>
            `${ck}:${o.weapon.key}/${JSON.stringify(o.sets)} ${o.total.toFixed(0)}`
        )
    )
    console.log(
      `ranked above the chosen builds: ${above.length ? above.join(', ') : 'none'}`
    )
    console.log(
      `${name}: now ${now?.total.toFixed(0)} → KQM ${result!.after.total.toFixed(0)} in ${secs.toFixed(1)} s, ${result!.rounds} rounds, ${steps} steps`
    )
    for (const [ck, b] of Object.entries(result!.builds)) {
      console.log(
        `  ${ck}: ${b!.weapon.key} R${b!.weapon.refinement} ${JSON.stringify(b!.sets)} ${b!.mains.sands}/${b!.mains.goblet}/${b!.mains.circlet} ${JSON.stringify(b!.rolls)} member ${result!.after.members[ck as never]?.toFixed(0)} unmet ${JSON.stringify(result!.after.unmet[ck as never] ?? [])}`
      )
      const r = result!.rankings[ck as never]
      console.log(
        `    sets: ${r?.sets
          .slice(0, 5)
          .map(
            (o) =>
              `${JSON.stringify(o.sets)} ${o.total.toFixed(0)}${o.unmet ? '!' : ''}`
          )
          .join(' | ')}`
      )
      console.log(
        `    weapons: ${r?.weapons
          .slice(0, 5)
          .map(
            (o) => `${o.weapon.key} ${o.total.toFixed(0)}${o.unmet ? '!' : ''}`
          )
          .join(' | ')}`
      )
      console.log(
        `    assumed: ${JSON.stringify(result!.assumed[ck as never])}`
      )
    }
  }, 900_000)
})
