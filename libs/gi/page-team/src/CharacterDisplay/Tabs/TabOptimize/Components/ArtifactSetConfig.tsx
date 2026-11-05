import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { deepClone, isIn, objKeyMap } from '@genshin-optimizer/common/util'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  SetNum,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import {
  allArtifactSetExclusionKeys,
  handleArtSetExclusion,
} from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useDatabase,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import { Translate } from '@genshin-optimizer/gi/i18n'
import { getArtSheet } from '@genshin-optimizer/gi/sheets'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { dataContextObj } from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  DataContext,
  SetEffectDisplay,
} from '@genshin-optimizer/gi/ui'
import { UIData } from '@genshin-optimizer/gi/uidata'
import { setKeysByRarities } from '@genshin-optimizer/gi/util'
import { constant } from '@genshin-optimizer/gi/wr'
import { allNonstackBuffs } from '@genshin-optimizer/gi/wr-types'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SearchIcon from '@mui/icons-material/Search'
import TuneIcon from '@mui/icons-material/Tune'
import {
  Box,
  Button,
  CardContent,
  Collapse,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  memo,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

type View = 'owned' | 'all' | 'effects'
type SetInfo = {
  setKey: ArtifactSetKey
  slotCount: Record<ArtifactSlotKey, number>
  slotsOwned: number
  pieces: number
}

// Sets the optimizer can filter (the 1-piece "Prayers" sets are not part of builds).
const configurableSetKeys = Object.entries(setKeysByRarities)
  .reverse()
  .flatMap(([, sets]) => sets)
  .filter(
    (key) => !key.includes('Prayers') && isIn(allArtifactSetExclusionKeys, key)
  )

/** Set bonuses (2 / 4 pieces) whose effect has a condition the user can turn on. */
function getCondNums(setKey: ArtifactSetKey): (2 | 4)[] {
  const { setEffects } = getArtSheet(setKey)
  return ([2, 4] as const).filter((num) =>
    setEffects[num]?.document.some((doc) => 'states' in doc)
  )
}
const condNumsBySet = Object.fromEntries(
  configurableSetKeys.map((setKey) => [setKey, getCondNums(setKey)])
) as Record<ArtifactSetKey, (2 | 4)[]>

const sectionLabelSx = {
  display: 'block',
  color: 'text.secondary',
  fontSize: '0.8125rem',
  fontWeight: 600,
  mb: 1,
} as const

/**
 * Which artifact set bonuses the optimizer may use (per set, plus "mixed pieces" builds), and the
 * conditional set effects to apply. A summary card opens a dialog with one row per set.
 */
export default function ArtifactSetConfig({
  disabled,
}: {
  disabled?: boolean
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifactNames_gen'])
  const dataContext = useContext(DataContext)
  const database = useDatabase()
  const {
    teamChar: { key: charKey, conditional, optConfigId },
    teamCharId,
  } = useContext(TeamCharacterContext)
  const { artSetExclusion } = useOptConfig(optConfigId)!
  const [open, setOpen] = useState(false)
  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])

  const total = configurableSetKeys.length
  const isExcluded = useCallback(
    (setKey: ArtifactSetKey, num: 2 | 4) =>
      !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(num),
    [artSetExclusion]
  )
  const allowed2 = configurableSetKeys.filter((k) => !isExcluded(k, 2))
  const allowed4 = configurableSetKeys.filter((k) => !isExcluded(k, 4))
  const allowRainbow2 = !artSetExclusion.rainbow?.includes(2)
  const allowRainbow4 = !artSetExclusion.rainbow?.includes(4)

  const condCountBySet = useMemo(
    () =>
      Object.fromEntries(
        allArtifactSetKeys.map((setKey) => [
          setKey,
          Object.keys(conditional[setKey] ?? {}).length,
        ])
      ) as Record<ArtifactSetKey, number>,
    [conditional]
  )
  const condTotal = Object.values(condCountBySet).filter(Boolean).length

  const describe = (allowed: ArtifactSetKey[]) =>
    allowed.length === total
      ? t('artSetConfig.summary.anySet')
      : allowed.length === 0
        ? t('artSetConfig.summary.noSet')
        : allowed.length === 1
          ? t('artSetConfig.summary.onlySet', {
              name: t(`artifactNames_gen:${allowed[0]}`),
            })
          : t('artSetConfig.summary.someSets', {
              count: allowed.length,
              total,
            })
  const mixedText =
    allowRainbow2 && allowRainbow4
      ? t('artSetConfig.summary.mixedBoth')
      : allowRainbow2
        ? t('artSetConfig.summary.mixedOnly3')
        : allowRainbow4
          ? t('artSetConfig.summary.mixedOnly5')
          : t('artSetConfig.summary.mixedNone')

  return (
    <>
      <CardThemed bgt="light">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>
              {t('artSetConfig.heading')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<TuneIcon />}
              onClick={onOpen}
              disabled={disabled}
            >
              {t('artSetConfig.edit')}
            </Button>
          </Box>
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              columnGap: 2,
              rowGap: 0.5,
              '& dt': { color: 'text.secondary' },
              '& dd': { m: 0, textAlign: 'right' },
            }}
          >
            <SummaryRow
              label={t('artSetConfig.summary.fourPc')}
              value={describe(allowed4)}
            />
            <SummaryRow
              label={t('artSetConfig.summary.twoPc')}
              value={describe(allowed2)}
            />
            <SummaryRow
              label={t('artSetConfig.summary.mixed')}
              value={mixedText}
            />
            <SummaryRow
              label={t('artSetConfig.summary.effects')}
              value={
                condTotal
                  ? t('artSetConfig.summary.effectsOn', { count: condTotal })
                  : t('artSetConfig.summary.effectsNone')
              }
            />
          </Box>
        </CardContent>
      </CardThemed>

      <ModalWrapper
        open={open}
        onClose={onClose}
        containerProps={{ maxWidth: 'lg' }}
      >
        {/* overflow: clip (not hidden) so the toolbar and footer can stick while the dialog scrolls */}
        <CardThemed sx={{ overflow: 'clip' }}>
          <Suspense
            fallback={
              <Skeleton variant="rectangular" width="100%" height={600} />
            }
          >
            <SetConfigDialog
              charKey={charKey}
              dataContext={dataContext}
              teamCharId={teamCharId}
              optConfigId={optConfigId}
              artSetExclusion={artSetExclusion}
              allowed2={allowed2.length}
              allowed4={allowed4.length}
              allowRainbow2={allowRainbow2}
              allowRainbow4={allowRainbow4}
              condCountBySet={condCountBySet}
              condTotal={condTotal}
              conditional={conditional}
              onClose={onClose}
              database={database}
            />
          </Suspense>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}

function SummaryRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="body2">
        {label}
      </Typography>
      <Typography component="dd" variant="body2">
        {value}
      </Typography>
    </>
  )
}

function SetConfigDialog({
  charKey,
  dataContext,
  teamCharId,
  optConfigId,
  artSetExclusion,
  allowed2,
  allowed4,
  allowRainbow2,
  allowRainbow4,
  condCountBySet,
  condTotal,
  conditional,
  onClose,
  database,
}: {
  charKey: string
  dataContext: dataContextObj
  teamCharId: string
  optConfigId: string
  artSetExclusion: ArtSetExclusion
  allowed2: number
  allowed4: number
  allowRainbow2: boolean
  allowRainbow4: boolean
  condCountBySet: Record<ArtifactSetKey, number>
  condTotal: number
  conditional: Record<string, unknown>
  onClose: () => void
  database: ReturnType<typeof useDatabase>
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifactNames_gen'])
  const total = configurableSetKeys.length

  // How many pieces of each set the user owns, per slot.
  const allArts = useDataManagerValues(database.arts)
  const setInfos = useMemo(() => {
    const counts = objKeyMap(configurableSetKeys, () =>
      objKeyMap(allArtifactSlotKeys, () => 0)
    )
    for (const art of allArts) {
      const c = counts[art.setKey as keyof typeof counts]
      if (c) c[art.slotKey]++
    }
    const order = new Map(configurableSetKeys.map((k, i) => [k, i]))
    return configurableSetKeys
      .map((setKey): SetInfo => {
        const slotCount = counts[setKey as keyof typeof counts]
        const values = Object.values(slotCount)
        return {
          setKey,
          slotCount,
          slotsOwned: values.filter(Boolean).length,
          pieces: values.reduce((a, b) => a + b, 0),
        }
      })
      .sort(
        (a, b) =>
          +(b.slotsOwned >= 2) - +(a.slotsOwned >= 2) ||
          b.pieces - a.pieces ||
          order.get(a.setKey)! - order.get(b.setKey)!
      )
  }, [allArts])
  const ownedCount = setInfos.filter((s) => s.slotsOwned >= 2).length

  const [view, setView] = useState<View>(ownedCount ? 'owned' : 'all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const effectsSetCount = configurableSetKeys.filter(
    (k) => condCountBySet[k]
  ).length
  const shownSets = setInfos.filter(({ setKey, slotsOwned }) => {
    // a search looks through every set, whatever the view
    if (deferredSearch)
      return t(`artifactNames_gen:${setKey}`)
        .toLowerCase()
        .includes(deferredSearch)
    if (view === 'owned') return slotsOwned >= 2
    if (view === 'effects') return !!condCountBySet[setKey]
    return true
  })

  const [expanded, setExpanded] = useState<ArtifactSetKey[]>([])
  const toggleExpanded = useCallback(
    (setKey: ArtifactSetKey) =>
      setExpanded((e) =>
        e.includes(setKey) ? e.filter((k) => k !== setKey) : [...e, setKey]
      ),
    []
  )

  const saveExclusion = useCallback(
    (next: ArtSetExclusion) =>
      database.optConfigs.set(optConfigId, { artSetExclusion: next }),
    [database, optConfigId]
  )
  const toggleSet = useCallback(
    (setKey: ArtifactSetKey, num: 2 | 4) =>
      saveExclusion(
        handleArtSetExclusion(
          artSetExclusion,
          setKey as keyof ArtSetExclusion,
          num
        )
      ),
    [artSetExclusion, saveExclusion]
  )
  const setAll = useCallback(
    (num: 2 | 4, exclude: boolean, except?: ArtifactSetKey) => {
      const next = deepClone(artSetExclusion)
      for (const setKey of configurableSetKeys) {
        const key = setKey as keyof ArtSetExclusion
        const rest = (next[key] ?? []).filter((n) => n !== num)
        const excludeThis = setKey === except ? !exclude : exclude
        if (excludeThis) next[key] = [...rest, num]
        else if (rest.length) next[key] = rest
        else delete next[key]
      }
      saveExclusion(next)
    },
    [artSetExclusion, saveExclusion]
  )
  const onlyThis4 = useCallback(
    (setKey: ArtifactSetKey) => setAll(4, true, setKey),
    [setAll]
  )
  const toggleRainbow = (num: 2 | 4) =>
    saveExclusion(handleArtSetExclusion(artSetExclusion, 'rainbow', num))
  const resetArtConds = useCallback(() => {
    const tconditional = Object.fromEntries(
      Object.entries(conditional).filter(
        ([k]) => !allArtifactSetKeys.includes(k as ArtifactSetKey)
      )
    )
    database.teamChars.set(teamCharId, (teamChar) => {
      teamChar.conditional = tconditional
    })
  }, [database, teamCharId, conditional])

  // Shows every conditional set effect as if the full set were equipped.
  const fakeDataContextObj = useMemo(
    () => ({
      ...dataContext,
      data: new UIData(
        {
          ...dataContext.data.data[0],
          artSet: objKeyMap(allArtifactSetKeys, () => constant(4)),
          nonStacking: objKeyMap(allNonstackBuffs, () => constant(charKey)),
        },
        undefined
      ),
    }),
    [charKey, dataContext]
  )

  return (
    <>
      {/* Header */}
      <Box
        sx={{ display: 'flex', gap: 2, px: { xs: 2, md: 3 }, pt: 2.5, pb: 2 }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h2">
            {t('artSetConfig.heading')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t('artSetConfig.description')}
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          aria-label={t('artSetConfig.close')}
          sx={{ alignSelf: 'flex-start' }}
        >
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Mixed pieces ("rainbow" builds) */}
      <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
        <Typography component="span" sx={sectionLabelSx}>
          {t('artSetConfig.mixed.title')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 1,
          }}
        >
          <MixedOption
            pattern="aaxxx"
            label={t('artSetConfig.mixed.three')}
            alias={t('artSetConfig.mixed.threeAlias')}
            checked={allowRainbow2}
            onChange={() => toggleRainbow(2)}
          />
          <MixedOption
            pattern="xxxxx"
            label={t('artSetConfig.mixed.five')}
            alias={t('artSetConfig.mixed.fiveAlias')}
            checked={allowRainbow4}
            onChange={() => toggleRainbow(4)}
          />
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}
        >
          <PieceDiagram pattern="a" /> {t('artSetConfig.mixed.legendSet')}
          <PieceDiagram pattern="x" /> {t('artSetConfig.mixed.legendMixed')}
        </Typography>
      </Box>

      {/* Toolbar: sticks to the top while the list scrolls (not on phones, where it is tall) */}
      <Box
        sx={{
          position: { xs: 'static', sm: 'sticky' },
          top: 0,
          zIndex: 2,
          bgcolor: 'contentNormal.main',
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          px: { xs: 2, md: 3 },
          py: 1.5,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('artSetConfig.search')}
          inputProps={{ 'aria-label': t('artSetConfig.search') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ flex: '1 1 180px', maxWidth: 280 }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, v: View | null) => v && setView(v)}
          disabled={!!search}
          aria-label={t('artSetConfig.view.label')}
        >
          <ToggleButton value="owned">
            {t('artSetConfig.view.owned')}
            <Count>{ownedCount}</Count>
          </ToggleButton>
          <ToggleButton value="all">
            {t('artSetConfig.view.all')}
            <Count>{total}</Count>
          </ToggleButton>
          <ToggleButton value="effects">
            {t('artSetConfig.view.effects')}
            <Count>{effectsSetCount}</Count>
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <BulkControl
          label={t('artSetConfig.bulk.label2')}
          allowed={allowed2}
          total={total}
          onAll={() => setAll(2, false)}
          onNone={() => setAll(2, true)}
        />
        <BulkControl
          label={t('artSetConfig.bulk.label4')}
          allowed={allowed4}
          total={total}
          onAll={() => setAll(4, false)}
          onNone={() => setAll(4, true)}
        />
      </Box>

      {/* One row per set */}
      <Box role="list">
        {shownSets.map(({ setKey, slotCount, slotsOwned, pieces }) => (
          <SetRow
            key={setKey}
            setKey={setKey}
            slotCount={slotCount}
            slotsOwned={slotsOwned}
            pieces={pieces}
            excluded2={
              !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(2)
            }
            excluded4={
              !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(4)
            }
            condCount={condCountBySet[setKey]}
            expanded={expanded.includes(setKey)}
            onToggleExpanded={toggleExpanded}
            onToggle={toggleSet}
            onOnly4={onlyThis4}
            fakeDataContextObj={fakeDataContextObj}
          />
        ))}
        {!shownSets.length && (
          <Typography
            color="text.secondary"
            sx={{ px: { xs: 2, md: 3 }, py: 4, textAlign: 'center' }}
          >
            {t('artSetConfig.empty')}
          </Typography>
        )}
      </Box>

      {/* Footer: sticks to the bottom */}
      <Box
        sx={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          bgcolor: 'contentNormal.main',
          borderTop: 1,
          borderColor: 'divider',
          px: { xs: 2, md: 3 },
          py: 1.5,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('artSetConfig.footer.summary', {
            four: allowed4,
            two: allowed2,
            total,
          })}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="text"
          color="error"
          disabled={!condTotal}
          onClick={resetArtConds}
        >
          {t('artSetConfig.footer.resetEffects', { count: condTotal })}
        </Button>
        <Button variant="contained" sx={giCtaSx} onClick={onClose}>
          {t('artSetConfig.footer.done')}
        </Button>
      </Box>
    </>
  )
}

