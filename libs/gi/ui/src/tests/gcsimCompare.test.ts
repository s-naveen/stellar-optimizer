/**
 * A gcsim team (converted by /tmp/go-bench/gcsimdb/tools) through our rotation writer and Team
 * Optimize evaluation, for comparing with gcsim on the same builds and rotation. Not committed
 * data: GCSIM_TEAM=<dir>/<team> (reads <team>.json builds and <team>.spec.json), writes
 * <team>.ours.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation, getTeamDataWith } from '../'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { HEXEREI_CHARACTERS } from '../util/teamOpt/rotation/gearEffects'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  needsRotationCalculation,
  rotationAttacks,
  simulateRotationSamples,
} from '../util/teamOpt/rotation/simulate'
import { rotationCalculation } from '../util/teamOpt/rotationCalculation'

type Converted = {
  key: CharacterKey
  level: number
  cons: number
  talent: [number, number, number]
  weapon: [string, number]
  sets: Record<string, number>
  mains: Record<'sands' | 'goblet' | 'circlet', string>
  subs: Record<string, number>
  params: string
}

const teams = (process.env['GCSIM_TEAM'] ?? '').split(',').filter(Boolean)
describe.skipIf(!teams.length).each(teams.length ? teams : [''])(
  'gcsim comparison %s',
  (team) => {
    it('runs', async () => {
      // Let the worker acknowledge test-start RPCs before a full sampled timeline blocks it.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const builds: Converted[] = JSON.parse(
        readFileSync(`${team}.json`, 'utf8')
      )
      const spec: {
        text: string
        loops?: number
        conditional?: Record<string, Record<string, Record<string, string>>>
      } = JSON.parse(readFileSync(`${team}.spec.json`, 'utf8'))
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      const members = builds.map((b) => b.key)
      const elements = members.map((m) => getCharEle(m))
      const loadout = builds.map((b) => {
        const talent = {
          auto: b.talent[0],
          skill: b.talent[1],
          burst: b.talent[2],
        }
        db.chars.set(b.key, {
          key: b.key,
          level: b.level,
          ascension: 6,
          talent,
          constellation: b.cons,
        })
        // set and weapon effects: chosen by rule for a character that does everything (KQM mode's)
        const items = itemConditionals(
          {
            attacks: ['normal', 'charged', 'plunging', 'skill', 'burst'],
            auras: elements,
            otherElements: new Set(elements).size - 1,
          },
          {
            sets: Object.keys(b.sets).filter((s) => b.sets[s] >= 2) as never,
            weapons: [b.weapon[0]] as never,
          }
        ).conditional
        const hexerei =
          members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2 &&
          HEXEREI_CHARACTERS.includes(b.key)
        const conditional = {
          ...items,
          ...(hexerei ? { [b.key]: { lockHomework: 'on' } } : {}),
          ...(spec.conditional?.[b.key] ?? {}),
        }
        const teamCharId = db.teamChars.new(b.key, { conditional } as never)
        const buildTcId = db.buildTcs.new({
          characterKey: b.key,
          character: {
            level: b.level,
            ascension: 6,
            constellation: b.cons,
            talent,
          },
          weapon: {
            key: b.weapon[0],
            level: 90,
            ascension: 6,
            refinement: b.weapon[1],
          },
          artifact: {
            slots: {
              flower: { level: 20, rarity: 5, statKey: 'hp' },
              plume: { level: 20, rarity: 5, statKey: 'atk' },
              sands: { level: 20, rarity: 5, statKey: b.mains.sands },
              goblet: { level: 20, rarity: 5, statKey: b.mains.goblet },
              circlet: { level: 20, rarity: 5, statKey: b.mains.circlet },
            },
            substats: { type: 'max', stats: b.subs, rarity: 5 },
            sets: b.sets,
          },
        } as never)
        return { teamCharId, buildType: 'tc', buildTcId, conditional }
      })
      const teamId = db.teams.new({
        loadoutData: loadout.map(
          ({ conditional: _c, ...l }) => l
        ) as LoadoutDatum[],
        enemyOverride: { enemyLevel: 100 },
      } as never)
      const auraTrace: unknown[] = []
      const sim = simulateRotationSamples({
        auraTrace: process.env['TRACE'] ? (e) => auraTrace.push(e) : undefined,
        calculate: needsRotationCalculation(members)
          ? rotationCalculation(db, teamId, 'F')
          : undefined,
        repeats: spec.loops ?? 4,
        keep: 'all',
        rotation: parseRotation(
          spec.text,
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: Object.fromEntries(builds.map((b) => [b.key, b.cons])),
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear: Object.fromEntries(
          builds.map((b) => [
            b.key,
            { sets: b.sets, weapon: b.weapon[0], refinement: b.weapon[1] },
          ])
        ),
      })
      expect(
        sim.unsupported,
        'comparison contains unsupported characters'
      ).toEqual([])
      expect(
        sim.warnings,
        'comparison skipped or rejected rotation actions'
      ).toEqual([])
      const own = (owner: string, path: string[]) =>
        owner === 'team'
          ? undefined
          : (
              loadout[members.indexOf(owner as CharacterKey)]?.conditional as
                | Record<string, Record<string, string>>
                | undefined
            )?.[path[0]]?.[path[1]]
      const attacks = rotationAttacks(sim, own)
      const res = evaluateTeamRotation(db, teamId, 'F', {
        arts: {},
        attacks,
        onField: members[0],
        bonusStats: {},
      } as never)!
      const secs = sim.frames / 60
      const abilities: Record<
        string,
        Record<string, { hits: number; dmg: number }>
      > = {}
      for (const m of members)
        for (const [i, a] of (attacks[m] ?? []).entries()) {
          const label = a.description ?? a.path.join('.')
          const x = ((abilities[m] ??= {})[label] ??= { hits: 0, dmg: 0 })
          x.hits += a.hits
          x.dmg += res.attacks[m]?.[i] ?? 0
        }
      const td = getTeamDataWith(db, teamId, {})!
      const stats = Object.fromEntries(
        members.map((m) => {
          const u = uiDataForTeam(td as never, 'F', m)[m]!.target as any
          const g = (k: string) =>
            u.get({ operation: 'read', path: ['premod', k] } as never)?.value
          return [
            m,
            Object.fromEntries(
              [
                'hp',
                'atk',
                'def',
                'eleMas',
                'critRate_',
                'critDMG_',
                'enerRech_',
                `${getCharEle(m)}_dmg_`,
              ].map((k) => [k, g(k)])
            ),
          ]
        })
      )
      // per-hit inspection: INSPECT="Member:label substring|Member:label…"
      const inspect: Record<string, unknown>[] = []
      for (const q of (process.env['INSPECT'] ?? '')
        .split('|')
        .filter(Boolean)) {
        const [m, label, occurrence] = q.split(':') as [
          CharacterKey,
          string,
          string?,
        ]
        const matches = (attacks[m] ?? []).filter((x) =>
          x.description?.includes(label)
        )
        const a =
          occurrence === undefined
            ? matches.sort(
                (x, y) => (y.states?.length ?? 0) - (x.states?.length ?? 0)
              )[0]
            : matches[Number(occurrence)]
        if (!a) continue
        const data = getTeamDataWith(db, teamId, {
          states: a.states ?? [],
          excluded: a.limits
            ?.filter((l) => l.hits === 0)
            .map(({ owner, path }) => ({ owner, path })),
        } as never)
        if (!data) continue
        const active = a.onField && data[a.onField] ? a.onField : members[0]
        const ordered = { [active]: data[active], ...data }
        const ui = uiDataForTeam(ordered as never, 'F', active)
        const u = ui[m]!.target as any
        // where a stat comes from: every member's team buff (STAT=atk_)
        const teamParts = process.env['STAT']
          ? Object.fromEntries(
              members.map((x) => [
                x,
                (ui[x]?.target as any)?.get({
                  operation: 'read',
                  path: ['teamBuff', 'premod', process.env['STAT']],
                } as never)?.value,
              ])
            )
          : undefined
        const r = (...path: string[]) =>
          u.get({ operation: 'read', path } as never)?.value
        const ele = getCharEle(m)
        const tag =
          a.path[0] === 'normal'
            ? 'normal'
            : a.path[0] === 'charged'
              ? 'charged'
              : a.path[0]
        inspect.push({
          member: m,
          label: a.description,
          teamParts,
          paths: Object.fromEntries(
            (process.env['PATHS'] ?? '')
              .split(',')
              .filter(Boolean)
              .map((p) => [p, r(...p.split('.'))])
          ),
          tree: process.env['TREE']
            ? (() => {
                const seen = new Set<unknown>()
                const walk = (n: any, d: number): unknown => {
                  if (!n || d > 6 || seen.has(n)) return '…'
                  seen.add(n)
                  return {
                    v: n.value,
                    src: n.info?.source ?? n.meta?.path?.join('.'),
                    name: n.info?.name,
                    op: n.meta?.op,
                    of: (n.meta?.ops ?? [])
                      .slice(0, 20)
                      .map((x: any) => walk(x, d + 1)),
                  }
                }
                const node = u.get({
                  operation: 'read',
                  path: process.env['TREE']!.split('.'),
                } as never)
                return { keys: Object.keys(node ?? {}), t: walk(node, 0) }
              })()
            : undefined,
          states: (a.states ?? []).map((x) => `${x.path.join('.')}=${x.value}`),
          limits: (a.limits ?? []).map((x) => x.path.join('.')),
          atk: r('total', 'atk'),
          atk_: r('total', 'atk_'),
          atkPremod_: r('premod', 'atk_'),
          hp: r('total', 'hp'),
          def: r('total', 'def'),
          eleMas: r('total', 'eleMas'),
          critRate_: r('total', 'critRate_'),
          critDMG_: r('total', 'critDMG_'),
          ele_dmg_: r('total', `${ele}_dmg_`),
          tag_dmg_: r('total', `${tag}_dmg_`),
          all_dmg_: r('total', 'all_dmg_'),
          pyro_dmg_: r('total', 'pyro_dmg_'),
          normal_dmg_: r('total', 'normal_dmg_'),
          normal_dmgInc: r('total', 'normal_dmgInc'),
          enemyRes: r('total', `${ele}_enemyRes_`),
          enemyResBase: r('enemy', `${ele}_res_`),
          enemyDefRed_: r('total', 'enemyDefRed_'),
          perHit:
            (res.attacks[m]?.[(attacks[m] ?? []).indexOf(a)] ?? 0) / a.hits,
          statSnapshots: a.statSnapshots?.map((snapshot) => {
            const captured = getTeamDataWith(db, teamId, {
              states: snapshot.states,
            })
            const active = snapshot.onField
            const source = snapshot.characterKey ?? m
            const ui = captured?.[active]
              ? uiDataForTeam(
                  { [active]: captured[active], ...captured } as never,
                  'F',
                  active
                )[source]?.target
              : undefined
            return {
              ...snapshot,
              sourceAtk: ui?.get({
                operation: 'read',
                path: ['total', 'atk'],
              } as never)?.value,
              sourcePremodAtk: ui?.get({
                operation: 'read',
                path: ['premod', 'atk'],
              } as never)?.value,
              value: ui?.get({
                operation: 'read',
                path: snapshot.path,
              } as never)?.value,
            }
          }),
        })
      }
      const reactions: Record<string, number> = {}
      for (const { probability, result } of sim.samples ?? [
        { probability: 1, result: sim },
      ])
        for (const h of result.hits)
          if (h.path[0] === '_reaction')
            reactions[h.path[1]] = (reactions[h.path[1]] ?? 0) + probability
      writeFileSync(
        `${team}.ours.json`,
        JSON.stringify(
          {
            ...(auraTrace.length ? { auraTrace } : {}),
            seconds: secs,
            samples: sim.samples?.length ?? 1,
            dps: res.total / secs,
            members: Object.fromEntries(
              members.map((m) => [m, (res.members[m] ?? 0) / secs])
            ),
            abilities,
            reactions,
            stats,
            inspect,
            attacks: Object.fromEntries(
              members.map((m) => [
                m,
                (attacks[m] ?? []).map((a, i) => ({
                  path: a.path.join('.'),
                  label: a.description,
                  hits: a.hits,
                  reaction: a.reaction,
                  perHit: (res.attacks[m]?.[i] ?? 0) / a.hits,
                  states: (a.states ?? []).map(
                    (x) => `${x.path.join('.')}=${x.value}`
                  ),
                })),
              ])
            ),
            actions: sim.actions.map((a) => ({
              ...a,
              start: (a.start - sim.start) / 60,
            })),
            windows: sim.buffWindows.map((w) => ({
              owner: w.owner,
              path: w.path.join('.'),
              value: w.value,
              start: (w.start - sim.start) / 60,
              end: (w.end - sim.start) / 60,
            })),
            notes: sim.notes,
            warnings: sim.warnings,
            ...(process.env['TRACE_ROTATION'] ? { timeline: sim.hits } : {}),
          },
          null,
          1
        )
      )
      console.log(
        `${team}: ${(res.total / secs).toFixed(0)} DPS over ${secs.toFixed(2)} s`
      )
    }, 300_000)
  }
)
