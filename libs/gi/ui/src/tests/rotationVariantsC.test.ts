import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type FrameData,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { HitElement } from '../util/teamOpt/rotation/types'

interface VariantCase {
  member: CharacterKey
  element: HitElement
  /** The party with its elements (the member alone if not given) */
  party?: Partial<Record<CharacterKey, HitElement>>
  constellation?: number
  text: string
  /** The member's frame keys, in order */
  keys: string[]
  /** Each version's label and mode, by its frame key */
  versions: Record<string, [label: string, mode?: string]>
  /** A base key whose edit must leave every version's frames alone */
  edit: string
}

const cases: Record<string, VariantCase> = {
  'Raiden: Musou Isshin normals, charged and plunge': {
    member: 'RaidenShogun',
    element: 'electro',
    text: 'Raiden N1 C P Q N1 C P',
    keys: [
      'normal1',
      'charged',
      'plunge',
      'burst',
      'normal1@musou',
      'charged@musou',
      'plunge@musou',
    ],
    versions: {
      'normal1@musou': ['Musou Isshin Normal Attack', 'Musou Isshin'],
      'charged@musou': ['Musou Isshin Charged Attack', 'Musou Isshin'],
      'plunge@musou': ['Musou Isshin Plunging Attack', 'Musou Isshin'],
    },
    edit: 'normal1',
  },
  'Razor: tap and held E in Lightning Fang': {
    member: 'Razor',
    element: 'electro',
    text: 'Razor E Q E hE',
    keys: ['skill', 'burst', 'skill@lightningFang', 'skillHold@lightningFang'],
    versions: {
      'skill@lightningFang': ['Claw and Thunder', 'Lightning Fang'],
      'skillHold@lightningFang': ['Claw and Thunder (Hold)', 'Lightning Fang'],
    },
    edit: 'skill',
  },
  'Skirk: the Seven-Phase Flash’s normals, charged, Q and dash': {
    member: 'Skirk',
    element: 'cryo',
    text: 'Skirk N1 C E N1 C Q D',
    keys: [
      'normal1',
      'charged',
      'skill',
      'normal1@sevenPhase',
      'charged@sevenPhase',
      'burst@sevenPhase',
      'dash@sevenPhase',
    ],
    versions: {
      'normal1@sevenPhase': ['Seven-Phase Flash', 'Seven-Phase Flash'],
      'charged@sevenPhase': [
        'Seven-Phase Flash Charged Attack',
        'Seven-Phase Flash',
      ],
      'burst@sevenPhase': ['Havoc: Extinction', 'Seven-Phase Flash'],
      'dash@sevenPhase': ['Seven-Phase Flash Dash', 'Seven-Phase Flash'],
    },
    edit: 'normal1',
  },
  'Tartaglia: the Melee Stance': {
    member: 'Tartaglia',
    element: 'hydro',
    text: 'Tartaglia N1 C Q E N1 C Q E',
    keys: [
      'normal1',
      'charged',
      'burst',
      'skill',
      'normal1@melee',
      'charged@melee',
      'burst@melee',
      'skill@melee',
    ],
    versions: {
      'normal1@melee': ['Melee Stance Normal Attack', 'Melee Stance'],
      'charged@melee': ['Melee Stance Charged Attack', 'Melee Stance'],
      'burst@melee': ['Light of Obliteration', 'Melee Stance'],
      'skill@melee': ['Return to Ranged Stance', 'Melee Stance'],
    },
    edit: 'normal1',
  },
  'Tighnari: the Wreath Arrow in Vijnana Suffusion': {
    member: 'Tighnari',
    element: 'dendro',
    text: 'Tighnari C E C',
    keys: ['charged', 'skill', 'charged@suffusion'],
    versions: { 'charged@suffusion': ['Wreath Arrow', 'Vijnana Suffusion'] },
    edit: 'charged',
  },
  'Valeriy: Direct-Fire Mortar (charged, and a normal right after E)': {
    member: 'Valeriy',
    element: 'electro',
    text: 'Valeriy C E C E N2',
    keys: ['charged', 'skill', 'charged@mortar', 'skill', 'normal2@mortar'],
    versions: {
      'charged@mortar': ['Direct-Fire Mortar'],
      'normal2@mortar': ['Direct-Fire Mortar'],
    },
    edit: 'charged',
  },
  'Varesa: Follow-Up Strike, Fiery Passion and the Volcanic Kablam': {
    member: 'Varesa',
    element: 'electro',
    text: 'Varesa N1 E N1 Q N1 E C P Q',
    keys: [
      'normal1',
      'skill',
      'normal1@followUp',
      'burst',
      'normal1@fiery',
      'skill@fiery',
      'charged@fieryFollowUp',
      'plunge@fiery',
      'burst@apex',
    ],
    versions: {
      'normal1@followUp': ['Follow-Up Strike'],
      'normal1@fiery': ['Fiery Passion Normal Attack', 'Fiery Passion'],
      'skill@fiery': ['Fiery Passion Rush', 'Fiery Passion'],
      'charged@fieryFollowUp': [
        'Fiery Passion Follow-Up Strike',
        'Fiery Passion',
      ],
      'plunge@fiery': ['Fiery Passion Plunging Attack', 'Fiery Passion'],
      'burst@apex': ['Volcanic Kablam', 'Apex Drive'],
    },
    edit: 'normal1',
  },
  // (in Sturm und Drang, a charged attack without a Four Winds charge is the ordinary one)
  'Varka: Azure Devour and Four Winds’ Ascension in Sturm und Drang': {
    member: 'Varka',
    element: 'anemo',
    party: { Varka: 'anemo', Venti: 'anemo', Bennett: 'pyro' },
    text: 'Varka C E C N5 C N5 E',
    keys: [
      'charged',
      'skill',
      'charged',
      'normal5',
      'charged@sturm',
      'normal5',
      'skill@sturm',
    ],
    versions: {
      'charged@sturm': ['Azure Devour', 'Sturm und Drang'],
      'skill@sturm': ["Four Winds' Ascension", 'Sturm und Drang'],
    },
    edit: 'skill',
  },
  'Vesna: Windborne Blade Lv. 1–3, and Transpose at C6': {
    member: 'Vesna',
    element: 'anemo',
    constellation: 6,
    text: 'Vesna E E E Q E N1',
    keys: [
      'skill',
      'skill@blade1',
      'skill@blade2',
      'burst',
      'skill@blade3',
      'normal1@transpose',
    ],
    versions: {
      'skill@blade1': ['Windborne Blade Lv. 1', 'Armed for Action'],
      'skill@blade2': ['Windborne Blade Lv. 2', 'Armed for Action'],
      'skill@blade3': ['Windborne Blade Lv. 3', 'Armed for Action'],
      'normal1@transpose': ['Windborne Sword: Transpose'],
    },
    edit: 'skill',
  },
  'Wanderer: Windfavored’s normals, charged, dash, jump and Q': {
    member: 'Wanderer',
    element: 'anemo',
    text: 'Wanderer N1 E N1 C D J Q',
    keys: [
      'normal1',
      'skill',
      'normal1@windfavored',
      'charged@windfavored',
      'dash@windfavored',
      'jump@windfavored',
      'burst@windfavored',
    ],
    versions: {
      'normal1@windfavored': ['Kuugo: Fushoudan', 'Windfavored'],
      'charged@windfavored': ['Kuugo: Toufukai', 'Windfavored'],
      'dash@windfavored': ['Windfavored Dash', 'Windfavored'],
      'jump@windfavored': ['Windfavored Jump', 'Windfavored'],
      'burst@windfavored': ['Kyougen: Five Ceremonial Plays', 'Windfavored'],
    },
    edit: 'normal1',
  },
  'Wanderer: the E that ends Windfavored': {
    member: 'Wanderer',
    element: 'anemo',
    text: 'Wanderer N1 E N1 E',
    keys: ['normal1', 'skill', 'normal1@windfavored', 'skill@windfavored'],
    versions: {
      'normal1@windfavored': ['Kuugo: Fushoudan', 'Windfavored'],
      'skill@windfavored': ['End Windfavored', 'Windfavored'],
    },
    edit: 'skill',
  },
  'Xianyun: Skyladder leaps, Driftcloud Waves and her Adeptal Assistance jump':
    {
      member: 'Xianyun',
      element: 'anemo',
      text: 'Xianyun J Q J P E E P E E E P',
      keys: [
        'jump',
        'burst',
        'jump@airborne',
        'plunge',
        'skill',
        'skill@leap2',
        'plunge@driftcloud2',
        'skill',
        'skill@leap2',
        'skill@leap3',
        'plunge@driftcloud3',
      ],
      versions: {
        'jump@airborne': ['High Jump', 'Adeptal Assistance'],
        'skill@leap2': ['Skyladder (leap 2)', 'Cloud Transmogrification'],
        'skill@leap3': ['Skyladder (leap 3)', 'Cloud Transmogrification'],
        'plunge@driftcloud2': [
          'Driftcloud Wave (2 leaps)',
          'Cloud Transmogrification',
        ],
        'plunge@driftcloud3': [
          'Driftcloud Wave (3 leaps)',
          'Cloud Transmogrification',
        ],
      },
      edit: 'jump',
    },
  'Xiao: the Bane of All Evil jump and the Xianyun-assisted plunge': {
    member: 'Xiao',
    element: 'anemo',
    party: { Xiao: 'anemo', Xianyun: 'anemo' },
    text: 'Xiao P Q J -> Xianyun Q -> Xiao J P',
    keys: ['plunge', 'burst', 'jump@bane', 'jump', 'plunge@airborne'],
    versions: {
      'jump@bane': ['High Jump', 'Bane of All Evil'],
      'plunge@airborne': ['Low Plunge', 'Adeptal Assistance'],
    },
    edit: 'plunge',
  },
  'Xilonen: Blade Roller, the Nightsoul plunge and the E that ends it': {
    member: 'Xilonen',
    element: 'geo',
    text: 'Xilonen N1 P E N1 P E',
    keys: [
      'normal1',
      'plunge',
      'skill',
      'normal1@nightsoul',
      'plunge@nightsoul',
      'skill@nightsoul',
    ],
    versions: {
      'normal1@nightsoul': ['Blade Roller', "Nightsoul's Blessing"],
      'plunge@nightsoul': ['High Plunge (Nightsoul)', "Nightsoul's Blessing"],
      'skill@nightsoul': ["End Nightsoul's Blessing", "Nightsoul's Blessing"],
    },
    edit: 'normal1',
  },
}