function Count({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ ml: 0.75, color: 'text.secondary', fontSize: '0.75rem' }}
    >
      {children}
    </Box>
  )
}

function BulkControl({
  label,
  allowed,
  total,
  onAll,
  onNone,
}: {
  label: ReactNode
  allowed: number
  total: number
  onAll: () => void
  onNone: () => void
}) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
        {label}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        disabled={allowed === total}
        onClick={onAll}
      >
        {t('artSetConfig.bulk.all')}
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        disabled={allowed === 0}
        onClick={onNone}
      >
        {t('artSetConfig.bulk.none')}
      </Button>
    </Box>
  )
}

/** Five small squares: a = pieces of one set, x = mixed pieces from any set. */
function PieceDiagram({ pattern }: { pattern: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-flex', gap: '3px' }}
    >
      {[...pattern].map((p, i) => (
        <Box
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, never-reordered 5-square picture
          key={i}
          component="span"
          sx={{
            width: 10,
            height: 10,
            borderRadius: '3px',
            ...(p === 'a'
              ? { bgcolor: 'primary.main' }
              : { border: 1, borderColor: 'text.disabled' }),
          }}
        />
      ))}
    </Box>
  )
}

function MixedOption({
  pattern,
  label,
  alias,
  checked,
  onChange,
}: {
  pattern: string
  label: string
  alias: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <CardThemed bgt="light" sx={{ px: 1.5, py: 0.75 }}>
      <FormControlLabel
        sx={{ m: 0, width: '100%', gap: 1 }}
        control={<Switch checked={checked} onChange={onChange} />}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <PieceDiagram pattern={pattern} />
            <Box>
              <Typography variant="body2">{label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {alias}
              </Typography>
            </Box>
          </Box>
        }
      />
    </CardThemed>
  )
}

