import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBGender } from '@genshin-optimizer/gi/db-ui'
import { Box } from '@mui/material'

/**
 * A member's portrait in a fixed rounded box: sits inside a card's header (the side icons of the
 * team pills poke out above their row).
 */
export function MemberAvatar({
  characterKey,
  size = 32,
}: {
  characterKey: CharacterKey
  size?: number
}) {
  const gender = useDBGender()
  return (
    <Box
      component="img"
      src={characterAsset(characterKey, 'icon', gender)}
      alt=""
      aria-hidden
      sx={(theme) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        objectFit: 'cover',
        backgroundColor: theme.palette.contentLight.main,
      })}
    />
  )
}
