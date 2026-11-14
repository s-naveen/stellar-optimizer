import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type FrameData,
  type RotationReactions,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

interface Case {
  members: CharacterKey[]
  text: string
  cons?: number
  reactions?: RotationReactions
  /** The member's frame keys, in order */
  keys: string[]
  /** Each version's label */
  labels: Record<string, string>
}

const cases: Record<string, Case> = {
  Anastasya: {
    members: ['Anastasya'],
    // the Honor Sealing ends 14 s after the Evernight: Doom's three attacks follow
    text: 'ana N2 hE N2 Q W15 E E E',
    keys: [
      'normal2',
      'skillHold',
      'normal2@honor',
      'burst@honor',
      'skill@doom1',
      'skill@doom2',
      'skill@doom3',
    ],
    labels: {
      'normal2@honor': 'Blessed Spear',
      'burst@honor': 'The Evernight Yields to Dawn',
      'skill@doom1': 'Palestar Edict: Doom 1-Hit',
      'skill@doom3': 'Palestar Edict: Doom 3-Hit',
    },
  },
  AratakiItto: {
    members: ['AratakiItto'],
    // N4 leaves 3 stacks: left, right, final, then Saichimonji
    text: 'itto N4 CA CA CA CA',
    keys: [
      'normal4',
      'charged@kesagiriLeft',
      'charged@kesagiriRight',
      'charged@kesagiriFinal',
      'charged',
    ],
    labels: {
      'charged@kesagiriLeft': 'Arataki Kesagiri Combo Slash (left)',
      'charged@kesagiriFinal': 'Arataki Kesagiri Final Slash',
    },
  },
  Chasca: {
    members: ['Chasca'],
    text: 'chasca N1 CA E N1 CA Q E',
    keys: [
      'normal1',
      'charged',
      'skill',
      'normal1@nightsoul',
      'charged@nightsoul',
      'burst@nightsoul',
      'skill@nightsoul',
    ],
    labels: {
      'normal1@nightsoul': 'Multitarget Fire (Tap)',
      'charged@nightsoul': 'Multitarget Fire (Hold)',
    },
  },
  Chiori: {
    members: ['Chiori', 'Bennett'],
    text: 'chiori E E',
    keys: ['skill', 'skill@tapestry'],
    labels: { 'skill@tapestry': 'Tapestry' },
  },
  Clorinde: {
    members: ['Clorinde'],
    text: 'clorinde N2 E N2 E Q',
    keys: [
      'normal2',
      'skill',
      'normal2@nightVigil',
      'skill@nightVigil',
      'burst@nightVigil',
    ],
    labels: {
      'normal2@nightVigil': 'Swift Hunt',
      'skill@nightVigil': 'Impale the Night',
    },
  },
  Columbina: {
    members: ['Columbina'],
    text: 'bina CA W2 CA',
    // Dew from 2 s on
    reactions: {
      onHit() {
        return
      },
      dewAt: (t) => (t >= 120 ? 3 : 0),
      consumeDewAt: (_t, n) => n,
    },
    keys: ['charged', 'charged@moondew'],
    labels: { 'charged@moondew': 'Moondew Cleanse' },
  },
  Cyno: {
    members: ['Cyno'],
    text: 'cyno N2 Q N2 CA P E',
    keys: [
      'normal2',
      'burst',
      'normal2@pactsworn',
      'charged@pactsworn',
      'plunge@pactsworn',
      'skill@pactsworn',
    ],
    labels: { 'skill@pactsworn': 'Mortuary Rite' },
  },
  Danica: {
    members: ['Danica'],
    // four Anchor attacks fill the Excitement
    text: 'danica N1 E N4 E',
    keys: ['normal1', 'skill', 'normal4@anchor', 'skill@battleMaid'],
    labels: {
      'normal4@anchor': 'Anchor Normal Attack',
      'skill@battleMaid': 'On-Field Skill E2',
    },
  },
  Dehya: {
    members: ['Dehya'],
    text: 'dehya E E Q N1 D J',
    keys: [
      'skill',
      'skill@rangingFlame',
      'burst',
      'normal1@lioness',
      'dash@lioness',
      'jump@lioness',
    ],
    labels: {
      'skill@rangingFlame': 'Ranging Flame',
      'normal1@lioness': 'Roaring Barrage',
      'jump@lioness': 'Incineration Drive',
    },
  },
  Diluc: {
    members: ['Diluc'],
    text: 'diluc E E E',
    keys: ['skill', 'skill@onslaught2', 'skill@onslaught3'],
    labels: { 'skill@onslaught3': 'Searing Onslaught 3-Hit' },
  },
  Diona: {
    members: ['Diona'],
    cons: 4,
    text: 'diona CA Q CA',
    keys: ['charged', 'burst', 'charged@c4'],
    labels: { 'charged@c4': 'Fully-Charged Aimed Shot (C4)' },
  },
  Durin: {
    members: ['Durin'],
    text: 'durin E N1 E E',
    keys: ['skill', 'normal1@darkness', 'skill', 'skill@purity'],
    labels: {
      'normal1@darkness': 'Transmutation: Denial of Darkness',
      'skill@purity': 'Transmutation: Confirmation of Purity',
    },
  },
  Faruzan: {
    members: ['Faruzan'],
    text: 'faruzan CA E CA CA',
    keys: ['charged', 'skill', 'charged@gale', 'charged'],
    labels: { 'charged@gale': 'Hurricane Arrow' },
  },
  Fischl: {
    members: ['Fischl'],
    text: 'fischl E E',
    keys: ['skill', 'skill@recast'],
    labels: { 'skill@recast': 'Nightrider (recall Oz)' },
  },
  Flins: {
    members: ['Flins'],
    text: 'flins N1 E E Q',
    keys: ['normal1', 'skill', 'skill@manifestFlame', 'burst@symphony'],
    labels: {
      'skill@manifestFlame': 'Northland Spearstorm',
      'burst@symphony': 'Thunderous Symphony',
    },
  },
  Freminet: {
    members: ['Freminet'],
    text: 'freminet E N4 N1 W10 E N2 E W10 E N4 E',
    keys: [
      'skill',
      'normal4',
      'normal1@shatteringLv4',
      'skill',
      'normal2',
      'skill@shattering',
      'skill',
      'normal4',
      'skill@shatteringLv4',
    ],
    labels: {
      'skill@shattering': 'Shattering Pressure',
      'skill@shatteringLv4': 'Shattering Pressure (Level 4)',
    },
  },
  Furina: {
    members: ['Furina'],
    text: 'furina N1 CA E',
    keys: ['normal1', 'charged', 'skill@pneuma'],
    labels: { 'skill@pneuma': 'Singer of Many Waters' },
  },
  Gaming: {
    members: ['Gaming'],
    text: 'gaming E P P',
    keys: ['skill', 'plunge@cloudstrider', 'plunge'],
    labels: {
      'plunge@cloudstrider': 'Plunging Attack: Charmed Cloudstrider',
    },
  },
  Ganyu: {
    members: ['Ganyu'],
    cons: 6,
    text: 'ganyu CA E CA CA',
    keys: ['charged', 'skill', 'charged@c6', 'charged'],
    labels: { 'charged@c6': 'Frostflake Arrow (C6, no charging)' },
  },
  HuTao: {
    members: ['HuTao'],
    text: 'hutao CA P E N1 CA P',
    keys: [
      'charged',
      'plunge',
      'skill',
      'normal1@paramita',
      'charged@paramita',
      'plunge@paramita',
    ],
    labels: { 'charged@paramita': 'Charged Attack' },
  },
}

