import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  RotationCalculation,
} from '../util/teamOpt/rotation/types'

type Options = Partial<Parameters<typeof simulateRotation>[0]>

const run = (
  members: CharacterKey[],
  text: string,
  extra: Options = {}
): ReturnType<typeof simulateRotation> =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 1,
    keep: 'all',
    ...extra,
  })

const frameKeys = (sim: ReturnType<typeof run>, member: CharacterKey) =>
  sim.actions.filter((a) => a.characterKey === member).map((a) => a.frameKey)

// Lohen's Masterstroke needs teammate damage (Will to Win) and Joy: as in rotationLohen.test.ts
const lohenCalculate: RotationCalculation = (_member, path) =>
  path.join('.') === 'base.atk' ? 100 : path[1] === 'hp' ? 20000 : 9
lohenCalculate.damage = () => [
  { damage: 1001, probability: 0.5 },
  { damage: 3000, probability: 0.5 },
]
const lohenAlly: KitModel = {
  characterKey: 'Fischl',
  element: 'electro',
  source: 'test',
  init: () => ({ fired: false }),
  act: () => ({ frames: 1 }),
  onPartyAction(c, s, actor, action) {
    if (actor !== 'Lohen' || action.kind !== 'skill' || s.fired) return
    s.fired = true
    c.hit(1, {
      characterKey: 'Fischl',
      path: ['skill', 'ozDmg'],
      tag: 'skill',
      element: 'physical',
      label: 'Damage probe',
    })
  },
}

interface Case {
  member: CharacterKey
  members: CharacterKey[]
  text: string
  /** The member's frame keys, in order */
  keys: string[]
  /** Each version's label, by its frame key */
  labels: Record<string, string>
  extra?: Options
  /** More checks on the run */
  check?: (sim: ReturnType<typeof run>) => void
}

