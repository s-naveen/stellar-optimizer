import { useDataManagerKeys } from '@genshin-optimizer/common/database-ui'
import { AnvilIcon } from '@genshin-optimizer/common/svgicons'
import {
  isPlainLeftClick,
  useOptimisticValue,
} from '@genshin-optimizer/common/ui'
import { shouldShowDevComponents } from '@genshin-optimizer/common/util'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { FlowerIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
import ArticleIcon from '@mui/icons-material/Article'
import BookIcon from '@mui/icons-material/Book'
import ConstructionIcon from '@mui/icons-material/Construction'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import GroupsIcon from '@mui/icons-material/Groups'
import MenuIcon from '@mui/icons-material/Menu'
import PeopleIcon from '@mui/icons-material/People'
import ScannerIcon from '@mui/icons-material/Scanner'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import {
  AppBar,
  alpha,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Skeleton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { ReactNode } from 'react'
import { createContext, Suspense, useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useMatch } from 'react-router-dom'
import goLogo from './go_logo.svg'

type NavEntry = {
  i18Key: string
  icon: ReactNode
  to: string
  value: string
  count?: ReactNode
}
// who you play → what they wield and wear → how they team up
const primaryNav: NavEntry[] = [
  {
    i18Key: 'tabs.characters',
    icon: <PeopleIcon />,
    to: '/characters',
    value: 'characters',
    count: <CharacterCount />,
  },
  {
    i18Key: 'tabs.weapons',
    icon: <AnvilIcon />,
    to: '/weapons',
    value: 'weapons',
    count: <WeaponCount />,
  },
  {
    i18Key: 'tabs.artifacts',
    icon: <FlowerIcon />,
    to: '/artifacts',
    value: 'artifacts',
    count: <ArtifactCount />,
  },
  {
    i18Key: 'tabs.teams',
    icon: <GroupsIcon />,
    to: '/teams',
    value: 'teams',
    count: <TeamCount />,
  },
]
// reference pages: in the Settings menu on desktop, after the inventory in the mobile drawer
const secondaryNav: NavEntry[] = [
  {
    i18Key: 'tabs.archive',
    icon: <BookIcon />,
    to: '/archive',
    value: 'archive',
  },
  {
    i18Key: 'tabs.tools',
    icon: <ConstructionIcon />,
    to: '/tools',
    value: 'tools',
  },
  {
    i18Key: 'tabs.scanner',
    icon: <ScannerIcon />,
    to: '/scanner',
    value: 'scanner',
  },
  { i18Key: 'tabs.doc', icon: <ArticleIcon />, to: '/doc', value: 'doc' },
]
const settingsNav: NavEntry = {
  i18Key: 'tabs.setting',
  icon: <SettingsIcon />,
  to: '/setting',
  value: 'setting',
}
/** The desktop bar's Settings menu: Settings first, then the reference pages. */
const menuNav: NavEntry[] = [settingsNav, ...secondaryNav]

const { gold, goldLight, parchment, hairline, hairlineStrong } = giTokens

/**
 * Marks a clicked nav entry as the current page at once (see HeaderContent): the page itself renders
 * in the navigation's transition.
 */
const SelectNavContext = createContext<(value: string) => void>(() => {})

/** Inventory size next to a nav item: a quiet pill, so the labels stay the first thing you read. */
function NavCount({ count }: { count: number }) {
  return (
    <Box
      component="span"
      className="nav-count"
      sx={{
        minWidth: 20,
        px: 0.75,
        borderRadius: 999,
        bgcolor: alpha(parchment, 0.08),
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: '18px',
        textAlign: 'center',
      }}
    >
      {count}
    </Box>
  )
}
function ArtifactCount() {
  const database = useDatabase()
  return <NavCount count={useDataManagerKeys(database.arts).length} />
}
function CharacterCount() {
  const database = useDatabase()
  return <NavCount count={useDataManagerKeys(database.chars).length} />
}
function TeamCount() {
  const database = useDatabase()
  return <NavCount count={useDataManagerKeys(database.teams).length} />
}
function WeaponCount() {
  const database = useDatabase()
  return <NavCount count={useDataManagerKeys(database.weapons).length} />
}

function DBChip() {
  const { name } = useDBMeta()
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        height: 24,
        borderRadius: 999,
        border: `1px solid ${hairlineStrong}`,
        color: 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        '& .MuiSvgIcon-root': { fontSize: 14 },
      }}
    >
      <StorageIcon />
      {name}
    </Box>
  )
}

