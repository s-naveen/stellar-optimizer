// @vitest-environment jsdom

import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type {
  KqmBuild,
  KqmResult,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  createTheme,
  ThemeProvider,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { KqmCompare } from './KqmComparison'
import { KqmResults, KqmSettings } from './KqmMode'
import { useKqmRun } from './useKqmRun'

const mocks = vi.hoisted(() => {
  // the saved last runs (`database.teamKqmResults`), as the browser's storage keeps them
  const saved: { runs: Record<string, any> } = { runs: {} }
  return {
    compare: vi.fn(),
    optimize: vi.fn(),
    saved,
    database: {
      weapons: { get: () => ({ key: 'AmenomaKageuchi', refinement: 5 }) },
      chars: { get: () => ({ constellation: 0 }) },
      buildTcs: { get: () => undefined },
      teamKqmResults: {
        get: () => saved,
        getRun: (teamId: string) =>
          saved.runs[teamId] && JSON.parse(JSON.stringify(saved.runs[teamId])),
        setRun: (teamId: string, run: unknown) => {
          if (run) saved.runs[teamId] = JSON.parse(JSON.stringify(run))
          else delete saved.runs[teamId]
        },
      },
    },
  }
})
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => mocks.database,
  useDBMeta: () => ({ gender: 'F' }),
}))
vi.mock('@genshin-optimizer/gi/db', () => ({
  defaultTeamOptKqm: { refinement4: 5, refinement5: 1 },
}))
vi.mock('@genshin-optimizer/gi/theme', () => ({
  giCtaSx: {},
  // (the shared building blocks in ./ui read the surface tokens)
  giTokens: {
    hairline: 'rgba(236, 229, 216, 0.08)',
    hairlineStrong: 'rgba(236, 229, 216, 0.16)',
    panel: '#19191c',
    panelDark: '#141416',
    panelRaised: '#212124',
    panelHover: '#2a2a2e',
    parchment: '#ece5d8',
    gold: '#d3bc8e',
  },
}))
vi.mock('@genshin-optimizer/gi/assets', () => ({
  artifactAsset: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
}))
vi.mock('@genshin-optimizer/gi/util', () => ({ getMainStatValue: () => 0.466 }))
vi.mock('@genshin-optimizer/gi/i18n', () => ({ preloadNamespaces: () => {} }))
vi.mock('@genshin-optimizer/common/ui', () => ({
  InfoTooltipInline: () => <span role="img" aria-label="Info" />,
  SolidToggleButtonGroup: (props: object) => <ToggleButtonGroup {...props} />,
  BootstrapTooltip: (props: object) => <Tooltip {...props} />,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      let text =
        typeof options === 'string'
          ? options
          : String(options?.['defaultValue'] ?? key.split('.').at(-1))
      if (typeof options === 'object')
        for (const [k, v] of Object.entries(options))
          text = text.replaceAll(`{{${k}}}`, String(v))
      return text
    },
  }),
}))
vi.mock('@genshin-optimizer/gi/ui', () => ({
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
  WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
  ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
  ArtifactSetTooltip: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  statName: (key: string) => key,
  quickTooltipProps: {},
  weaponSheetNs: (key: string) => `weapon_${key}_gen`,
  kqmConstellation: (key: string) => (key === 'Bennett' ? 6 : 0),
  KQM_TALENT_DEFAULT: 9,
  teamOptMembers: () => [],
  kqmTalentLevel: (kqm?: { talents?: 9 | 10 }) => kqm?.talents ?? 9,
  kqmMemberConstellation: (
    key: string,
    kqm?: { constellations?: Record<string, number> }
  ) => kqm?.constellations?.[key] ?? (key === 'Bennett' ? 6 : 0),
  kqmHasEnergyRequirement: (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 100,
  KQM_ER_DEFAULT: 100,
  kqmEnergyRequirement: (
    kqm: { energyRecharge?: Record<string, number> } | undefined,
    key: string
  ) => {
    const value = kqm?.energyRecharge?.[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 100
      ? value
      : 100
  },
  kqmWeapons: () => [{ key: 'AmenomaKageuchi', refinement: 5 }],
  kqmSetsId: (sets: object) =>
    Object.entries(sets)
      .map(([key, n]) => `${key}:${n}`)
      .sort()
      .join('+'),
  kqmWeaponData: (weapon: object) => weapon,
  kqmArtifactStats: () => [
    {
      key: 'critRate_',
      main: 0.311,
      fixed: 0.0662,
      distributed: 0.1,
      rolls: 3,
      total: 0.4772,
    },
    {
      key: 'critDMG_',
      main: 0,
      fixed: 0.1324,
      distributed: 0.6,
      rolls: 9,
      total: 0.7324,
    },
  ],
  KQM_SUBSTAT_ROLLS: { critRate_: 0.0331, critDMG_: 0.0662, atk_: 0.0496 },
  syncEnergyCalculator: (
    keys: string[],
    saved: object | undefined,
    rotationTime: number
  ) =>
    saved ?? {
      rotationTime,
      members: Object.fromEntries(keys.map((key) => [key, { fieldTime: 25 }])),
    },
  compareTeamKqm: mocks.compare,
  optimizeTeamKqm: mocks.optimize,
  TeamOptCancelled: class extends Error {},
}))
vi.mock('./KqmChoosers', () => ({
  kqmChooserCounts: () => ({ weapons: { allowed: 3 }, sets: { allowed: 3 } }),
  KqmWeaponChooser: () => <div>Weapon options</div>,
  KqmSetChooser: () => <div>Set options</div>,
}))
vi.mock('./KqmEnergyCalculator', () => ({
  KqmEnergyCalculator: () => <div>Team ER calculator</div>,
  kqmEnergyEstimate: () => ({
    targets: {
      KamisatoAyaka: 135,
      Shenhe: 140,
      KaedeharaKazuha: 150,
      Bennett: 160,
    },
    errors: [],
  }),
}))
vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span>{characterKey} portrait</span>
  ),
}))
vi.mock('./TeamOptResults', () => ({
  WeaponThumb: () => <span />,
  WeaponDetails: () => <span />,
}))

