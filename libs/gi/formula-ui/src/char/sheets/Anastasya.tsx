import type { UISheet } from '@genshin-optimizer/game-opt/sheet-ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { conditionals, formulas } from '@genshin-optimizer/gi/formula'
import { st, stg } from '../../util'
import { charConditionalDocument } from '../charUiSheets'
import type { TalentSheetElementKey } from '../consts'
import { charTemplates } from '../util'

const key: CharacterKey = 'Anastasya'
const ct = charTemplates(key)
const formula = formulas.Anastasya
const cond = conditionals.Anastasya
type F = keyof typeof formula
const f = (name: string) => formula[name as F].tag

const sheet: UISheet<TalentSheetElementKey> = {
  auto: ct.talentTem('auto', [
    { type: 'text', text: ct.chg('auto.fields.normal') },
    {
      type: 'fields',
      fields: [0, 1, 2, 3, 4].map((i) => ({
        title: ct.chg(`auto.skillParams.${i}`),
        multi: i === 2 ? 2 : i === 3 ? 3 : undefined,
        fieldRef: f(`normal_${i}`),
      })),
    },
    { type: 'text', text: ct.chg('auto.fields.charged') },
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('auto.skillParams.5'),
          fieldRef: formula.charged_aimed.tag,
        },
        {
          title: ct.chg('auto.skillParams.6'),
          fieldRef: formula.charged_full.tag,
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
        {
          title: ct.chg('skill.skillParams.0'),
          fieldRef: formula.skill_tap.tag,
        },
        {
          title: ct.chg('skill.skillParams.1'),
          fieldRef: formula.skill_hold.tag,
        },
        {
          title: ct.chg('skill.skillParams.2'),
          multi: 2,
          fieldRef: formula.skill_crown.tag,
        },
        { title: ct.ch('crownSc'), fieldRef: formula.skill_crownSc.tag },
        { title: ct.ch('crownSs'), fieldRef: formula.skill_crownSs.tag },
        ...[0, 1, 2, 3, 4].flatMap((i) => [
          {
            title: ct.chg(`skill.skillParams.${4 + i}`),
            multi: i === 1 ? 2 : i >= 3 ? 3 : undefined,
            fieldRef: f(`skill_honor${i}`),
          },
          { title: ct.ch(`honorSc.${i}`), fieldRef: f(`skill_honor${i}Sc`) },
          { title: ct.ch(`honorSs.${i}`), fieldRef: f(`skill_honor${i}Ss`) },
        ]),
        {
          title: ct.chg('skill.skillParams.14'),
          unit: 's',
          fieldRef: formula.skill_crownDuration.tag,
        },
        {
          title: ct.chg('skill.skillParams.15'),
          unit: 's',
          fieldRef: formula.skill_honorDuration.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.skill_cd.tag },
      ],
    },
    charConditionalDocument(key, cond.blessing, { teamBuff: true }),
    charConditionalDocument(key, cond.accolades, { teamBuff: true }),
  ]),
  burst: ct.talentTem('burst', [
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('burst.skillParams.0'),
          fieldRef: formula.burst_love.tag,
        },
        { title: ct.ch('burstCrownSc'), fieldRef: formula.burst_crownSc.tag },
        { title: ct.ch('burstCrownSs'), fieldRef: formula.burst_crownSs.tag },
        { title: ct.ch('triumphSc'), fieldRef: formula.burst_triumphSc.tag },
        { title: ct.ch('triumphSs'), fieldRef: formula.burst_triumphSs.tag },
        {
          title: ct.ch('evernightSc'),
          fieldRef: formula.burst_evernightSc.tag,
        },
        {
          title: ct.ch('evernightSs'),
          fieldRef: formula.burst_evernightSs.tag,
        },
        {
          title: ct.chg('burst.skillParams.5'),
          multi: 5,
          fieldRef: formula.burst_doom1.tag,
        },
        ...[0, 1, 2].flatMap((i) => [
          { title: ct.ch(`doomSc.${i}`), fieldRef: f(`burst_doom${i}Sc`) },
          { title: ct.ch(`doomSs.${i}`), fieldRef: f(`burst_doom${i}Ss`) },
        ]),
        {
          title: ct.chg('burst.skillParams.9'),
          unit: 's',
          fieldRef: formula.burst_loveDuration.tag,
        },
        {
          title: ct.chg('burst.skillParams.10'),
          unit: 's',
          fieldRef: formula.burst_honorDuration.tag,
        },
        { title: stg('cd'), unit: 's', fieldRef: formula.burst_cd.tag },
        { title: stg('energyCost'), fieldRef: formula.burst_enerCost.tag },
      ],
    },
    charConditionalDocument(key, cond.burstActive, { teamBuff: true }),
  ]),
  passive1: ct.talentTem('passive1'),
  passive2: ct.talentTem('passive2', [
    {
      type: 'fields',
      fields: [
        {
          title: ct.chg('passive2.name'),
          fieldRef: formula.a4_stellarswirl_mult_.tag,
        },
      ],
    },
  ]),
  passive3: ct.talentTem('passive3', [
    {
      type: 'fields',
      fields: [
        {
          title: st('elementalReaction.stellar.radiance'),
          fieldRef: formula.a0_stellarconduct_baseDmg_.tag,
        },
        {
          title: st('elementalReaction.stellar.radiance'),
          fieldRef: formula.a0_stellarswirl_baseDmg_.tag,
        },
      ],
    },
    charConditionalDocument(key, cond.a0StellarRadianceSc, { teamBuff: true }),
  ]),
  passive: ct.talentTem('passive'),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2'),
  constellation3: ct.talentTem('constellation3'),
  constellation4: ct.talentTem('constellation4'),
  constellation5: ct.talentTem('constellation5'),
  constellation6: ct.talentTem('constellation6', [
    {
      type: 'fields',
      fields: [
        { title: ct.ch('c6TriumphSc'), fieldRef: formula.c6_triumphSc.tag },
        { title: ct.ch('c6TriumphSs'), fieldRef: formula.c6_triumphSs.tag },
        { title: ct.ch('c6DoomSc'), fieldRef: formula.c6_doom3Sc.tag },
        { title: ct.ch('c6DoomSs'), fieldRef: formula.c6_doom3Ss.tag },
      ],
    },
  ]),
}

export default sheet
