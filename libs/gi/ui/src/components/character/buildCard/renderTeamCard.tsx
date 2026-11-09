import type { BuildCardData } from './buildCardData'
import {
  GOLD,
  MUTED,
  milkyWay,
  NIGHT,
  offscreen,
  renderBuildCard,
  roundRect,
  SERIF,
  seeded,
  text,
} from './renderBuildCard'

/** A team member on the team card: its build card's data, and its part of the team's damage */
export type TeamCardMember = {
  card: BuildCardData
  /** its share of the team's damage, 0…1 */
  share: number
  /** its damage, formatted ("190.4K DPS", or per rotation) */
  damage: string
}

/** Everything the team card shows, as plain text and image URLs */
export type TeamCardData = {
  name: string
  /** the headline figure: the Team DPS (or the rotation's damage when its length is unknown) */
  headline: { label: string; value: string }
  /** the other figures, from the headline leftward (e.g. the rotation's length and damage) */
  figures: { label: string; value: string }[]
  members: TeamCardMember[]
  labels: { share: string; siteName: string }
}

export const TEAM_CARD_WIDTH = 1600
/** The usual height of a team card of 4 (for placeholders) */
export const TEAM_CARD_HEIGHT = 4100

const MARGIN = 40
const HEADER_H = 150
const BAND_H = 64
const FOOTER_H = 40

/**
 * A team's build cards one below the other, under the team's damage figures; above each card, a
 * band with the member's share of the damage. Drawn at `scale` (1.5 by default: four cards make a
 * tall picture, and it should stay small enough to share).
 */
export async function renderTeamCard(
  team: TeamCardData,
  scale = 1.5
): Promise<HTMLCanvasElement> {
  const W = TEAM_CARD_WIDTH
  // the members' cards, one at a time (each is a large canvas)
  const cards: HTMLCanvasElement[] = []
  for (const { card } of team.members)
    cards.push(await renderBuildCard(card, scale, { credit: false }))
  const heights = cards.map((c) => c.height / scale)
  const H =
    HEADER_H + heights.reduce((sum, h) => sum + BAND_H + h, 0) + FOOTER_H

  const canvas = offscreen(Math.round(W * scale), Math.round(H * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported')
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // ── the night behind the header and the bands
  ctx.fillStyle = NIGHT
  ctx.fillRect(0, 0, W, H)
  const rand = seeded(team.name)
  milkyWay(
    ctx,
    W,
    HEADER_H * 3,
    rand,
    team.members[0]?.card.elementColor ?? GOLD
  )

  // ── the header: the team's name, and its damage figures on the right
  text(ctx, team.name, MARGIN, 96, {
    size: 50,
    minSize: 30,
    weight: 600,
    family: SERIF,
    maxWidth: 760,
  })
  let fx = W - MARGIN
  text(ctx, team.headline.label, fx, 62, {
    size: 14,
    weight: 600,
    color: MUTED,
    align: 'right',
  })
  const heroW = text(ctx, team.headline.value, fx, 114, {
    size: 50,
    weight: 600,
    family: SERIF,
    color: GOLD,
    align: 'right',
  })
  fx -= heroW + 56
  for (const f of team.figures) {
    const lw = text(ctx, f.label, fx, 62, {
      size: 13,
      weight: 500,
      color: MUTED,
      align: 'right',
    })
    const vw = text(ctx, f.value, fx, 106, {
      size: 28,
      weight: 700,
      align: 'right',
    })
    fx -= Math.max(lw, vw) + 44
  }

  // ── each member: a band with its share of the damage, then its card
  let y = HEADER_H
  team.members.forEach(({ card, share, damage }, i) => {
    const mid = y + BAND_H / 2 + 8
    const nw = text(ctx, card.name, MARGIN, mid, {
      size: 26,
      weight: 600,
      family: SERIF,
    })
    let bx = MARGIN + nw + 28
    bx +=
      text(ctx, `${(share * 100).toFixed(1)}%`, bx, mid, {
        size: 26,
        weight: 600,
        family: SERIF,
        color: GOLD,
      }) + 10
    bx += text(ctx, team.labels.share, bx, mid, { size: 14, color: MUTED }) + 28
    const dw = text(ctx, damage, W - MARGIN, mid, {
      size: 20,
      weight: 700,
      align: 'right',
    })
    // the share as a bar, between the words and the damage
    const barW = W - MARGIN - dw - 32 - bx
    if (barW > 40) {
      roundRect(ctx, bx, mid - 8, barW, 4, 2)
      ctx.fillStyle = 'rgba(236, 229, 216, 0.08)'
      ctx.fill()
      if (share > 0) {
        roundRect(ctx, bx, mid - 8, Math.max(4, barW * share), 4, 2)
        ctx.fillStyle = card.elementColor
        ctx.fill()
      }
    }
    y += BAND_H
    ctx.drawImage(cards[i], 0, y, W, heights[i])
    y += heights[i]
  })

  text(ctx, team.labels.siteName, W - MARGIN, H - 15, {
    size: 12,
    weight: 500,
    color: 'rgba(236, 229, 216, 0.3)',
    align: 'right',
  })
  return canvas
}
