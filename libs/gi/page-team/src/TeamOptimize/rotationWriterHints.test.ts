import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { parseRotation } from '@genshin-optimizer/gi/ui'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { teamQuickTokens, teamSyntaxRows } from './rotationWriterHints'

const t = ((
  _key: string,
  opts?: string | { defaultValue?: string; [k: string]: unknown }
) => {
  if (typeof opts === 'string') return opts
  let out = opts?.defaultValue ?? ''
  for (const [k, v] of Object.entries(opts ?? {}))
    if (k !== 'defaultValue') out = out.replaceAll(`{{${k}}}`, String(v))
  return out
}) as unknown as TFunction

const makeTeam = (keys: CharacterKey[]) => ({
  members: keys.map((characterKey) => ({ characterKey })),
  names: keys.map((characterKey) => ({ characterKey, name: characterKey })),
})

describe('rotationWriterHints', () => {
  it('documents groups, and every example is a rotation that reads without a warning', () => {
    const { members, names } = makeTeam(['YaeMiko', 'Fischl'])
    const { generalRows, examples } = teamSyntaxRows(members, names, t)
    expect(generalRows.some((r) => r.code === '[Q E]?/[N3 N3]')).toBe(true)
    expect(examples.length).toBeGreaterThanOrEqual(3)
    for (const { code } of examples) {
      const rotation = parseRotation(code, names)
      expect(rotation.warnings, code).toEqual([])
      expect(rotation.steps.length, code).toBeGreaterThan(0)
    }
    expect(
      parseRotation(examples[0].code, names).steps[0].actions.some(
        (a) => a.group !== undefined
      )
    ).toBe(true)
  })
  it('omits entry, plunge, and unrelated kit tips on a standard team', () => {
    const { members, names } = makeTeam([
      'KamisatoAyaka',
      'Furina',
      'Xingqiu',
      'Escoffier',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const texts = tokens.map((tok) => tok.text)

    expect(texts).not.toContain('entry')
    expect(texts).not.toContain('P')
    expect(texts).not.toContain('hE')
    expect(texts).not.toContain('CA[beams=2]')
    expect(texts).not.toContain('CA[cancel] D')
    expect(texts).not.toContain('C3F')
    expect(tokens.find((tok) => tok.text === 'E')?.label).toContain('E?')
    expect(tokens.find((tok) => tok.text === 'Q')?.label).toContain('Q?/N4')
    expect(tokens.find((tok) => tok.text === 'CA')?.label).toBe(
      'Charged Attack'
    )

    const { teamRows, generalRows } = teamSyntaxRows(members, names, t)
    expect(teamRows).toEqual([])
    expect(generalRows[0].code).toBe('KamisatoAyaka E Q')
    expect(generalRows.some((r) => r.code.includes('Q?/N4'))).toBe(true)
    expect(generalRows.some((r) => r.meaning.includes('Beidou'))).toBe(false)
    expect(generalRows.some((r) => r.meaning.includes('Sandrone'))).toBe(false)
  })

  it('includes kit-specific chips and syntax rows only for characters in the team', () => {
    const { members, names } = makeTeam([
      'Arlecchino',
      'Iansan',
      'KaedeharaKazuha',
      'Bennett',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const texts = tokens.map((tok) => tok.text)

    expect(texts).toContain('hE')
    expect(texts).toContain('P')
    expect(texts).toContain('CA[cancel] D')
    expect(texts).toContain('N3[movement=4]')
    expect(texts).not.toContain('entry')
    expect(texts).not.toContain('C3F')
    expect(texts).not.toContain('CA[beams=2]')
    expect(tokens.find((tok) => tok.text === 'CA')?.label).toContain(
      'Arlecchino'
    )
    expect(tokens.find((tok) => tok.text === 'CA')?.label).not.toContain(
      'Mavuika'
    )
    // Kazuha doesn't model plungeHeights (Diluc/Xiao only)
    expect(tokens.find((tok) => tok.text === 'P')?.label).toBe(
      'Plunging Attack'
    )

    const { teamRows } = teamSyntaxRows(members, names, t)
    const codes = teamRows.map((r) => r.code)
    expect(codes).toContain('hE')
    expect(codes).not.toContain('HP · LP · HP[collision]')
    expect(codes).toContain('CA[cancel] D')
    expect(codes).toContain('N3[movement=4]')
    expect(codes).not.toContain('entry')
    expect(codes).not.toContain('C3F · C2D')
  })

  it('shows HP/LP/collision only for plunge-height kits and CA[weakspot] for bow users', () => {
    const { members, names } = makeTeam(['Xiao', 'Xianyun', 'Furina', 'Ganyu'])
    const tokens = teamQuickTokens(members, names, t)
    expect(tokens.find((tok) => tok.text === 'P')?.label).toContain(
      'HP[collision]'
    )
    expect(tokens.map((tok) => tok.text)).toContain('CA[weakspot]')

    const { teamRows } = teamSyntaxRows(members, names, t)
    const codes = teamRows.map((r) => r.code)
    expect(codes).toContain('HP · LP · HP[collision]')
    expect(codes).toContain('CA[weakspot]')
  })

  it('includes entry chip and names teammates dynamically for kits with onSwapIn', () => {
    const { members, names } = makeTeam([
      'YumemizukiMizuki',
      'Furina',
      'Fischl',
      'Xingqiu',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const entry = tokens.find((tok) => tok.text === 'entry')
    expect(entry).toBeDefined()
    expect(entry?.label).toContain('YumemizukiMizuki')

    const { teamRows } = teamSyntaxRows(members, names, t)
    expect(teamRows.some((r) => r.code === 'entry')).toBe(true)
  })

  it('surfaces CA[beams=6] for C1+ Sandrone and keeps CA[beams=2] at C0', () => {
    const { members, names } = makeTeam(['Sandrone', 'Mitya'])
    expect(
      teamQuickTokens(members, names, t, { Sandrone: 0 }).map((x) => x.text)
    ).toContain('CA[beams=2]')
    expect(
      teamQuickTokens(members, names, t, { Sandrone: 1 }).map((x) => x.text)
    ).toContain('CA[beams=6]')
    expect(
      teamSyntaxRows(members, names, t, { Sandrone: 1 }).teamRows.some(
        (r) => r.characterKey === 'Sandrone' && r.code.includes('CA[beams=6]')
      )
    ).toBe(true)
  })
})
