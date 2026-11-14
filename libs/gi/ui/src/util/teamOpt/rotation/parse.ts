import type { CharacterKey } from '@genshin-optimizer/gi/consts'

/**
 * A rotation written the way players write them:
 *   "bina EQ -> illuga EQ -> linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> bina"
 * Steps are separated by `->` (also `→`, `>`, `,`, `;` or a new line); each starts with who acts
 * (a member's name, a nickname, or the start of either) and lists that member's actions, with or
 * without spaces between them:
 *   E / tE  Elemental Skill, tapped          hE   Elemental Skill, held
 *   Q       Elemental Burst                  N1–N6  a Normal Attack string of that many hits
 *   CA / C  Charged Attack                   P    Plunging Attack
 *   D       dash                             J    jump
 *   W1.5    wait 1.5 s
 *   E? / Q?  only when ready (left out, not waited for, when it is not: "Sucrose N1 E? D")
 * A trailing step with no actions ("-> bina") marks the swap back to that member: where the
 * rotation loops. "A/B" alternatives take the first one; "(…)" comments are ignored.
 */

export type RotationActionKind =
  | 'skill'
  | 'burst'
  | 'normal'
  | 'charged'
  | 'plunge'
  | 'dash'
  | 'jump'
  | 'wait'

export interface RotationAction {
  kind: RotationActionKind
  /** Skill: tapped or held */
  hold?: boolean
  /** Normal: how many hits of the string (N4 = 4); wait: seconds */
  count?: number
  /** Used only when ready ("E?", "Q?"): left out, not waited for, when it is not */
  optional?: boolean
  /** As written (for messages) */
  text: string
}

export interface RotationStep {
  characterKey: CharacterKey
  actions: RotationAction[]
}

export interface ParsedRotation {
  steps: RotationStep[]
  /** Played once before the first loop (a first-rotation-only opener); not counted */
  opener?: RotationStep[]
  /** The rotation loops back to this member (a trailing step without actions) */
  loopsTo?: CharacterKey
  warnings: string[]
}

export interface RotationMember {
  characterKey: CharacterKey
  /** The member's displayed name (any language), for matching */
  name: string
}

/** Short names players use, by character key (matched as whole words, case-insensitive) */
const NICKNAMES: Partial<Record<CharacterKey, string[]>> = {
  Columbina: ['bina', 'colu', 'columbina'],
  Valeriy: ['val', 'valeriy'],
  Anastasya: ['ana', 'tsaritsa', 'anastasya'],
  AratakiItto: ['itto'],
  RaidenShogun: ['raiden', 'ei'],
  KaedeharaKazuha: ['kazuha'],
  KamisatoAyaka: ['ayaka'],
  KamisatoAyato: ['ayato'],
  SangonomiyaKokomi: ['kokomi'],
  YumemizukiMizuki: ['mizuki'],
  Alhaitham: ['haitham'],
  Furina: ['furina'],
  Neuvillette: ['neuv', 'neuvi'],
  Wriothesley: ['wrio'],
  Xianyun: ['xy', 'cloud retainer'],
  Arlecchino: ['arle'],
  Chasca: ['chasca'],
  Citlali: ['cit', 'citlali'],
  Mavuika: ['mav', 'mavuika'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which member a step's name refers to (undefined: none, or ambiguous) */
export function matchMember(
  word: string,
  members: readonly RotationMember[]
): CharacterKey | undefined {
  const w = norm(word)
  if (!w) return undefined
  const exact = members.filter(
    (m) =>
      norm(m.characterKey) === w ||
      norm(m.name) === w ||
      (NICKNAMES[m.characterKey] ?? []).some((n) => norm(n) === w)
  )
  if (exact.length === 1) return exact[0].characterKey
  if (w.length < 3) return undefined
  const prefix = members.filter(
    (m) =>
      norm(m.characterKey).startsWith(w) ||
      norm(m.name).startsWith(w) ||
      norm(m.name)
        .split(/\s+/)
        .some((part) => part.startsWith(w))
  )
  return prefix.length === 1 ? prefix[0].characterKey : undefined
}

/** One step's actions: "EQ", "E N1 E N4", "tE CA", "N1E", "W1.5" */
function parseActions(
  text: string,
  warnings: string[],
  who: string
): RotationAction[] {
  const actions: RotationAction[] = []
  // alternatives: the first one
  const cleaned = text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((word) => word.split('/')[0])
    .join(' ')
  const token =
    /\s*(?:(w)\s*([\d.]+)|(h|t)?(e)(\?)?|(q)(\?)?|(n)\s*([1-6])|(ca|c)|(p)|(d)|(j))/iy
  let i = 0
  const s = cleaned.trim()
  while (i < s.length) {
    token.lastIndex = i
    const m = token.exec(s)
    if (!m || m[0].length === 0) {
      // skip one unknown character (e.g. a stray "+"), say so once per step
      const bad = s.slice(i).trim().split(/\s+/)[0]
      if (bad) warnings.push(`${who}: "${bad}" is not an action (skipped)`)
      const next = s.indexOf(' ', i + 1)
      i = next < 0 ? s.length : next
      continue
    }
    i = token.lastIndex
    const raw = m[0].trim()
    if (m[1]) actions.push({ kind: 'wait', count: Number(m[2]), text: raw })
    else if (m[4])
      actions.push({
        kind: 'skill',
        hold: m[3]?.toLowerCase() === 'h',
        text: raw,
        ...(m[5] && { optional: true }),
      })
    else if (m[6])
      actions.push({
        kind: 'burst',
        text: raw,
        ...(m[7] && { optional: true }),
      })
    else if (m[8])
      actions.push({ kind: 'normal', count: Number(m[9]), text: raw })
    else if (m[10]) actions.push({ kind: 'charged', text: raw })
    else if (m[11]) actions.push({ kind: 'plunge', text: raw })
    else if (m[12]) actions.push({ kind: 'dash', text: raw })
    else if (m[13]) actions.push({ kind: 'jump', text: raw })
  }
  return actions
}

export function parseRotation(
  text: string,
  members: readonly RotationMember[]
): ParsedRotation {
  const warnings: string[] = []
  const steps: RotationStep[] = []
  let loopsTo: CharacterKey | undefined
  const parts = text
    .split(/->|→|=>|>|,|;|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  parts.forEach((part, index) => {
    // the name is the first word, or the longest start of the part that names a member
    const words = part.split(/\s+/)
    let characterKey: CharacterKey | undefined
    let rest = ''
    for (let n = Math.min(words.length, 3); n >= 1 && !characterKey; n--) {
      const candidate = words.slice(0, n).join(' ')
      characterKey = matchMember(candidate, members)
      if (characterKey) rest = words.slice(n).join(' ')
    }
    if (!characterKey) {
      // "Zibai" glued to actions is not supported: say which step was skipped
      warnings.push(`"${part}": no team member with that name (step skipped)`)
      return
    }
    const actions = parseActions(rest, warnings, words[0])
    if (!actions.length) {
      if (index === parts.length - 1) loopsTo = characterKey
      else warnings.push(`${words[0]}: no actions (step skipped)`)
      return
    }
    steps.push({ characterKey, actions })
  })
  return { steps, loopsTo, warnings }
}