const keys = ['KamisatoAyaka', 'Shenhe', 'KaedeharaKazuha', 'Bennett'] as const
const members = keys.map((characterKey) => ({
  characterKey,
  weaponId: characterKey,
})) as TeamOptMember[]
const initial = () =>
  ({
    attacks: {},
    keep: [],
    weaponEnergy: {},
    rotationTime: 20,
    kqm: { refinement4: 5, refinement5: 1 },
  }) as TeamOpt
const build: KqmBuild = {
  weapon: { key: 'AmenomaKageuchi', refinement: 5 },
  sets: { BlizzardStrayer: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critRate_' },
  rolls: { critRate_: 3, critDMG_: 10, enerRech_: 7 },
}
function sampleResult(): KqmResult {
  const option = { ...build, total: 1000, unmet: false }
  return {
    builds: { KamisatoAyaka: build },
    optimized: ['KamisatoAyaka'],
    after: { total: 1000, members: { KamisatoAyaka: 1000 }, unmet: {} },
    rankings: {
      KamisatoAyaka: {
        weapons: [
          option,
          {
            ...option,
            weapon: { key: 'TheBlackSword', refinement: 1 },
            total: 900,
            catchUp: {
              status: 'matched',
              count: 1.5,
              target: 1000,
              total: 1000,
              rolls: { critDMG_: 1.5 },
            },
          },
        ],
        sets: [
          option,
          { ...option, sets: { GladiatorsFinale: 4 }, total: 800 },
        ],
      },
    },
    constellations: { KamisatoAyaka: 0 },
    energyRecharge: {
      KamisatoAyaka: { value: 138.6, target: 135, minimum: 135 },
    },
    assumed: {},
    rounds: 1,
  } as KqmResult
}
const theme = createTheme({ palette: { mode: 'dark' } })
const wrap = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
)
function Setup({
  active = true,
  start = vi.fn(),
}: {
  active?: boolean
  start?: (settings: TeamOpt) => void
}) {
  const [settings, setSettings] = useState(initial)
  return (
    <KqmSettings
      active={active}
      canRun
      onStart={start}
      teamId="ui"
      members={members}
      teamData={undefined}
      teamOpt={settings}
      setTeamOpt={(update) =>
        setSettings((previous) => {
          const next = structuredClone(previous)
          return update(next) ?? next
        })
      }
    />
  )
}
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  window.requestAnimationFrame = (cb) => window.setTimeout(cb, 0)
})
afterEach(() => {
  cleanup()
  mocks.compare.mockReset()
  mocks.optimize.mockReset()
})

