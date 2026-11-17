import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
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

describe('Danica', () => {
  it('her third normal hits twice (game data: ×2)', () => {
    const sim = run('Danica N3 W1', ['Danica'])
    const third = sim.hits.filter((h) => h.path.join('.') === 'normal.2')
    expect(third).toHaveLength(2)
    expect(third[0].t).toBe(third[1].t)
  })

  it('uses Anchor normals on-field, builds Excitement, then On-Field Skill E2 enters Battle Maid and skips a stage', () => {
    const sim = run('Danica E N4 E N1 W1', ['Danica'])
    expect(sim.warnings).toEqual([])
    const anchor = sim.hits.filter((h) => h.path[1]?.startsWith('anchor'))
    expect(anchor.map((h) => h.path[1])).toEqual([
      'anchor0',
      'anchor1',
      'anchor2',
      'anchor2',
      'anchor3',
      // after one On-Field Skill E2 the next round starts at the second stage
      'anchor1',
    ])
    expect(anchor.every((h) => h.element === 'electro')).toBe(true)
    const e2 = sim.hits.find((h) => h.path.join('.') === 'skill.onFieldDmg')!
    expect(e2.tag).toBe('directStellarConduct')
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Danica.maidForm' && w.value === 'battle'
      )
    ).toBe(true)
    // the second E is On-Field Skill E2, not a cooldown wait
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
  })

  it('C2 Toast: Stellar-Conduct damage consumes stacks for its +ATK damage', () => {
    const sim = run(
      'Kaeya E -> Danica E -> Mitya E -> Danica Q W3',
      ['Danica', 'Mitya', 'Kaeya', 'Bennett'],
      { Danica: 2 }
    )
    const sc = rotationAttacks(sim).Danica!.filter((a) =>
      a.path[1]?.endsWith('ScDmg')
    )
    expect(sc.length).toBeGreaterThan(0)
    expect(
      sc.every((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(true)
    const none = run('Kaeya E -> Danica E -> Mitya E -> Danica Q W3', [
      'Danica',
      'Mitya',
      'Kaeya',
      'Bennett',
    ])
    expect(
      rotationAttacks(none).Danica!.some((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(false)
  })

  it('C2 Toast in Battle Maid consumes up to 2 stacks per Stellar-Conduct hit and has no 6-stack refund', () => {
    const sim = run('Danica E N4 E W1', ['Danica'], { Danica: 2 })
    const e2 = rotationAttacks(sim).Danica!.find(
      (a) => a.path.join('.') === 'skill.onFieldDmg'
    )!
    expect(e2.states).toContainEqual({
      owner: 'Danica',
      path: ['Danica', 'c2SelfToast'],
      value: '2',
    })
    expect(
      e2.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
    ).toBe(false)
  })

  // (dump Avatar_Danica_ElementalArt_InsertClaymore: the re-summon removes the Anchor handler)
  it('Scouring Anchor ends the form: in "Entry E Q" no Royal Guard, Aegis or party ATK is left after the E', () => {
    const sim = run('Danica E -> Kaeya E -> Lisa E -> Danica E Q W2', [
      'Danica',
      'Kaeya',
      'Lisa',
    ])
    const entry = sim.actions.find(
      (a) => a.characterKey === 'Danica' && a.text === 'Entry'
    )!
    const e = sim.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'E'
    )[1]
    expect(entry).toBeTruthy()
    expect(e.start).toBeGreaterThan(entry.start)
    const windows = (path: string) =>
      sim.buffWindows.filter((w) => w.path.join('.') === `Danica.${path}`)
    // Royal Guard from the Entry until the E's re-summon (22 frames in), then no form
    const guard = windows('maidForm').filter((w) => w.value === 'defense')
    expect(guard).toHaveLength(1)
    expect(guard[0].start).toBe(entry.start)
    expect(guard[0].end).toBe(e.start + 22)
    // the Q after it has no form to light: no Royal Guard ATK at any time
    expect(windows('burstEnhanced').some((w) => w.value === 'on')).toBe(false)
    // the Royal Aegis ends with the form (a 0-frame shield of the same kind)
    const shields = sim.hits
      .filter((h) => h.path[0] === '_marker' && h.path[1] === 'shield')
      .map((h) => [h.t, +h.path[2]])
    expect(shields).toEqual([
      [entry.start, 1500],
      [e.start + 22, 0],
    ])
  })

  it('Scouring Anchor clears Will to Protect’s cooldown: a second Entry within 16 s', () => {
    // (Lisa's Normal Attacks fill Will off the field; the second E waits out its own 18 s)
    const sim = run(
      'Danica E -> Lisa N2 W15 -> Danica E -> Lisa N2 -> Danica N1',
      ['Danica', 'Lisa']
    )
    const entries = sim.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'Entry'
    )
    expect(entries).toHaveLength(2)
    expect(entries[1].start - entries[0].start).toBeLessThan(960)
  })

  it('the Burst window is live: a Q before Will to Purge lights it, refills Will and enhances both casts', () => {
    // (Kaeya's Burst: Will short of 100 at the swap, no Entry, and Cryo that keeps Radiance up)
    const sim = run('Danica E -> Kaeya Q -> Danica Q N4 E E W1', [
      'Danica',
      'Kaeya',
    ])
    expect(sim.actions.some((a) => a.text === 'Entry')).toBe(false)
    const purges = rotationAttacks(sim).Danica!.filter(
      (a) => a.path.join('.') === 'skill.onFieldDmg'
    )
    // (the second E is a Will to Purge without Normal Attacks: entering Cleaner refilled Will)
    expect(purges).toHaveLength(2)
    for (const p of purges)
      expect(p.states).toContainEqual({
        owner: 'Danica',
        path: ['Danica', 'burstEnhanced'],
        value: 'on',
      })
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
  })

  it('uses 18 s Burst CD (from 0.4 s into the cast: 18.4 s press to press) and 16 s Will to Protect CD', () => {
    const burst = run('Danica Q Q', ['Danica'])
    const qs = burst.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'Q'
    )
    expect(qs[1].start - qs[0].start).toBe(1104)

    const early = run(
      'Danica E -> Kaeya E -> Lisa E -> Danica N1 W6 -> Kaeya E -> Lisa E -> Danica N1',
      ['Danica', 'Kaeya', 'Lisa']
    )
    expect(
      early.actions.filter(
        (a) => a.characterKey === 'Danica' && a.text === 'Entry'
      )
    ).toHaveLength(1)

    const ready = run(
      'Danica E -> Kaeya E -> Lisa E -> Danica N1 W16 -> Kaeya E -> Lisa E -> Danica N1',
      ['Danica', 'Kaeya', 'Lisa']
    )
    const entries = ready.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'Entry'
    )
    expect(entries).toHaveLength(2)
    expect(entries[1].start - entries[0].start).toBeGreaterThanOrEqual(960)
  })

  it('sheet reflects 7.2.52 Burst ATK ratio/cap, C1 100%, C2 Cleaning Decree 150% without double-counting Toast, and C6 15% Elevation', () => {
    const setup = (
      constellation: number,
      cond: Record<string, string>,
      atkBonus = 0,
      bonusStats: Record<string, number> = {}
    ) => {
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      db.chars.set('Danica', {
        key: 'Danica',
        level: 90,
        ascension: 6,
        talent: { auto: 10, skill: 10, burst: 10 },
        constellation,
      })
      db.chars.set('Bennett', {
        key: 'Bennett',
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
      db.weapons.new({
        key: 'WasterGreatsword',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Danica',
        lock: false,
      })
      db.weapons.new({
        key: 'DullBlade',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Bennett',
        lock: false,
      })
      const dId = db.teamChars.new('Danica', {
        conditional: { Danica: cond },
        bonusStats: { ...(atkBonus ? { atk: atkBonus } : {}), ...bonusStats },
      })
      const bId = db.teamChars.new('Bennett', {})
      const teamId = db.teams.new({
        loadoutData: [
          { teamCharId: dId },
          { teamCharId: bId },
        ] as LoadoutDatum[],
      })
      const ui = uiDataForTeam(
        getTeamDataWith(db, teamId, {})! as never,
        'F',
        'Danica'
      )
      return { danica: ui.Danica!.target, bennett: ui.Bennett!.target }
    }

    // Lv10 Royal Guard Burst ATK: 10% capped at 400 at C0; doubled (+100%) to 20% / 800 at C1
    const c0 = setup(
      0,
      { maidForm: 'defense', burstEnhanced: 'on', anchor: 'on' },
      5000
    )
    const baseAtk = setup(0, {}, 0).bennett.getDisplay()['basic']['atk'].value
    expect(c0.bennett.getDisplay()['basic']['atk'].value - baseAtk).toBeCloseTo(
      400,
      1
    )

    const c1 = setup(
      1,
      { maidForm: 'defense', burstEnhanced: 'on', anchor: 'on' },
      5000
    )
    expect(c1.bennett.getDisplay()['basic']['atk'].value - baseAtk).toBeCloseTo(
      800,
      1
    )

    // C6 Elevation = 15% when Storm Anchor is present
    const c6 = setup(6, { anchor: 'on' })
    expect(
      c6.bennett.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0.15, 6)

    // C2 Cleaning Decree = 1.5 * base onFieldDmg; c2Toast + c2SelfToast does not double-count +80% ATK
    const baseSelf = setup(2, {
      maidForm: 'battle',
      a0StellarRadianceSc: 'on',
    }).danica.getDisplay()
    expect(
      baseSelf['skill']['decreeDmg'].value /
        baseSelf['skill']['onFieldDmg'].value
    ).toBeCloseTo(1.5, 5)

    const both = setup(2, {
      maidForm: 'battle',
      c2Toast: 'on',
      c2SelfToast: '2',
      a0StellarRadianceSc: 'on',
    })
    const selfOnly = setup(2, {
      maidForm: 'battle',
      c2SelfToast: '2',
      a0StellarRadianceSc: 'on',
    })
    const dBoth = both.danica.getDisplay()
    const dSelf = selfOnly.danica.getDisplay()
    expect(dBoth['skill']['onFieldDmg'].value).toBeCloseTo(
      dSelf['skill']['onFieldDmg'].value,
      4
    )
    expect(dBoth['burst']['hit1ScDmg'].value).toBeCloseTo(
      dSelf['burst']['hit1ScDmg'].value,
      4
    )
    expect(
      dBoth['skill']['decreeDmg'].value - dBoth['skill']['onFieldDmg'].value
    ).toBeCloseTo(0.5 * baseSelf['skill']['onFieldDmg'].value, 4)

    // C2 self Toast: one +350% ATK addition per hit, whether it consumes 1 or 2 stacks
    const one = setup(2, {
      maidForm: 'battle',
      c2SelfToast: '1',
      a0StellarRadianceSc: 'on',
    }).danica.getDisplay()
    expect(dSelf['skill']['onFieldDmg'].value).toBeCloseTo(
      one['skill']['onFieldDmg'].value,
      4
    )
    expect(one['skill']['onFieldDmg'].value).toBeGreaterThan(
      baseSelf['skill']['onFieldDmg'].value
    )

    // Burst-enhanced Will to Purge (dump E2_Field_Attack): its multiplier × (1 + 70.27% at Burst
    // Lv10), a factor of its own, not added to the EM bonus (200 EM here)
    const em = { eleMas: 200 }
    const plain = setup(0, { maidForm: 'battle' }, 0, em).danica.getDisplay()
    const lit = setup(
      0,
      { maidForm: 'battle', burstEnhanced: 'on' },
      0,
      em
    ).danica.getDisplay()
    expect(
      lit['skill']['onFieldDmg'].value / plain['skill']['onFieldDmg'].value
    ).toBeCloseTo(1.70272, 4)
    // (C1: +120%, 1 + 2.2 × 70.27%; Cleaning Decree's 150% on top)
    const c2Lit = setup(
      2,
      { maidForm: 'battle', burstEnhanced: 'on' },
      0,
      em
    ).danica.getDisplay()
    const c2Plain = setup(2, { maidForm: 'battle' }, 0, em).danica.getDisplay()
    expect(
      c2Lit['skill']['onFieldDmg'].value / c2Plain['skill']['onFieldDmg'].value
    ).toBeCloseTo(1 + 2.2 * 0.70272, 4)
    expect(
      c2Lit['skill']['decreeDmg'].value / c2Lit['skill']['onFieldDmg'].value
    ).toBeCloseTo(1.5, 4)
  })

  it('a swap-only step plays the Entry Skill and swaps out ("Danica", "Danica entry", "Danica W1")', () => {
    const members: CharacterKey[] = ['Danica', 'Fischl', 'Kaeya', 'Bennett']
    for (const step of ['Danica', 'Danica entry', 'Danica swap', 'Danica W1']) {
      const sim = run(
        `Danica E -> Fischl E N2 -> Kaeya E N2 -> ${step} -> Bennett E N2 -> Danica`,
        members
      )
      expect(sim.warnings).toEqual([])
      const entry = sim.actions.findIndex(
        (a) => a.characterKey === 'Danica' && a.text === 'Entry'
      )
      expect(entry).toBeGreaterThan(0)
      // straight out to Bennett after it: no other Danica action between
      expect(sim.actions[entry + 1].characterKey).toBe('Bennett')
    }
  })

  it('says why a swap-only step played no Entry Skill', () => {
    const noAnchor = run('Fischl E -> Danica entry -> Fischl N2 -> Danica', [
      'Danica',
      'Fischl',
    ])
    expect(noAnchor.actions.some((a) => a.text === 'Entry')).toBe(false)
    expect(noAnchor.notes.join(' ')).toContain('her Anchor was not out')
    const notFull = run(
      'Danica E -> Bennett E N2 -> Danica -> Bennett N2 -> Danica',
      ['Danica', 'Bennett']
    )
    expect(notFull.notes.join(' ')).toContain('Will to Cleanse was not full')
    // an ordinary step is not noted
    const plain = run('Danica E -> Bennett E -> Danica E W1', [
      'Danica',
      'Bennett',
    ])
    expect(plain.notes.join(' ')).not.toContain('no entry action')
  })
})