const SetRow = memo(function SetRow({
  setKey,
  slotCount,
  slotsOwned,
  pieces,
  excluded2,
  excluded4,
  condCount,
  expanded,
  onToggleExpanded,
  onToggle,
  onOnly4,
  fakeDataContextObj,
}: {
  setKey: ArtifactSetKey
  slotCount: Record<ArtifactSlotKey, number>
  slotsOwned: number
  pieces: number
  excluded2: boolean
  excluded4: boolean
  condCount: number
  expanded: boolean
  onToggleExpanded: (setKey: ArtifactSetKey) => void
  onToggle: (setKey: ArtifactSetKey, num: 2 | 4) => void
  onOnly4: (setKey: ArtifactSetKey) => void
  fakeDataContextObj: dataContextObj
}) {
  const { t } = useTranslation([
    'page_character_optimize',
    'artifactNames_gen',
    'artifact',
  ])
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const condNums = condNumsBySet[setKey]
  const rarities = getArtSetStat(setKey).rarities.filter((r) => r >= 3)
  const name = t(`artifactNames_gen:${setKey}`)
  const panelId = `set-effects-${setKey}`

  return (
    <Box
      role="listitem"
      sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1,
          px: { xs: 2, md: 3 },
          py: 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flex: '1 1 260px',
            minWidth: 0,
            // sets without two different pieces can't give a bonus
            opacity: slotsOwned >= 2 ? 1 : 0.55,
          }}
        >
          <Box
            component="img"
            src={artifactDefIcon(setKey)}
            alt=""
            loading="lazy"
            sx={{ width: 44, height: 44, flexShrink: 0 }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
              }}
            >
              <Box
                component="span"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <ArtifactSetName setKey={setKey} />
              </Box>
              <InfoTooltipInline title={<SetBonusText setKey={setKey} />} />
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1,
                color: 'text.secondary',
                fontSize: '0.75rem',
              }}
            >
              <span>{rarities.map((r) => `${r}★`).join(' · ')}</span>
              <Tooltip
                title={allArtifactSlotKeys
                  .map((s) => `${t(`artifact:slotName.${s}`)} ${slotCount[s]}`)
                  .join(' · ')}
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  {allArtifactSlotKeys.map((s) => (
                    <SlotIcon
                      key={s}
                      slotKey={s}
                      iconProps={{
                        sx: {
                          fontSize: 15,
                          color: slotCount[s]
                            ? 'text.primary'
                            : 'text.disabled',
                        },
                      }}
                    />
                  ))}
                  <span>{t('artSetConfig.row.pieces', { count: pieces })}</span>
                </Box>
              </Tooltip>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PieceSwitch
            label={t('artSetConfig.row.twoPc')}
            ariaLabel={t('artSetConfig.row.allow', { name, num: 2 })}
            checked={!excluded2}
            onChange={() => onToggle(setKey, 2)}
          />
          <PieceSwitch
            label={t('artSetConfig.row.fourPc')}
            ariaLabel={t('artSetConfig.row.allow', { name, num: 4 })}
            checked={!excluded4}
            onChange={() => onToggle(setKey, 4)}
          />
          <Box sx={{ width: 128, display: 'flex', justifyContent: 'flex-end' }}>
            {!!condNums.length && (
              <Button
                size="small"
                variant={condCount ? 'contained' : 'text'}
                color={condCount ? 'primary' : 'inherit'}
                onClick={() => onToggleExpanded(setKey)}
                aria-expanded={expanded}
                aria-controls={panelId}
                endIcon={
                  <ExpandMoreIcon
                    sx={{
                      transform: expanded ? 'rotate(180deg)' : undefined,
                      transition: 'transform 150ms',
                    }}
                  />
                }
              >
                {condCount
                  ? t('artSetConfig.row.effectsOn', { count: condCount })
                  : t('artSetConfig.row.effects')}
              </Button>
            )}
          </Box>
          <IconButton
            size="small"
            aria-label={t('artSetConfig.row.more', { name })}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null)
                onOnly4(setKey)
              }}
            >
              {t('artSetConfig.row.only4')}
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {!!condNums.length && (
        <Collapse in={expanded} unmountOnExit>
          <Box
            id={panelId}
            sx={{
              px: { xs: 2, md: 3 },
              pb: 2,
              pl: { md: 10.5 },
              display: 'grid',
              gap: 2,
            }}
          >
            <DataContext.Provider value={fakeDataContextObj}>
              {condNums.map((num) => {
                // a 2-piece effect also applies to 4-piece builds
                const off = num === 2 ? excluded2 && excluded4 : excluded4
                return (
                  <Box key={num}>
                    <Typography component="span" sx={sectionLabelSx}>
                      {t('artSetConfig.row.effectOf', { num })}
                      {off &&
                        ` · ${t('artSetConfig.row.excludedNote', { num })}`}
                    </Typography>
                    <Suspense fallback={<Skeleton height={48} />}>
                      <SetEffectDisplay
                        setKey={setKey}
                        setNumKey={num as SetNum}
                        hideHeader
                        conditionalsOnly
                        disabled={off}
                      />
                    </Suspense>
                  </Box>
                )
              })}
            </DataContext.Provider>
          </Box>
        </Collapse>
      )}
    </Box>
  )
})

function PieceSwitch({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string
  ariaLabel: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <FormControlLabel
      sx={{ m: 0, gap: 0.25 }}
      labelPlacement="start"
      label={
        <Typography
          variant="body2"
          color={checked ? 'text.primary' : 'text.secondary'}
        >
          {label}
        </Typography>
      }
      control={
        <Switch
          size="small"
          checked={checked}
          onChange={onChange}
          inputProps={{ 'aria-label': ariaLabel }}
        />
      }
    />
  )
}

function SetBonusText({ setKey }: { setKey: ArtifactSetKey }) {
  const { t } = useTranslation('sheet')
  return (
    <Suspense
      fallback={<Skeleton variant="rectangular" width={300} height={120} />}
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {([2, 4] as const).map((num) => (
          <Box key={num}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t(`${num}set`)}
            </Typography>
            <Typography variant="body2">
              <Translate
                ns={`artifact_${setKey}_gen`}
                key18={`setEffects.${num}`}
              />
            </Typography>
          </Box>
        ))}
      </Box>
    </Suspense>
  )
}
