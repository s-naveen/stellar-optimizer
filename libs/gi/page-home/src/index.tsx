import { Box } from '@mui/material'
import GettingStartedCard from './GettingStartedCard'
import InventoryCard from './InventoryCard'

/** Home is a dashboard: the setup checklist for new users, then the inventory and recent teams. */
export default function PageHome() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        pt: { xs: 1.5, md: 3 },
        pb: 4,
      }}
    >
      <GettingStartedCard />
      <InventoryCard />
    </Box>
  )
}
