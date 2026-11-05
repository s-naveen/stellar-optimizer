import { useBoolState } from '@genshin-optimizer/common/react-util'
import { TeamCharacterContext } from '@genshin-optimizer/gi/db-ui'
import {
  DataContext,
  FieldDisplayList,
  NodeFieldDisplay,
} from '@genshin-optimizer/gi/ui'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { uiInput as input } from '@genshin-optimizer/gi/wr'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import BonusStatsModal from '../../../BonusStatsModal'
import { SettingsCard, SettingsCardButton } from './SettingsCard'
export default function BonusStatsCard() {
  const { t } = useTranslation(['page_character_optimize', 'common'])
  const [show, onShow, onHide] = useBoolState()
  const {
    teamChar: { bonusStats },
  } = useContext(TeamCharacterContext)
  const { data } = useContext(DataContext)
  const bonusStatsKeys = Object.keys(bonusStats)
  const nodes = bonusStatsKeys.map((k) =>
    data.get(input.customBonus[k] as NumNode)
  )
  return (
    <>
      <BonusStatsModal open={show} onClose={onHide} />
      <SettingsCard
        title={t('bonusStats.title')}
        action={
          <SettingsCardButton onClick={onShow}>
            {t('common:edit')}
          </SettingsCardButton>
        }
      >
        {!!nodes.length && (
          <FieldDisplayList bgt="light">
            {nodes.map((n) => (
              <NodeFieldDisplay key={JSON.stringify(n.info)} calcRes={n} />
            ))}
          </FieldDisplayList>
        )}
      </SettingsCard>
    </>
  )
}
