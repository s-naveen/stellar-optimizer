/**
 * Every character kit, played solo through a standard rotation in a sandbox team: it must not
 * throw, its actions must take time, and every hit's path must be a damage node of the
 * character's sheet that computes to a number. KIT=<Key,Key> limits it to some kits.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  allWeaponKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  getCharEle,
  getCharWeaponType,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const only = process.env['KIT']?.split(',')
const keys = (Object.keys(kitModels) as CharacterKey[]).filter(
  (k) => !only || only.includes(k)
)
const ROTATION = 'X E N3 CA hE Q N4 D J P'

/** The sheet sources of a character (Travelers: the female folder) */
const SHEETS = join(__dirname, '../../../sheets/src/Characters')
const SHEET_ROOT = join(SHEETS, '..')
const readDir = (dir: string) => {
  try {
    return readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
  } catch {
    return ''
  }
}
/**
 * The sheet sources a buff can live in: the team's own conditionals (resonance, reactions), the
 * shared Traveler sheet, an artifact set's or weapon's sheet, or the owner's character sheet
 * (Travelers: the female folder)
 */
function sheetSource(owner: string, sheetKey: string) {
  if (owner === 'team')
    return ['Resonance.tsx', 'Reaction.tsx']
      .map((f) => {
        try {
          return readFileSync(join(SHEET_ROOT, f), 'utf8')
        } catch {
          return ''
        }
      })
      .join('\n')
  if (sheetKey === 'Traveler')
    return [
      readDir(join(SHEETS, 'Traveler')),
      ...readdirSync(SHEETS)
        .filter((d) => d.startsWith('Traveler'))
        .map((d) => readDir(join(SHEETS, d))),
    ].join('\n')
  if (sheetKey !== owner) {
    const art = readDir(join(SHEET_ROOT, 'Artifacts', sheetKey))
    if (art) return art
    for (const type of readdirSync(join(SHEET_ROOT, 'Weapons'))) {
      const w = readDir(join(SHEET_ROOT, 'Weapons', type, sheetKey))
      if (w) return w
    }
  }
  return readDir(join(SHEETS, owner)) || readDir(join(SHEETS, `${owner}F`))
}
/** A buff the kit times must be a conditional of the owner's sheet, with that state */
function badBuffs(
  buffs: { owner: string; path: string[]; value: string }[]
): string[] {
  const bad = new Set<string>()
  for (const { owner, path, value } of buffs) {
    if (!value) continue // a tracked conditional being disabled is not a sheet state
    if (path[1]?.startsWith('_')) continue // engine-internal (attack speed, …)
    const src = sheetSource(owner, path[0])
    const name = path[1]
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (
      !new RegExp(`cond\\(\\s*\\w+\\s*,\\s*['"\`]${esc(name)}['"\`]`).test(
        src
      ) &&
      // paths built in the sheet ([key, 'name'] for condReadNode, or `${prefix}${ele}` keys)
      !new RegExp(`['"\`]${esc(name)}['"\`]`).test(src) &&
      !new RegExp(
        `\`${esc(name.replace(/(anemo|geo|electro|dendro|hydro|pyro|cryo|physical)$/, ''))}\\$\\{`
      ).test(src) &&
      // names built from the element (Traveler: `${elementKey}C6Hit`)
      !new RegExp(
        `cond\\(\\s*\\w+\\s*,\\s*\`\\$\\{\\w+\\}${esc(name.replace(/^(anemo|geo|electro|dendro|hydro|pyro|cryo)/, ''))}\``
      ).test(src)
    )
      bad.add(`${owner}: ${path.join('.')} is not a conditional of the sheet`)
    else if (
      !/stack/i.test(name) &&
      !(/^\d+$/.test(value) && /range\(/.test(src)) &&
      !new RegExp(`(^|[^\\w])['"]?${esc(value)}['"]?\\s*[:,\\]]`, 'm').test(src)
    )
      bad.add(`${owner}: ${path.join('.')} has no state '${value}'`)
  }
  return [...bad]
}

describe.each(keys)('kit %s', (key) => {
  it('plays a standard rotation, every hit on a real damage node', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const constellation of [0, 6]) {
      db.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation,
      })
      const type = getCharWeaponType(key)
      const weaponKey = (allWeaponKeys as readonly WeaponKey[]).find(
        (w) =>
          getWeaponStat(w)?.weaponType === type &&
          getWeaponStat(w)?.rarity === 4
      )!
      if (
        !db.weapons.values.some((w) => w.location === charKeyToLocCharKey(key))
      )
        db.weapons.new({
          key: weaponKey,
          level: 90,
          ascension: 6,
          refinement: 1,
          location: charKeyToLocCharKey(key),
          lock: false,
        })
      const teamCharId = db.teamChars.new(key, {})
      const teamId = db.teams.new({
        loadoutData: [{ teamCharId }] as LoadoutDatum[],
      })
      const rotation = parseRotation(ROTATION.replace('X', key), [
        { characterKey: key, name: key },
      ])
      const sim = simulateRotation({
        rotation,
        members: [key],
        constellations: { [key]: constellation },
        elements: { [key]: getCharEle(key) } as never,
        repeats: 2,
      })
      expect(sim.frames).toBeGreaterThan(0)
      const teamData = getTeamDataWith(db, teamId, {})!
      const display = uiDataForTeam(teamData as never, 'F', key)[
        key
      ]!.target.getDisplay() as any
      const bad = new Set<string>()
      for (const h of sim.hits) {
        if (h.path[0].startsWith('_') || h.path[0] === 'reaction') continue
        const node = display?.[h.path[0]]?.[h.path[1]]
        if (!node || typeof node.value !== 'number' || Number.isNaN(node.value))
          bad.add(
            `${h.path.join('.')} (${h.label})${node ? ` = ${node.value}` : ' missing'}`
          )
      }
      expect([...bad], `C${constellation} hits not on a damage node`).toEqual(
        []
      )
      expect(
        badBuffs([...sim.buffWindows, ...sim.countedBuffs]),
        `C${constellation} buffs not on a sheet conditional`
      ).toEqual([])
      expect(
        sim.hits.filter((h) => !h.path[0].startsWith('_')).length,
        'no hits'
      ).toBeGreaterThan(0)
    }
  })
})