describe('KQM first-time setup', () => {
  it('starts every ER target at 100%, blocks one typed below it, and runs with the targets typed', () => {
    const start = vi.fn()
    render(<Setup start={start} />, { wrapper: wrap })
    const generate = screen.getByRole('button', {
      name: 'Generate builds',
    }) as HTMLButtonElement
    const input = (key: string) =>
      screen.getByLabelText(`${key} minimum ER (%)`) as HTMLInputElement
    for (const key of keys) expect(input(key).value).toBe('100')
    expect(generate.disabled).toBe(false)
    expect(screen.queryByRole('tab')).toBeNull()
    fireEvent.change(input(keys[0]), { target: { value: '90' } })
    expect(generate.disabled).toBe(true)
    for (const key of keys)
      fireEvent.change(input(key), { target: { value: '140' } })
    expect(generate.disabled).toBe(false)
    fireEvent.click(generate)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        kqm: expect.objectContaining({
          energyRecharge: Object.fromEntries(keys.map((key) => [key, 140])),
        }),
      })
    )
  })
  it('opens the calculator directly and applies targets without a save step', async () => {
    render(<Setup />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate ER' }))
    expect(
      await screen.findByRole('dialog', { name: 'ER calculator' })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply ER targets' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      (
        screen.getByLabelText(
          'KamisatoAyaka minimum ER (%)'
        ) as HTMLInputElement
      ).value
    ).toBe('135')
    expect(
      (
        screen.getByRole('button', {
          name: 'Generate builds',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
  it('puts optional filters in a labelled panel and hides them when this page becomes inactive', async () => {
    const ui = render(<Setup />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: /3 weapons/ }))
    expect(await screen.findByRole('dialog', { name: 'Weapons' })).toBeTruthy()
    expect(screen.getByText('Weapon options')).toBeTruthy()
    ui.rerender(<Setup active={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('KQM focused results', () => {
  it('shows one inspector and switches the visible ranking with one click', async () => {
    const result = sampleResult()
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
    }))
    render(
      <KqmCompare
        teamId="ui"
        runSettings={initial()}
        result={result}
        characterKey="KamisatoAyaka"
        rotationTime={20}
      />,
      { wrapper: wrap }
    )
    expect(
      screen.getAllByRole('region', { name: 'Artifact totals' })
    ).toHaveLength(1)
    expect(
      screen.getByRole('tab', { name: 'Weapons' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(
      screen.queryByRole('button', { name: /GladiatorsFinale/ })
    ).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Artifact sets' }))
    fireEvent.click(screen.getByRole('button', { name: /GladiatorsFinale/ }))
    await waitFor(() =>
      expect(mocks.compare).toHaveBeenCalledWith(
        expect.objectContaining({
          sets: { GladiatorsFinale: 4 },
          weapon: build.weapon,
        })
      )
    )
    expect(
      screen
        .getByRole('tab', { name: 'Artifact sets' })
        .getAttribute('aria-selected')
    ).toBe('true')
  })
  it('remembers the selected weapon when the member inspector is reopened', async () => {
    const result = sampleResult()
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
    }))
    const props = {
      teamId: 'ui',
      runSettings: initial(),
      result,
      characterKey: 'KamisatoAyaka' as const,
      rotationTime: 20,
    }
    const ui = render(<KqmCompare {...props} />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Weapon' }).textContent
      ).toContain('TheBlackSword')
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
    )
    ui.unmount()
    render(<KqmCompare {...props} />, { wrapper: wrap })
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Weapon' }).textContent
      ).toContain('TheBlackSword')
    )
  })
  it('replaces four repeated stat cards with compact member selection and one artifact view', () => {
    const result = sampleResult()
    render(
      <KqmResults
        teamId="ui"
        runSettings={initial()}
        members={members}
        result={result}
        seconds={1}
        rotationTime={20}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByRole('tablist', { name: 'Team builds' })).toBeTruthy()
    expect(
      screen.getAllByRole('region', { name: 'Artifact totals' })
    ).toHaveLength(1)
    // (the setup above runs again: the results only offer to discard them)
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })
  it('keeps the previous result available while recalculating and clears it on discard', async () => {
    const first = sampleResult()
    mocks.optimize.mockResolvedValueOnce(first)
    const hook = renderHook(() => useKqmRun('ui-rerun'))
    await act(async () => {
      await hook.result.current.run(initial())
    })
    expect(hook.result.current.lastResult?.result).toBe(first)
    let finish!: (value: KqmResult) => void
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    act(() => {
      void hook.result.current.run(initial())
    })
    expect(hook.result.current.state.type).toBe('running')
    expect(hook.result.current.lastResult?.result).toBe(first)
    // (the run starts after a frame, so the running state paints first)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    await act(async () => {
      finish(sampleResult())
    })
    await waitFor(() => expect(hook.result.current.state.type).toBe('done'))
    act(() => hook.result.current.clear())
    expect(hook.result.current.lastResult).toBeUndefined()
  })

  it('saves the last result for after a reload, and forgets it on discard', async () => {
    const first = sampleResult()
    mocks.optimize.mockResolvedValueOnce(first)
    const hook = renderHook(() => useKqmRun('ui-saved'))
    await act(async () => {
      await hook.result.current.run(initial())
    })
    // (saved once the page shows it)
    await waitFor(() => expect(mocks.saved.runs['ui-saved']).toBeDefined())
    const saved = mocks.saved.runs['ui-saved']
    expect(saved.savedAt).toBe(hook.result.current.lastResult?.savedAt)
    expect(saved.run.result).toEqual(JSON.parse(JSON.stringify(first)))
    // a reload: nothing in the page's memory for the team, the saved run comes back
    mocks.saved.runs['ui-reloaded'] = saved
    const reloaded = renderHook(() => useKqmRun('ui-reloaded'))
    expect(reloaded.result.current.state.type).toBe('done')
    expect(reloaded.result.current.lastResult?.result).toEqual(saved.run.result)
    // (shown again, not saved again)
    expect(reloaded.result.current.lastResult?.savedAt).toBe(saved.savedAt)
    act(() => reloaded.result.current.clear())
    expect(mocks.saved.runs['ui-reloaded']).toBeUndefined()
    expect(reloaded.result.current.lastResult).toBeUndefined()
  })

  it('goes on when the page is left, and shows the result when it comes back', async () => {
    const first = sampleResult()
    let finish!: (value: KqmResult) => void
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const page = renderHook(() => useKqmRun('ui-background'))
    act(() => {
      void page.result.current.run(initial())
    })
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    // another page (or tab) is shown: the run is not cancelled
    page.unmount()
    const elsewhere = renderHook(() => useKqmRun('ui-background'))
    expect(elsewhere.result.current.state.type).toBe('running')
    elsewhere.unmount()
    await act(async () => {
      finish(first)
    })
    const back = renderHook(() => useKqmRun('ui-background'))
    await waitFor(() => expect(back.result.current.state.type).toBe('done'))
    expect(back.result.current.lastResult?.result).toBe(first)
  })

  it('does not bring back a saved result for other members', () => {
    mocks.saved.runs['ui-other'] = {
      savedAt: 1,
      members: ['Bennett'],
      run: { type: 'done', result: sampleResult(), teamOpt: initial() },
    }
    const hook = renderHook(() => useKqmRun('ui-other'))
    expect(hook.result.current.state.type).toBe('idle')
    expect(mocks.saved.runs['ui-other']).toBeUndefined()
  })
})
