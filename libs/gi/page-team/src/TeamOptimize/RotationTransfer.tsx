import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import {
  applyTeamRotation,
  parseTeamRotation,
  teamRotationExport,
} from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import {
  Box,
  Button,
  CardContent,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { focusSx, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * Export (to the clipboard) and import (pasted) the team's whole rotation as one JSON: every
 * member's attacks, the rotation time and who is on the field
 */
const transferSx = {
  color: 'text.secondary',
  borderColor: 'divider',
  whiteSpace: 'nowrap',
  px: 1.25,
  ...quickSx,
  ...focusSx,
  '&:hover': { color: 'text.primary', borderColor: tokens.hairlineStrong },
  '& .MuiButton-startIcon': { mr: 0.5 },
  '& .MuiButton-startIcon svg': { fontSize: 16 },
} as const

export function RotationTransfer({
  members,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const keys = members.map((m) => m.characterKey)
  const hasAttacks = keys.some((k) => teamOpt.attacks[k]?.length)
  // the export button's short-lived note: copied, or why not
  const [note, setNote] = useState<string>()
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(undefined), 1800)
    return () => clearTimeout(timer)
  }, [note])
  const [show, onShow, onHide] = useBoolState()

  const copy = () =>
    navigator.clipboard
      .writeText(JSON.stringify(teamRotationExport(teamOpt, keys)))
      .then(() =>
        setNote(t('teamOpt.transfer.copied', 'Rotation copied as JSON'))
      )
      .catch((e) =>
        setNote(
          `${t('teamOpt.transfer.copyFailed', 'Could not copy')}: ${e?.message ?? e}`
        )
      )

  return (
    <Box sx={{ display: 'flex', gap: 0.75 }}>
      <Tooltip
        open={!!note}
        title={note ?? ''}
        placement="top"
        disableHoverListener
        disableFocusListener
        disableTouchListener
      >
        <span>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<FileUploadIcon />}
            onClick={copy}
            disabled={!hasAttacks}
            sx={transferSx}
          >
            {t('teamOpt.transfer.export', 'Export')}
          </Button>
        </span>
      </Tooltip>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        startIcon={<FileDownloadIcon />}
        onClick={onShow}
        disabled={disabled}
        sx={transferSx}
      >
        {t('teamOpt.transfer.import', 'Import')}
      </Button>
      {show && (
        <ImportModal
          members={members}
          onClose={onHide}
          onImport={(rotation) =>
            setTeamOpt((o) => {
              applyTeamRotation(o, rotation, keys)
            })
          }
        />
      )}
    </Box>
  )
}

function ImportModal({
  members,
  onClose,
  onImport,
}: {
  members: TeamOptMember[]
  onClose: () => void
  onImport: (
    rotation: NonNullable<ReturnType<typeof parseTeamRotation>>
  ) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [text, setText] = useState('')
  const rotation = useMemo(
    () => (text.trim() ? parseTeamRotation(text) : undefined),
    [text]
  )
  const keys = members.map((m) => m.characterKey)
  const inTeam = rotation ? keys.filter((k) => rotation.attacks[k]?.length) : []
  const skipped = rotation
    ? (Object.keys(rotation.attacks) as CharacterKey[]).filter(
        (k) => !keys.includes(k)
      )
    : []
  const usable = !!rotation && (inTeam.length > 0 || !!rotation.rotationTime)
  const names = (list: CharacterKey[]) =>
    list.map((k, i) => (
      <span key={k}>
        {i > 0 && ', '}
        <CharacterName characterKey={k} gender={gender} />
      </span>
    ))

  return (
    <ModalWrapper open onClose={onClose}>
      <CardThemed>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography
            component="h2"
            sx={{
              ...type.title,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {t('teamOpt.transfer.title', 'Import a team rotation')}
            <InfoTooltipInline
              title={t(
                'teamOpt.transfer.desc',
                'Paste a rotation exported from Team optimize. The members in it get its attacks; the others keep theirs.'
              )}
            />
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            autoFocus
            label={t('teamOpt.transfer.label', 'Rotation JSON')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={!!text.trim() && !rotation}
            helperText={
              text.trim() && !rotation
                ? t(
                    'teamOpt.transfer.invalid',
                    'This is not a team rotation export.'
                  )
                : undefined
            }
          />
          {rotation && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              {inTeam.map((k) => (
                <Box
                  key={k}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <MemberAvatar characterKey={k} size={22} />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    <CharacterName characterKey={k} gender={gender} />
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('teamOpt.transfer.attacks', {
                      defaultValue: '{{count}} attacks',
                      count: rotation.attacks[k]?.length ?? 0,
                    })}
                  </Typography>
                </Box>
              ))}
              {!!rotation.rotationTime && (
                <Typography variant="body2" color="text.secondary">
                  {t('teamOpt.transfer.time', {
                    defaultValue: 'Rotation time: {{time}} s',
                    time: rotation.rotationTime,
                  })}
                </Typography>
              )}
              {!!skipped.length && (
                <Typography variant="body2" color="warning.main">
                  {t('teamOpt.transfer.skipped', 'Not in this team, skipped:')}{' '}
                  {names(skipped)}
                </Typography>
              )}
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button variant="text" color="inherit" onClick={onClose}>
              {t('teamOpt.transfer.cancel', 'Cancel')}
            </Button>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              disabled={!usable}
              sx={usable ? giCtaSx : undefined}
              onClick={() => {
                if (!rotation) return
                onImport(rotation)
                onClose()
              }}
            >
              {t('teamOpt.transfer.import', 'Import')}
            </Button>
          </Box>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
