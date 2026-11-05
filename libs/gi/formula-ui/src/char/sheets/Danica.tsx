import type { UISheet } from '@genshin-optimizer/game-opt/sheet-ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { conditionals, formulas } from '@genshin-optimizer/gi/formula'
import { st, stg } from '../../util'
import { charConditionalDocument } from '../charUiSheets'
import type { TalentSheetElementKey } from '../consts'
import { charTemplates } from '../util'

const key: CharacterKey = 'Danica'
const ct = charTemplates(key)
const formula = formulas.Danica
const cond = conditionals.Danica

const sheet: UISheet<TalentSheetElementKey> = {
  auto: ct.talentTem('auto', [
    { type: 'text', text: ct.chg('auto.fields.normal') },
    {
      type: 'fields',
      fields: [0, 1, 2, 3].map((i) => ({
        title: ct.chg(`auto.skillParams.${i}`),
        multi: i === 2 ? 2 : undefined,
        fieldRef: formula[`normal_${i}` as 'normal_0'].tag,
      })),
    },
    { type: 'text', text: ct.chg('auto.fields.charged') },
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('auto.skillParams.4'),
          fieldRef: formula.charged_spinning.tag,
        },
        {
          title: ct.chg('auto.skillParams.5'),
          fieldRef: formula.charged_final.tag,
        },
        {
          title: ct.chg('auto.skillParams.6'),
          unit: '/s',
          fieldRef: formula.charged_stam.tag,
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
        { title: ct.chg('skill.skillParams.0'), fieldRef: formula.skill.tag },
        {
          title: ct.chg('skill.skillParams.3'),
          fieldRef: formula.skill_coord.tag,
        },
        ...[0, 1, 2, 3].map((i) => ({
          title: ct.chg(`skill.skillParams.${5 + i}`),
          multi: i === 2 ? 2 : undefined,
          fieldRef: formula[`skill_anchor${i}` as 'skill_anchor0'].tag,
        })),
        {
          title: ct.chg('skill.skillParams.1'),
          fieldRef: formula.skill_entry.tag,
        },
        {
          title: ct.chg('skill.skillParams.2'),
          fieldRef: formula.skill_onField.tag,
        },
        { title: st('dmgAbsorption.none'), fieldRef: formula.skill_shield.tag },
        {
          title: st('dmgAbsorption.electro'),
          fieldRef: formula.skill_electroShield.tag,
        },
        {
          title: ct.chg('skill.skillParams.9'),
          unit: 's',
          fieldRef: formula.skill_anchorDuration.tag,
        },
        {
          title: ct.chg('skill.skillParams.10'),
          unit: 's',
          fieldRef: formula.skill_entryCd.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.skill_cd.tag },
      ],
    },
    charConditionalDocument(key, cond.anchor, { teamBuff: true }),
    charConditionalDocument(key, cond.maidForm, { teamBuff: true }),
  ]),
  burst: ct.talentTem('burst', [
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('burst.skillParams.0'),
          fieldRef: formula.burst_hit1.tag,
        },
        { title: ct.ch('hit1ScDmg'), fieldRef: formula.burst_hit1Sc.tag },
        {
          title: ct.chg('burst.skillParams.1'),
          fieldRef: formula.burst_hit234.tag,
        },
        {
          title: ct.chg('burst.skillParams.2'),
          fieldRef: formula.burst_hit5.tag,
        },
        { title: ct.ch('hit5ScDmg'), fieldRef: formula.burst_hit5Sc.tag },
        {
          title: ct.chg('burst.skillParams.6'),
          unit: 's',
          fieldRef: formula.burst_duration.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.burst_cd.tag },
        { title: stg('energyCost'), fieldRef: formula.burst_enerCost.tag },
      ],
    },
    charConditionalDocument(key, cond.burstEnhanced, { teamBuff: true }),
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
    charConditionalDocument(key, cond.a0StellarRadianceSc, {
      teamBuff: true,
      fields: [
        {
          title: st('elementalReaction.stellar.gainRadianceSc'),
          fieldValue: '',
        },
      ],
    }),
  ]),
  passive: ct.talentTem('passive'),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2', [
    charConditionalDocument(key, cond.c2Toast, {
      teamBuff: true,
      fields: [
        { title: ct.ch('c2ToastCond'), fieldRef: formula.c2Toast_dmgInc.tag },
      ],
    }),
    charConditionalDocument(key, cond.c2SelfToast, {
      fields: [
        {
          title: ct.ch('c2SelfToastCond'),
          fieldRef: formula.c2SelfToast_dmgInc.tag,
        },
      ],
    }),
  ]),
  constellation3: ct.talentTem('constellation3'),
  constellation4: ct.talentTem('constellation4'),
  constellation5: ct.talentTem('constellation5'),
  constellation6: ct.talentTem('constellation6'),
}

export default sheet