const cases: Case[] = [
  {
    member: 'Iansan',
    members: ['Iansan', 'Bennett'],
    text: 'Iansan CA E N1 CA W1',
    keys: ['charged', 'skill', 'normal1@swift', 'charged@swift'],
    labels: {
      'normal1@swift': 'Swift Stormflight',
      'charged@swift': 'Swift Stormflight',
    },
  },
  {
    member: 'Ifa',
    members: ['Ifa', 'Bennett'],
    text: 'Ifa N1 E N1 CA D Q E W1',
    keys: [
      'normal1',
      'skill',
      'normal1@nightsoul',
      'charged@nightsoul',
      'dash@nightsoul',
      'burst@nightsoul',
      'skill@nightsoul',
    ],
    labels: {
      'normal1@nightsoul': 'Tonic Shot',
      'skill@nightsoul': "End Nightsoul's Blessing",
    },
  },
  {
    member: 'Jahoda',
    members: ['Jahoda', 'Ineffa'],
    text: 'Jahoda E E W1',
    keys: ['skill', 'skill@drain'],
    labels: { 'skill@drain': 'Drain the Treasure Flask' },
  },
  {
    member: 'Kachina',
    members: ['Kachina', 'Bennett'],
    text: 'Kachina N1 hE N1 E E W1',
    keys: [
      'normal1',
      'skillHold',
      'normal1@riding',
      'skill@dismount',
      'skill@mount',
    ],
    labels: {
      'normal1@riding': 'Turbo Twirly Slam',
      'skill@dismount': 'Dismount Turbo Twirly',
      'skill@mount': 'Mount Turbo Twirly',
    },
  },
  {
    member: 'KamisatoAyato',
    members: ['KamisatoAyato', 'Bennett'],
    text: 'KamisatoAyato N2 E N2 W1',
    keys: ['normal2', 'skill', 'normal2@shunsuiken'],
    labels: { 'normal2@shunsuiken': 'Shunsuiken' },
  },
  {
    member: 'Keqing',
    members: ['Keqing', 'Bennett'],
    text: 'Keqing E E W1',
    keys: ['skill', 'skill@slash'],
    labels: { 'skill@slash': 'Stellar Restoration (blink slash)' },
  },
  {
    member: 'Kinich',
    members: ['Kinich', 'Bennett'],
    text: 'Kinich N2 E N2 W1',
    keys: ['normal2', 'skill', 'normal2@nightsoul'],
    labels: { 'normal2@nightsoul': 'Loop Shot' },
  },
  {
    member: 'KujouSara',
    members: ['KujouSara', 'Bennett'],
    text: 'KujouSara CA E CA W1',
    keys: ['charged', 'skill', 'charged@crowfeather'],
    labels: {
      'charged@crowfeather': 'Fully-Charged Aimed Shot (Crowfeather)',
    },
  },
  {
    member: 'LanYan',
    members: ['LanYan', 'Bennett'],
    text: 'LanYan N1 E N1 W1',
    keys: ['normal1', 'skill', 'normal1@rings'],
    labels: { 'normal1@rings': 'Feathermoon Rings' },
  },
  {
    member: 'Lauma',
    members: ['Lauma', 'Bennett'],
    text: 'Lauma CA N1 CA W1',
    keys: ['charged', 'normal1', 'charged@prayer'],
    labels: { 'charged@prayer': 'Spiritcall Prayer' },
  },
  {
    member: 'Linnea',
    members: ['Linnea', 'Zibai'],
    text: 'Linnea E E E E W1',
    keys: ['skill', 'skill@feed', 'skill@feed', 'skill@feed'],
    labels: { 'skill@feed': 'Continuous Tapping (feed Lumi)' },
  },
  {
    member: 'Lohen',
    members: ['Lohen', 'Fischl'],
    text: 'Fischl E -> Lohen E N4 E W1',
    keys: ['skill', 'normal4', 'skill@etch'],
    labels: { 'skill@etch': 'Etched Into Bone and Soul' },
    extra: {
      calculate: lohenCalculate,
      kits: { Lohen: kitModels.Lohen, Fischl: lohenAlly },
    },
  },
  {
    member: 'Lyney',
    members: ['Lyney', 'Bennett'],
    text: 'Lyney E W15 Q E W1',
    keys: ['skill', 'burst', 'skill@parade'],
    labels: { 'skill@parade': 'Explosive Firework' },
  },
  {
    member: 'Mavuika',
    members: ['Mavuika', 'Bennett'],
    text: 'Mavuika N1 hE N1 CA D J P W1',
    keys: [
      'normal1',
      'skillHold',
      'normal1@flamestrider',
      'charged@flamestrider',
      'dash@flamestrider',
      'jump@flamestrider',
      'plunge@flamestrider',
    ],
    labels: {
      'normal1@flamestrider': 'Flamestrider Normal Attack',
      'plunge@flamestrider': 'Flamestrider Plunging Attack',
    },
  },
  {
    member: 'Mitya',
    members: ['Mitya', 'Bennett'],
    text: 'Mitya CA E E CA W1',
    keys: ['charged', 'skill', 'skill@switch', 'charged@overload'],
    labels: {
      'skill@switch': 'Switch the Detection Core',
      'charged@overload': 'Gradient Detonation',
    },
  },
  {
    member: 'Mualani',
    members: ['Mualani', 'Bennett'],
    // (C2: the blessing starts with 2 Wave Momentum, and the dash makes 3: a Surging Bite; its
    // Puffer and the jump make 3 again; the second Puffer leaves 1)
    text: 'Mualani N1 E D N1 J N1 N1 E W1',
    keys: [
      'normal1',
      'skill',
      'dash@sharky',
      'normal1@surging',
      'jump@sharky',
      'normal1@surging',
      'normal1@sharky',
      'skill@sharky',
    ],
    labels: {
      'normal1@sharky': "Sharky's Bite",
      'normal1@surging': "Sharky's Surging Bite",
      'skill@sharky': "End Nightsoul's Blessing",
    },
    extra: { constellations: { Mualani: 2 } },
    check: (sim) => {
      // each bite's version is the bite it plays
      const bites = sim.actions.filter((a) => a.frameKey.startsWith('normal1@'))
      const hits = sim.hits.filter((h) => h.label.startsWith("Sharky's"))
      expect(bites.map((a) => a.frameKey)).toEqual(
        hits.map((h) =>
          h.label.startsWith("Sharky's Surging")
            ? 'normal1@surging'
            : 'normal1@sharky'
        )
      )
    },
  },
  {
    member: 'Nefer',
    members: ['Nefer', 'Lauma', 'Xingqiu', 'Bennett'],
    text: 'Xingqiu E Q -> Lauma E -> Nefer CA E N1 CA W1',
    keys: ['charged', 'skill', 'normal1', 'charged@phantasm'],
    labels: { 'charged@phantasm': 'Phantasm Performance' },
    extra: { constellations: { Xingqiu: 6 } },
  },
  {
    member: 'Nilou',
    members: ['Nilou', 'Bennett'],
    text: 'Nilou N1 E N1 E W1',
    keys: ['normal1', 'skill', 'normal1@dance', 'skill@whirl'],
    labels: { 'normal1@dance': 'Sword Dance', 'skill@whirl': 'Whirling Steps' },
  },
  {
    member: 'Odette',
    members: ['Odette', 'Mitya'],
    text: 'Odette E E W1',
    keys: ['skill', 'skill@coda'],
    labels: { 'skill@coda': "Adagio: Coda at Dawn's Tolling" },
  },
  {
    member: 'Prune',
    members: ['Prune', 'Xingqiu'],
    text: 'Xingqiu E -> Prune E E W1',
    keys: ['skill', 'skill@clang'],
    labels: { 'skill@clang': 'Clang Clang! Witch-tribution Comes!' },
  },
]

