import { PageHeader } from '@genshin-optimizer/common/ui'
import { Box } from '@mui/material'
import { useTranslation } from 'react-i18next'
import EXPCalc from './EXPCalc'
import ResinCounter from './ResinCounter'
import TeyvatTime from './TeyvatTime'

export default function PageTools() {
  const { t } = useTranslation('ui')
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <PageHeader title={t('tabs.tools')} />
      <TeyvatTime />
      <ResinCounter />
      <EXPCalc />
    </Box>
  )
}
