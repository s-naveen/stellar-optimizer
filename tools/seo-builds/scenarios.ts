import type { Ctx } from './conditionals'

/**
 * Computed builds: the situation each character is ranked in and which hits count. A character can
 * have several (e.g. one per team type, told apart by `variant`).
 * Keep `variant`/`label`/`target` in plain English, they are shown on the character's landing page.
 */
export type Scenario = {
  charKey: string
  /** for characters with several scenarios: what tells them apart, e.g. "Stellar Swirl team" */
  variant?: string
  /** the situation, shown as "Ranked for: …" */
  label: string
  /** what is maximised */
  target: string
  /** display paths summed into the optimization target, or a filter over `display.<talent>` keys */
  targets: string[][] | { talent: string; match: RegExp }
  /** the character's own conditionals */
  conditional: Record<string, Record<string, string>>
  ctx: Ctx
}

export const scenarios: Scenario[] = [
  {
    charKey: 'Mitya',
    label:
      'Overloaded Detection Core, in Radiance: Stellar-Conduct, consuming Gradient Beacons with Gradient Detonation',
    target:
      "one Gradient Beacon's Stellar-Conduct hit from Gradient Detonation (his special Charged Attack)",
    targets: [['charged', 'gradientStellarDmg']],
    conditional: {
      Mitya: {
        detectionCore: 'overloaded',
        gradientBeacons: '3',
        // CRIT Rate for 15s per Gradient Beacon created: new beacons keep coming in this setup
        a4Stacks: '4',
        a0StellarRadianceSc: 'on',
      },
    },
    ctx: {
      attacks: ['charged', 'skill', 'burst'],
      auras: ['electro', 'cryo', 'superconduct', 'stellarconduct'],
    },
  },
  {
    charKey: 'Danica',
    label:
      'Battle Maid on-field, in Radiance: Stellar-Conduct, after her Elemental Burst',
    target: 'On-Field Skill E2 damage (Stellar-Conduct)',
    targets: [['skill', 'onFieldDmg']],
    conditional: {
      Danica: {
        anchor: 'on',
        maidForm: 'battle',
        burstEnhanced: 'on',
        a4Stacks: '3',
        a0StellarRadianceSc: 'on',
      },
    },
    ctx: {
      attacks: ['normal', 'skill', 'burst'],
      auras: ['electro', 'cryo', 'superconduct', 'stellarconduct'],
    },
  },
  {
    charKey: 'Anastasya',
    variant: 'Stellar-Conduct team',
    label:
      'Blessing of Honor on-field, in Radiance: Stellar-Conduct, during The Evernight Yields to Dawn',
    target:
      'one full Honor Normal Attack chain, including its Stellar-Conduct hits',
    targets: { talent: 'skill', match: /^honor\d+(Sc)?$/ },
    conditional: {
      Anastasya: {
        blessing: 'honor',
        burstActive: 'on',
        a0StellarRadianceSc: 'on',
        accolades: 'honorSeal',
      },
    },
    ctx: {
      attacks: ['normal', 'skill', 'burst'],
      auras: ['cryo', 'electro', 'superconduct', 'stellarconduct'],
    },
  },
  {
    charKey: 'Anastasya',
    variant: 'Stellar Swirl team',
    label:
      'Blessing of Honor on-field, in Radiance: Stellar Swirl, during The Evernight Yields to Dawn',
    target:
      'one full Honor Normal Attack chain, including its Stellar Swirl hits',
    targets: { talent: 'skill', match: /^honor\d+(Ss)?$/ },
    conditional: {
      Anastasya: {
        blessing: 'honor',
        burstActive: 'on',
        // Radiance: Stellar Swirl, after a teammate's Swirl on Cryo
        a0StellarRadianceSc: 'ss',
        accolades: 'honorSeal',
      },
    },
    // the Anemo teammate triggers the Stellar Swirls, so "after triggering" effects stay off
    ctx: {
      attacks: ['normal', 'skill', 'burst'],
      auras: ['cryo', 'anemo', 'stellarswirl'],
    },
  },
]