describe('mode and stance versions of actions (kits I–Q)', () => {
  it.each(cases)('$member: $text', (c) => {
    const sim = run(c.members, c.text, c.extra)
    expect(frameKeys(sim, c.member)).toEqual(c.keys)
    const data = sim.actionData![c.member]!
    for (const [key, label] of Object.entries(c.labels)) {
      const action = sim.actions.find(
        (a) => a.characterKey === c.member && a.frameKey === key
      )!
      expect(action.variant?.label).toBe(label)
      expect(data[key]).toMatchObject({
        variant: { key: key.split('@')[1], label },
      })
    }
    c.check?.(sim)
  })

  it('keeps an edit of the ordinary action off its version, and the other way round', () => {
    const keqing = (frameData = {}) =>
      run(['Keqing', 'Bennett'], 'Keqing E E N1 W1', { frameData })
        .actions.filter((a) => a.characterKey === 'Keqing')
        .map((a) => a.frames)
    // (an action's frames here run to the next action: its edited length shifts its cancels)
    const plain = keqing()
    const editedE = keqing({ Keqing: { skill: { frames: 20 } } })
    expect(editedE[0]).toBeLessThan(plain[0])
    expect(editedE[1]).toBe(plain[1])
    const editedSlash = keqing({ Keqing: { 'skill@slash': { frames: 30 } } })
    expect(editedSlash[0]).toBe(plain[0])
    expect(editedSlash[1]).toBeLessThan(plain[1])

    const mavuika = (frameData = {}) =>
      run(['Mavuika', 'Bennett'], 'Mavuika N1 hE N1 W1', { frameData })
        .actions.filter((a) => a.characterKey === 'Mavuika')
        .map((a) => a.frames)
    const before = mavuika()
    const edited = mavuika({ Mavuika: { normal1: { frames: 20 } } })
    expect(edited[0]).toBeLessThan(before[0])
    expect(edited[2]).toBe(before[2])
  })
})
