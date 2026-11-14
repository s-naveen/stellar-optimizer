import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}
const windowAt = (
  sim: ReturnType<typeof run>,
  name: string,
  t: number
): string =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Anastasya' &&
        w.path[1] === name &&
        w.start <= t &&
        t < w.end
    )
    .reduce<{ start: number; value: string } | undefined>(
      (latest, w) => (!latest || w.start >= latest.start ? w : latest),
      undefined
    )?.value ?? ''

describe('Anastasya', () => {
  it('cancels a normal attack into the aimed shot at its last release (gcsim)', () => {
    const sim = run('Anastasya N1 CA', ['Anastasya'])
    const ca = sim.actions.find((a) => a.text === 'CA')!
    expect(ca.start).toBe(17)
  })

  it('the Love burst freezes the Palestar Crown for its 20 s', () => {
    const plain = run('Anastasya E W40', ['Anastasya'])
    const frozen = run('Anastasya E Q W40', ['Anastasya'])
    const crowns = (sim: ReturnType<typeof run>) =>
      sim.hits.filter((h) => h.path.join('.') === 'skill.crownDmg')
    // 20 s crown: first attack 139 frames in, then every 118
    const last = crowns(plain).at(-1)!.t
    expect(last).toBeLessThan(1200 + 17)
    expect(crowns(frozen).at(-1)!.t).toBeGreaterThan(last + 1000)
  })

  it('holds the Skill for the Blessing of Honor: Blessed Spear normals, no charged attacks', () => {
    const sim = run('Anastasya hE N5 CA', ['Anastasya'])
    expect(sim.hits.some((h) => h.path.join('.') === 'skill.holdDmg')).toBe(
      true
    )
    const spear = sim.hits.filter((h) => h.label.startsWith('Blessed Spear'))
    expect(spear).toHaveLength(1 + 2 + 1 + 3 + 3)
    expect(spear.every((h) => h.element === 'cryo')).toBe(true)
    expect(sim.warnings.some((w) => w.includes('Charged Attacks'))).toBe(true)
    expect(windowAt(sim, 'blessing', 100)).toBe('honor')
  })

  it('Evernight Seals the others, Blessed Spear hits shorten it, then Doom runs its three stages', () => {
    const sim = run('Anastasya hE Q N5 N5 N5 N5 W3 E E E W2', ['Anastasya'])
    const evernight = sim.hits.find((h) =>
      h.label.startsWith('The Evernight Yields to Dawn')
    )!
    expect(evernight.tag).toBe('directStellarConduct')
    const doom = sim.hits.filter((h) => h.label.startsWith('Palestar Edict'))
    expect(
      doom.filter((h) => h.path.join('.') === 'burst.doom1Dmg')
    ).toHaveLength(5)
    for (const stage of ['doom0Sc', 'doom1Sc', 'doom2Sc'])
      expect(doom.some((h) => h.path[1] === stage)).toBe(true)
    // Honor Sealing ended (Doom available): Accolades were shared with her meanwhile
    expect(windowAt(sim, 'accolades', evernight.t + 1)).toBe('honorSeal')
  })

  it('C2 Love lasts 30 s after the tap, independent of the crown', () => {
    const sim = run('Anastasya E W35', ['Anastasya'], { Anastasya: 2 })
    expect(windowAt(sim, 'c2LoveWindow', 1700)).toBe('on')
    expect(windowAt(sim, 'c2LoveWindow', 1900)).toBe('off')
  })

  it('C6 Love triggers a 250% Triumph on the next switch to another member', () => {
    const sim = run('Anastasya E -> Bennett E', ['Anastasya', 'Bennett'], {
      Anastasya: 6,
    })
    const triumph = sim.hits.filter((h) => h.label.startsWith('Triumph (C6)'))
    expect(triumph).toHaveLength(1)
    expect(triumph[0].path.join('.')).toBe('constellation6.triumphSc')
    const attack = rotationAttacks(sim).Anastasya!.find(
      (a) => a.path.join('.') === 'constellation6.triumphSc'
    )!
    expect(attack.states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'blessing'],
      value: 'love',
    })
  })

  it('C6 Honor adds Doom’s third attack to the next tapped Skill', () => {
    const sim = run('Anastasya hE W15 E', ['Anastasya'], { Anastasya: 6 })
    const doom = sim.hits.find((h) => h.label.startsWith('Doom 3-Hit (C6)'))!
    expect(doom.path.join('.')).toBe('constellation6.doom3Sc')
    expect(doom.states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'accolades'],
      value: 'honorSeal',
    })
  })
})