/** One nav link: a pill that turns gold when it is the current page. */
function navItemSx(active: boolean) {
  return {
    height: 36,
    minWidth: 0,
    px: 1.25,
    gap: 0.75,
    borderRadius: 999,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: active ? goldLight : 'text.secondary',
    bgcolor: active ? alpha(gold, 0.14) : 'transparent',
    '& .MuiSvgIcon-root': { fontSize: 20 },
    '& .nav-count': active
      ? { bgcolor: alpha(gold, 0.2), color: goldLight }
      : { color: 'text.secondary' },
    '&:hover': {
      color: active ? goldLight : 'text.primary',
      bgcolor: active ? alpha(gold, 0.2) : alpha(parchment, 0.06),
    },
  } as const
}

function NavItem({
  entry,
  active,
  showLabel,
  onClick,
  suffix,
  block = false,
}: {
  entry: NavEntry
  active: boolean
  showLabel: boolean
  onClick?: () => void
  suffix?: ReactNode
  /** full-width, left-aligned (the mobile drawer) */
  block?: boolean
}) {
  const { t } = useTranslation('ui')
  const select = useContext(SelectNavContext)
  const label = t(entry.i18Key)
  const link = (
    <Button
      variant="text"
      color="inherit"
      component={RouterLink}
      to={entry.to}
      onClick={(e) => {
        if (isPlainLeftClick(e)) select(entry.value)
        onClick?.()
      }}
      aria-current={active ? 'page' : undefined}
      aria-label={showLabel ? undefined : label}
      sx={[
        navItemSx(active),
        block && { justifyContent: 'flex-start', width: '100%', height: 44 },
      ]}
    >
      {entry.icon}
      {showLabel && <span>{label}</span>}
      {entry.count}
      {suffix}
    </Button>
  )
  return showLabel ? link : <Tooltip title={label}>{link}</Tooltip>
}

/**
 * The end of the desktop bar: one Settings pill that opens a menu with the active database, Settings
 * and the reference pages. Gold while any of those pages is open.
 */
