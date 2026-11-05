import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import {
  useBoolState,
  useMediaQueryUp,
} from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  PageHeader,
  ShowingAndSortOptionSelect,
  useInfScroll,
} from '@genshin-optimizer/common/ui'
import { filterFunction, sortFunction } from '@genshin-optimizer/common/util'
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDisplayArtifact } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import {
  type ArtifactSortKey,
  artifactSortKeys,
} from '@genshin-optimizer/gi/schema'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import {
  AddArtInfo,
  ArtifactCard,
  ArtifactEditor,
} from '@genshin-optimizer/gi/ui'
import {
  artifactFilterConfigs,
  artifactSortConfigs,
  artifactSortMap,
} from '@genshin-optimizer/gi/util'
import AddIcon from '@mui/icons-material/Add'
import DifferenceIcon from '@mui/icons-material/Difference'
import { Box, Button, CardContent, Skeleton } from '@mui/material'
import { Suspense, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ArtifactFilter, { ArtifactBulkActions } from './ArtifactFilter'
import { ArtifactGuideButton } from './ArtifactGuide'
import DupModal from './DupModal'

const numToShowMap = { xs: 5, sm: 6, md: 12, lg: 12, xl: 12 }

export default function PageArtifact() {
  const database = useDatabase()
  // Request every namespace the artifact cards use at once; otherwise each artifact set's
  // translations are fetched in its own network round trip while the cards render.
  useMemo(
    () =>
      preloadNamespaces([
        'artifact',
        'artifactNames_gen',
        'statKey_gen',
        ...database.arts.values.map(({ setKey }) => `artifact_${setKey}_gen`),
      ]),
    [database]
  )
  const { t } = useTranslation(['artifact', 'ui'])
  const artifactDisplayState = useDisplayArtifact()

  const [artifactIdToEdit, setArtifactIdToEdit] = useState<string | undefined>()

  const [showDup, onShowDup, onHideDup] = useBoolState(false)

  const brPt = useMediaQueryUp()

  const { sortType, effFilter, ascending } = artifactDisplayState

  const effFilterSet = useMemo(
    () => new Set(effFilter),
    [effFilter]
  ) as Set<SubstatKey>

  const noArtifact = !database.arts.values.length
  const sortConfigs = useMemo(
    () => artifactSortConfigs(effFilterSet),
    [effFilterSet]
  )
  const filterConfigs = useMemo(
    () => artifactFilterConfigs({ effFilterSet: effFilterSet }),
    [effFilterSet]
  )
  const deferredArtifactDisplayState = useDeferredValue(artifactDisplayState)
  const allArts = useDataManagerValues(database.arts)
  const totalArtNum = allArts.length

  const filteredArtIds = useMemo(() => {
    const {
      sortType = artifactSortKeys[0],
      ascending = false,
      filterOption,
    } = deferredArtifactDisplayState
    return allArts
      .filter(filterFunction(filterOption, filterConfigs))
      .sort(
        sortFunction(artifactSortMap[sortType] ?? [], ascending, sortConfigs)
      )
      .map((art) => art.id)
  }, [deferredArtifactDisplayState, allArts, filterConfigs, sortConfigs])

  const { numShow, setTriggerElement } = useInfScroll(
    numToShowMap[brPt],
    filteredArtIds.length
  )
  const artifactIdsToShow = useMemo(
    () => filteredArtIds.slice(0, numShow),
    [filteredArtIds, numShow]
  )
  //for pagination
  const totalShowing =
    filteredArtIds.length !== totalArtNum
      ? `${filteredArtIds.length}/${totalArtNum}`
      : `${totalArtNum}`
  const showingTextProps = {
    numShowing: artifactIdsToShow.length,
    total: totalShowing,
    t: t,
    namespace: 'artifact',
  }
  const sortByButtonProps = {
    sortKeys: [...artifactSortKeys],
    value: sortType,
    onChange: (sortType: ArtifactSortKey) =>
      database.displayArtifact.set({ sortType }),
    ascending: ascending,
    onChangeAsc: (ascending: boolean) =>
      database.displayArtifact.set({ ascending }),
  }
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <Suspense fallback={false}>
        <ArtifactEditor
          artifactIdToEdit={artifactIdToEdit}
          cancelEdit={() => setArtifactIdToEdit(undefined)}
          allowUpload
          allowEmpty
        />
      </Suspense>
      <Suspense fallback={false}>
        <DupModal
          show={showDup}
          onHide={onHideDup}
          setArtifactIdToEdit={setArtifactIdToEdit}
        />
      </Suspense>
      <PageHeader
        title={t('ui:tabs.artifacts')}
        count={totalArtNum}
        actions={
          <>
            <ArtifactGuideButton />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<DifferenceIcon />}
              onClick={onShowDup}
            >
              {t('header.duplicates')}
            </Button>
            <Button
              sx={giCtaSx}
              startIcon={<AddIcon />}
              onClick={() => setArtifactIdToEdit('new')}
            >
              {t('header.add')}
            </Button>
          </>
        }
      />

      {noArtifact && <AddArtInfo />}

      <ArtifactFilter
        numShowing={filteredArtIds.length}
        total={totalArtNum}
        artifactIds={filteredArtIds}
      />
      <CardThemed>
        <CardContent
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            // "Showing x of y" on the left, sort + bulk actions on the right
            '& > p': { mr: 'auto' },
          }}
        >
          <ShowingAndSortOptionSelect
            showingTextProps={showingTextProps}
            sortByButtonProps={sortByButtonProps}
          />
          <ArtifactBulkActions artifactIds={filteredArtIds} />
        </CardContent>
      </CardThemed>
      <Suspense
        fallback={
          <Skeleton
            variant="rectangular"
            sx={{ width: '100%', height: '100%', minHeight: 5000 }}
          />
        }
      >
        {/* auto-fill: a wider page gets more cards per row, not wider cards */}
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 1, md: 2 },
            gridTemplateColumns:
              'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
          }}
        >
          {artifactIdsToShow.map((artId) => (
            <Box key={artId} sx={{ minWidth: 0 }}>
              <ArtifactCard
                artifactId={artId}
                effFilter={effFilterSet}
                onDelete={() => database.arts.remove(artId)}
                onEdit={() => setArtifactIdToEdit(artId)}
                setLocation={(location) =>
                  database.arts.set(artId, { location })
                }
                onLockToggle={() =>
                  database.arts.set(artId, ({ lock }) => ({ lock: !lock }))
                }
              />
            </Box>
          ))}
        </Box>
        {filteredArtIds.length !== artifactIdsToShow.length && (
          <Skeleton
            ref={(node) => {
              if (!node) return
              setTriggerElement(node)
            }}
            sx={{ borderRadius: 1 }}
            variant="rectangular"
            width="100%"
            height={100}
          />
        )}
      </Suspense>
    </Box>
  )
}
