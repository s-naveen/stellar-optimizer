import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import type { ButtonProps } from '@mui/material'
import {
  Alert,
  Box,
  Button,
  CardContent,
  Divider,
  IconButton,
  LinearProgress,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SubstatToggle } from '../../artifact/SubstatToggle'
import { useBuildCardData } from './buildCardData'
import { CARD_HEIGHT, CARD_WIDTH, renderBuildCard } from './renderBuildCard'

const canCopyImage = () =>
  typeof window !== 'undefined' &&
  'ClipboardItem' in window &&
  !!navigator.clipboard?.write

/**
 * "Build card": a shareable PNG of the character's build, from the page's DataContext (the
 * equipped build on the character page; on a team page, the loadout's build), with the
 * character's own stats
 */
export function BuildCardButton({
  disabledReason,
  compact = false,
  ...props
}: ButtonProps & {
  /** why there is no card to make (the button is then disabled, with this as its tooltip) */
  disabledReason?: string
  /** only the icon (its name as the tooltip), for narrow screens */
  compact?: boolean
}) {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)
  const label = t('buildCard.button', 'Build card')
  const button = (
    <Button
      variant="outlined"
      color="neutral400"
      size="small"
      startIcon={compact ? undefined : <ImageOutlinedIcon />}
      aria-label={compact ? label : undefined}
      onClick={() => setOpen(true)}
      disabled={!!disabledReason}
      {...props}
      sx={[
        compact ? { minWidth: 0, px: 1 } : {},
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    >
      {compact ? <ImageOutlinedIcon /> : label}
    </Button>
  )
  const tooltip = disabledReason ?? (compact ? label : undefined)
  return (
    <>
      {tooltip ? (
        <Tooltip title={tooltip}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {open && <BuildCardDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function BuildCardDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['ui', 'artifact'])
  const database = useDatabase()
  const data = useBuildCardData()
  const render = useMemo(() => data && (() => renderBuildCard(data)), [data])
  return (
    <CardImageDialog
      title={t('buildCard.title', 'Build card')}
      alt={t('buildCard.alt', {
        defaultValue: '{{name}}’s build',
        name: data?.name,
      })}
      fileName={data ? `${safeName(data.characterKey)}-build` : 'build'}
      aspectRatio={`${CARD_WIDTH} / ${CARD_HEIGHT}`}
      render={render}
      onClose={onClose}
    >
      {data && (
        <>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {t('artifact:efficiencyFilter.title')}
          </Typography>
          <SubstatToggle
            quiet
            selectedKeys={data.rvKeys}
            onChange={(rvFilter) =>
              database.charMeta.set(data.characterKey, { rvFilter })
            }
          />
        </>
      )}
    </CardImageDialog>
  )
}

/**
 * A picture to share: its preview, then any controls (`children`), then Copy image and Download
 * PNG. `render` draws it, again whenever it changes: the last picture stays up meanwhile, and a
 * quick series of changes is drawn once.
 */
export function CardImageDialog({
  title,
  alt,
  fileName,
  aspectRatio,
  render,
  format = 'png',
  onClose,
  children,
}: {
  title: string
  alt: string
  /** without its date and extension: "Furina-build" saves as "Furina-build-2026-11-09.png" */
  fileName: string
  /** the picture's usual proportions, for its placeholder: "1600 / 958" */
  aspectRatio: string
  /** undefined while its data is not ready */
  render: (() => Promise<HTMLCanvasElement>) | undefined
  /**
   * the file to download: a PNG, or a JPEG for a large picture (a fraction of the size, to stay
   * shareable). Copying always copies a PNG (the clipboard takes no other images).
   */
  format?: 'png' | 'jpeg'
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation('ui')
  const [png, setPng] = useState<
    { blob: Blob; url: string; canvas: HTMLCanvasElement } | undefined
  >()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)

  // the shown image's URL, released when replaced or closed
  const urlRef = useRef<string | undefined>()
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    []
  )

  useEffect(() => {
    if (!render) return
    let cancelled = false
    setBusy(true)
    setError(undefined)
    const timer = setTimeout(
      () =>
        render()
          .then(
            (canvas) =>
              new Promise<[HTMLCanvasElement, Blob | null]>((resolve) =>
                canvas.toBlob(
                  (blob) => resolve([canvas, blob]),
                  `image/${format}`,
                  0.92
                )
              )
          )
          .then(([canvas, blob]) => {
            if (cancelled) return
            if (!blob) throw new Error('The image could not be made')
            const url = URL.createObjectURL(blob)
            if (urlRef.current) URL.revokeObjectURL(urlRef.current)
            urlRef.current = url
            setPng({ blob, url, canvas })
            setBusy(false)
          })
          .catch((e) => {
            if (cancelled) return
            setError(String(e?.message ?? e))
            setBusy(false)
          }),
      urlRef.current ? 250 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [render, format])

  const download = () => {
    if (!png) return
    const a = document.createElement('a')
    a.href = png.url
    a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.${format === 'jpeg' ? 'jpg' : 'png'}`
    a.click()
  }
  const copy = async () => {
    if (!png) return
    try {
      const blob =
        format === 'png'
          ? png.blob
          : await new Promise<Blob>((resolve, reject) =>
              png.canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('No image'))),
                'image/png'
              )
            )
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
      aria-labelledby="card-image-title"
    >
      <CardThemed>
        <CardContent
          sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}
        >
          <Typography
            variant="h6"
            component="h2"
            id="card-image-title"
            sx={{ flexGrow: 1 }}
          >
            {title}
          </Typography>
          <IconButton
            onClick={onClose}
            size="small"
            aria-label={t('buildCard.close', 'Close')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </CardContent>
        <Divider />
        <CardContent>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : png ? (
            <Box sx={{ position: 'relative' }}>
              <Box
                component="img"
                src={png.url}
                alt={alt}
                sx={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  borderRadius: 1,
                  opacity: busy ? 0.7 : 1,
                  transition: 'opacity 150ms',
                }}
              />
              {busy && (
                <LinearProgress
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    borderRadius: 1,
                  }}
                />
              )}
            </Box>
          ) : (
            <Skeleton
              variant="rounded"
              sx={{ width: '100%', height: 'auto', aspectRatio }}
            />
          )}
        </CardContent>
        {children && (
          <>
            <Divider />
            <CardContent
              sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
            >
              {children}
            </CardContent>
          </>
        )}
        <Divider />
        <CardContent
          sx={{
            display: 'flex',
            gap: 1,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            py: 1.5,
            '&:last-child': { pb: 1.5 },
          }}
        >
          {canCopyImage() && (
            <Button
              variant="outlined"
              color="neutral400"
              startIcon={<ContentCopyIcon />}
              onClick={copy}
              disabled={!png || busy}
            >
              {copied
                ? t('buildCard.copied', 'Copied')
                : t('buildCard.copy', 'Copy image')}
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={download}
            disabled={!png || busy}
          >
            {format === 'jpeg'
              ? t('buildCard.downloadJpg', 'Download JPG')
              : t('buildCard.download', 'Download PNG')}
          </Button>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}

/** A name as a file name: letters and digits only ("Furina", "SandroneMityaDanica") */
export function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9]+/g, '') || 'card'
}