function SettingsMenu({
  currentTab,
  showLabel,
}: {
  currentTab: string
  showLabel: boolean
}) {
  const { t } = useTranslation('ui')
  const select = useContext(SelectNavContext)
  const { name: dbName } = useDBMeta()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  // the tooltip would otherwise stay over the open menu until the pointer moves
  const [hintOpen, setHintOpen] = useState(false)
  const open = !!anchorEl
  const close = () => setAnchorEl(null)
  const active = menuNav.some(({ value }) => value === currentTab)
  const label = t(settingsNav.i18Key)
  const item = (entry: NavEntry) => {
    const current = currentTab === entry.value
    return (
      <MenuItem
        key={entry.value}
        component={RouterLink}
        to={entry.to}
        onClick={(e) => {
          if (isPlainLeftClick(e)) select(entry.value)
          close()
        }}
        selected={current}
        aria-current={current ? 'page' : undefined}
      >
        <ListItemIcon>{entry.icon}</ListItemIcon>
        <ListItemText>{t(entry.i18Key)}</ListItemText>
      </MenuItem>
    )
  }
  return (
    <>
      <Tooltip
        // only needed when the pill is just the icon
        title={showLabel ? '' : label}
        open={hintOpen && !open}
        onOpen={() => setHintOpen(true)}
        onClose={() => setHintOpen(false)}
      >
        <Button
          variant="text"
          color="inherit"
          id="settings-menu-button"
          aria-haspopup="menu"
          aria-controls={open ? 'settings-menu' : undefined}
          aria-expanded={open ? 'true' : undefined}
          aria-label={showLabel ? undefined : label}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={[
            navItemSx(active),
            open &&
              !active && {
                color: 'text.primary',
                bgcolor: alpha(parchment, 0.06),
              },
          ]}
        >
          {settingsNav.icon}
          {showLabel && <span>{label}</span>}
          <ExpandMoreIcon
            sx={{
              fontSize: '18px !important',
              ml: -0.25,
              transition: 'transform 150ms',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
          />
        </Button>
      </Tooltip>
      <Menu
        id="settings-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 200 } } }}
        MenuListProps={{
          'aria-labelledby': 'settings-menu-button',
          sx: {
            '& .MuiMenuItem-root': { gap: 0.25, minHeight: 40 },
            '& .MuiListItemIcon-root': { color: 'text.secondary' },
            '& .Mui-selected, & .Mui-selected .MuiListItemIcon-root': {
              color: goldLight,
            },
          },
        }}
      >
        <ListSubheader
          sx={{
            position: 'static',
            bgcolor: 'transparent',
            display: 'flex',
            alignItems: 'center',
            // lined up with the items' icon and label below
            px: 2.5,
            pt: 0.75,
            pb: 1,
            lineHeight: 1.4,
          }}
        >
          <ListItemIcon sx={{ minWidth: 38 }}>
            <StorageIcon />
          </ListItemIcon>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {t('activeDatabase')}
            </Typography>
            <Typography
              variant="body2"
              noWrap
              sx={{ fontWeight: 600, color: 'text.primary' }}
            >
              {dbName}
            </Typography>
          </Box>
        </ListSubheader>
        <Divider sx={{ my: 0.5 }} />
        {menuNav.map(item)}
      </Menu>
    </>
  )
}

function Brand({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation('ui')
  const select = useContext(SelectNavContext)
  return (
    <Box
      component={RouterLink}
      to="/"
      onClick={(e) => {
        if (isPlainLeftClick(e)) select('')
        onClick?.()
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        pr: 1,
        borderRadius: 2,
        color: 'text.primary',
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      {/* the logo: gold orbit + polestar mark with the serif wordmark (outlined, no font file) */}
      <Box
        component="img"
        src={goLogo}
        alt={t('pageTitle')}
        sx={{ height: 22, width: 'auto', display: 'block' }}
      />
      {shouldShowDevComponents && (
        <Box
          component="span"
          sx={{
            px: 0.75,
            borderRadius: 1,
            bgcolor: alpha(gold, 0.14),
            color: gold,
            fontSize: '0.75rem',
            fontWeight: 700,
            lineHeight: '20px',
          }}
        >
          Dev
        </Box>
      )}
    </Box>
  )
}

const barSx = {
  top: 0,
  // translucent, so the page reads as continuing under the bar while scrolling
  bgcolor: alpha(giTokens.inkDeep, 0.78),
  backdropFilter: 'saturate(140%) blur(14px)',
  borderBottom: `1px solid ${hairline}`,
  backgroundImage: 'none',
} as const

export default function Header({ anchor }: { anchor: string }) {
  return (
    <Suspense fallback={<Skeleton variant="rectangular" height={56} />}>
      <HeaderContent anchor={anchor} />
    </Suspense>
  )
}

function HeaderContent({ anchor }: { anchor: string }) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const {
    params: { currentTab: routeTab },
  } = useMatch({ path: '/:currentTab', end: false }) ?? {
    params: { currentTab: '' },
  }
  // a clicked entry is the current page at once; the page renders in the navigation's transition
  const [currentTab, select] = useOptimisticValue(routeTab ?? '')
  return (
    <SelectNavContext.Provider value={select}>
      {isMobile ? (
        <MobileHeader anchor={anchor} currentTab={currentTab} />
      ) : (
        <DesktopHeader anchor={anchor} currentTab={currentTab} />
      )}
    </SelectNavContext.Provider>
  )
}

function DesktopHeader({
  anchor,
  currentTab,
}: {
  anchor: string
  currentTab: string
}) {
  const { t } = useTranslation('ui')
  // the labels fit from ~1200px; below that the items are icons with tooltips
  const showLabels = useMediaQuery('(min-width: 1200px)')
  return (
    <AppBar position="sticky" elevation={0} sx={barSx} id={anchor}>
      <Toolbar
        component="nav"
        aria-label={t('mainNav')}
        sx={{ minHeight: '56px !important', gap: 0.5, px: { md: 2 } }}
      >
        <Brand />
        <Divider
          orientation="vertical"
          flexItem
          sx={{ mx: 1.5, my: 1.5, borderColor: hairline }}
        />
        {primaryNav.map((entry) => (
          <NavItem
            key={entry.value}
            entry={entry}
            active={currentTab === entry.value}
            showLabel={showLabels}
          />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        <SettingsMenu currentTab={currentTab} showLabel={showLabels} />
      </Toolbar>
    </AppBar>
  )
}

function MobileHeader({
  anchor,
  currentTab,
}: {
  anchor: string
  currentTab: string
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggle = () => setMobileOpen((open) => !open)
  const { t } = useTranslation('ui')
  return (
    <>
      <AppBar position="fixed" elevation={0} sx={barSx}>
        <Drawer
          anchor="right"
          variant="temporary"
          open={mobileOpen}
          onClose={toggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          PaperProps={{
            sx: {
              width: 280,
              bgcolor: giTokens.panel,
              borderLeft: `1px solid ${hairline}`,
            },
          }}
        >
          <Box
            component="nav"
            aria-label={t('mainNav')}
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.5 }}
          >
            <Box sx={{ px: 1, py: 1.5 }}>
              <Brand onClick={toggle} />
            </Box>
            {[...primaryNav, ...secondaryNav, settingsNav].map((entry) => (
              <NavItem
                key={entry.value}
                entry={entry}
                active={currentTab === entry.value}
                showLabel
                block
                onClick={toggle}
                suffix={entry === settingsNav ? <DBChip /> : undefined}
              />
            ))}
          </Box>
        </Drawer>
        <Toolbar sx={{ minHeight: '56px !important' }}>
          <Brand />
          <Box flexGrow={1} />
          <IconButton
            color="inherit"
            aria-label={t('openMenu')}
            edge="end"
            onClick={toggle}
          >
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      {/* a blank toolbar keeps the space under the fixed bar and is the scroll anchor */}
      <Toolbar id={anchor} sx={{ minHeight: '56px !important' }} />
    </>
  )
}