const play = (c: Case, frameData: FrameData = {}) =>
  simulateRotation({
    rotation: parseRotation(
      c.text,
      c.members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: c.members,
    elements: Object.fromEntries(
      c.members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: Object.fromEntries(c.members.map((m) => [m, c.cons ?? 0])),
    reactions: c.reactions,
    repeats: 1,
    keep: 'all',
    frameData,
  })

describe('the kits’ mode and stance versions (A–H)', () => {
  for (const [key, c] of Object.entries(cases)) {
    const member = key as CharacterKey
    const own = (sim: ReturnType<typeof play>) =>
      sim.actions.filter((a) => a.characterKey === member)
    it(`plays ${member}'s versions with frame data of their own`, () => {
      const sim = play(c)
      const actions = own(sim)
      expect(actions.map((a) => a.frameKey)).toEqual(c.keys)
      for (const [frameKey, label] of Object.entries(c.labels))
        expect(
          actions.find((a) => a.frameKey === frameKey)?.variant?.label
        ).toBe(label)
      const data = sim.actionData![member]!
      for (const frameKey of c.keys.filter((k) => k.includes('@'))) {
        const [, version] = frameKey.split('@')
        expect(data[frameKey]).toMatchObject({ variant: { key: version } })
      }
      // an edit of each version's ordinary action leaves the versions' frames alone
      const bases = [
        ...new Set(
          c.keys.filter((k) => k.includes('@')).map((k) => k.split('@')[0])
        ),
      ]
      const edited = play(c, {
        [member]: Object.fromEntries(bases.map((b) => [b, { frames: 77 }])),
      })
      const versions = (sim: ReturnType<typeof play>) =>
        own(sim)
          .filter((a) => a.variant)
          .map((a) => `${a.frameKey} ${a.frames}`)
      expect(own(edited).map((a) => a.frameKey)).toEqual(c.keys)
      expect(versions(edited)).toEqual(versions(sim))
    })
  }
})
