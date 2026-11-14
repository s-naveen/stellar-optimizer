/**
 * Generated rotation vs the hand-built one on a real export (not committed data):
 * ROT_DB=<GOOD json> ROT_TEAM=<team id> ROT_TEXT="<rotation>"
 */
import { readFileSync } from 'node:fs'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, it } from 'vitest'
import { evaluateTeamRotation, teamOptBonusStats, teamOptMembers } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const file = process.env['ROT_DB']
describe.skipIf(!file)('rotation on a real export', () => {
  it('runs', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage({}))
    db.importGOOD(JSON.parse(readFileSync(file!, 'utf8')), false, false)
    const teamId = process.env['ROT_TEAM']!
    const teamOpt = db.teams.get(teamId)!.teamOpt!
    const members = teamOptMembers(db, teamId).map((m) => m.characterKey)
    const rotation = parseRotation(
      process.env['ROT_TEXT']!,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    )
    const sim = simulateRotation({
      rotation,
      members,
      constellations: Object.fromEntries(
        members.map((m) => [m, db.chars.get(m)?.constellation ?? 0])
      ),
      elements: Object.fromEntries(
        members.map((m) => [m, getCharEle(m)])
      ) as never,
    })
    const attacks = rotationAttacks(sim, (owner, path) => {
      const m = teamOptMembers(db, teamId).find((x) => x.characterKey === owner)
      return (
        m?.teamChar.conditional as
          | Record<string, Record<string, string>>
          | undefined
      )?.[path[0]]?.[path[1]]
    })
    const chips = Object.values(attacks)
      .flat()
      .reduce(
        (n, a) => n + (a!.states?.length ?? 0) + (a!.limits?.length ?? 0),
        0
      )
    console.log(`buff chips on attacks: ${chips}`)
    const evalWith = (a: typeof teamOpt.attacks) =>
      evaluateTeamRotation(db, teamId, 'F', {
        arts: {},
        attacks: a,
        onField: teamOpt.onField,
        bonusStats: teamOptBonusStats(teamOpt, members),
      })!
    const gen = evalWith(attacks)
    const hand = evalWith(teamOpt.attacks)
    const secs = sim.frames / 60
    console.log(
      `generated: ${gen.total.toFixed(0)} per rotation, ${secs.toFixed(2)} s → ${(gen.total / secs).toFixed(0)} DPS`
    )
    const handTime = teamOpt.rotationTime ?? 20
    console.log(
      `hand-built: ${hand.total.toFixed(0)} per rotation, ${handTime} s (set) → ${(hand.total / handTime).toFixed(0)} DPS`
    )
    for (const m of members) {
      console.log(
        `  ${m}: generated ${(gen.members[m as CharacterKey] ?? 0).toFixed(0)} vs hand ${(hand.members[m as CharacterKey] ?? 0).toFixed(0)}`
      )
      ;(attacks[m as CharacterKey] ?? []).forEach((a, i) => {
        const v = gen.attacks[m as CharacterKey]?.[i] ?? 0
        console.log(
          `     ${v === 0 ? 'ZERO ' : ''}${a.path.join('.')} ×${a.hits} = ${v.toFixed(0)} (${(v / a.hits).toFixed(0)}/hit) ${a.description}`
        )
      })
    }
    console.log('notes', sim.notes, 'warnings', sim.warnings)
  }, 300_000)
})