const run = (c: VariantCase, frameData: FrameData = {}) => {
  const party = c.party ?? { [c.member]: c.element }
  const members = Object.keys(party) as CharacterKey[]
  return simulateRotation({
    rotation: parseRotation(
      c.text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { [c.member]: c.constellation ?? 0 },
    elements: party,
    repeats: 1,
    frameData,
  })
}
const own = (c: VariantCase, sim: ReturnType<typeof run>) =>
  sim.actions.filter((a) => a.characterKey === c.member && a.frameKey)
/** The button of a frame key (`normal3@musou`: normal) */
const kindOf = (key: string) =>
  key.startsWith('normal') ? 'normal' : key.startsWith('skill') ? 'skill' : key

describe('a mode or stance’s version of an action (Raiden to Zhongli)', () => {
  for (const [name, c] of Object.entries(cases))
    it(name, () => {
      const sim = run(c)
      expect(sim.warnings).toEqual([])
      const acts = own(c, sim)
      expect(acts.map((a) => a.frameKey)).toEqual(c.keys)
      const data = sim.actionData![c.member]!
      for (const a of acts) {
        const [base, version] = a.frameKey!.split('@')
        if (!version) {
          expect(a.variant).toBeUndefined()
          continue
        }
        const [label, mode] = c.versions[a.frameKey!]
        expect(a.variant).toEqual({
          key: version,
          label,
          ...(mode && { mode }),
        })
        // its own frame-data row, under its button
        expect(data[a.frameKey!]).toMatchObject({
          action: { kind: kindOf(base) },
          variant: { key: version },
        })
      }

      // an edit of the ordinary action leaves its versions' frames as they were
      const edited = own(
        c,
        run(c, {
          [c.member]: { [c.edit]: { frames: data[c.edit].frames + 30 } },
        })
      )
      expect(edited.map((a) => a.frameKey)).toEqual(c.keys)
      const versionFrames = (list: typeof acts) =>
        list.filter((a) => a.variant).map((a) => a.frames)
      expect(versionFrames(edited)).toEqual(versionFrames(acts))
      const first = acts.findIndex((a) => a.frameKey === c.edit)
      expect(edited[first].frames).toBe(acts[first].frames + 30)
    })
})
