import type { UISheet } from '@genshin-optimizer/game-opt/sheet-ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { conditionals, formulas } from '@genshin-optimizer/gi/formula'
import { stg } from '../../util'
import { charConditionalDocument } from '../charUiSheets'
import type { TalentSheetElementKey } from '../consts'
import { charTemplates } from '../util'

const key: CharacterKey = 'Mitya'
const ct = charTemplates(key)
const formula = formulas.Mitya
const cond = conditionals.Mitya

const sheet: UISheet<TalentSheetElementKey> = {
  auto: ct.talentTem('auto', [
    { type: 'text', text: ct.chg('auto.fields.normal') },
    {
      type: 'fields',
      fields: [
        { title: ct.chg('auto.skillParams.0'), fieldRef: formula.normal_0.tag },
        { title: ct.chg('auto.skillParams.1'), fieldRef: formula.normal_1.tag },
        { title: ct.chg('auto.skillParams.2'), fieldRef: formula.normal_2.tag },
      ],
    },
    { type: 'text', text: ct.chg('auto.fields.charged') },
    {
      type: 'fields',
      fields: [
        { title: ct.chg('auto.skillParams.3'), fieldRef: formula.charged.tag },
        {
          title: ct.chg('auto.skillParams.4'),
          fieldRef: formula.charged_stam.tag,
        },
        {
          title: ct.chg('auto.skillParams.7'),
          fieldRef: formula.charged_gradientDmg.tag,
        },
        {
          title: ct.chg('auto.skillParams.8'),
          subtitle: ct.ch('perBeacon'),
          fieldRef: formula.charged_gradientStellarDmg.tag,
        },
      ],
    },
    { type: 'text', text: ct.chg('auto.fields.plunging') },
    {
      type: 'fields',
      fields: [
        { title: stg('plunging.dmg'), fieldRef: formula.plunging_dmg.tag },
        { title: stg('plunging.low'), fieldRef: formula.plunging_low.tag },
        { title: stg('plunging.high'), fieldRef: formula.plunging_high.tag },
      ],
    },
  ]),
  skill: ct.talentTem('skill', [
    {
      type: 'fields',
      fields: [
        { title: ct.chg('skill.skillParams.0'), fieldRef: formula.skill_tap.tag },
        {
          title: ct.chg('skill.skillParams.1'),
          fieldRef: formula.skill_hold.tag,
        },
        {
          title: ct.chg('skill.skillParams.2'),
          fieldRef: formula.skill_steadyCore.tag,
        },
        {
          title: ct.chg('skill.skillParams.3'),
          fieldRef: formula.skill_steadyConsume.tag,
        },
        {
          title: ct.chg('skill.skillParams.4'),
          subtitle: ct.ch('perBeacon'),
          fieldRef: formula.skill_steadyDetonate.tag,
        },
        {
          title: ct.chg('skill.skillParams.5'),
          unit: 's',
          fieldRef: formula.skill_duration.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.skill_cd.tag },
      ],
    },
    charConditionalDocument(key, cond.detectionCore, { teamBuff: true }),
    charConditionalDocument(key, cond.gradientBeacons, { teamBuff: true }),
  ]),
  burst: ct.talentTem('burst', [
    {
      type: 'fields',
      fields: [
        { title: ct.chg('burst.skillParams.0'), fieldRef: formula.burst.tag },
        {
          title: ct.chg('burst.skillParams.1'),
          fieldRef: formula.burst_beacons.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.burst_cd.tag },
        { title: stg('energyCost'), fieldRef: formula.burst_enerCost.tag },
      ],
    },
  ]),
  passive1: ct.talentTem('passive1'),
  passive2: ct.talentTem('passive2', [
    charConditionalDocument(key, cond.a4Stacks),
  ]),
  passive3: ct.talentTem('passive3', [
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('passive3.name'),
          fieldRef: formula.a0_stellarconduct_baseDmg_.tag,
        },
      ],
    },
  ]),
  passive: ct.talentTem('passive'),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2'),
  constellation3: ct.talentTem('constellation3'),
  constellation4: ct.talentTem('constellation4', [
    {
      type: 'fields',
      fields: [{ title: ct.ch('c4Dmg'), fieldRef: formula.c4.tag }],
    },
  ]),
  constellation5: ct.talentTem('constellation5'),
  constellation6: ct.talentTem('constellation6'),
}

export default sheet
