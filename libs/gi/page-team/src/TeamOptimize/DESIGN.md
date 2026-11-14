# Team Optimize & KQM Theorycrafting — design rules

One look for both tabs. The building blocks are in `ui.tsx`; use them instead of one-off styles.
The app theme (`@genshin-optimizer/gi/theme`) already gives tonal buttons and `giCtaSx`.

## Surfaces
- Page: ink. Cards: `Panel` (panel colour, hairline border, 12 px radius, 16 px padding; 12 on phones).
- Inside a card: insets (`insetSx`: panelDark, 8 px radius) for editors, tables, timelines, lists.
- Floating or selected things (menus, toasts, the selected segment): panelRaised.
- Separate rows with hairlines, never with heavy borders or stacked cards inside cards inside cards.
- No drop shadows on cards. Shadows only on what floats (run bar, menus, toasts, popovers).

## Colour
- Gold marks exactly: the one main action on screen (`giCtaSx`, solid), a selection (`selectedSx`),
  an edited value (gold text), keyboard focus. Nothing else is gold.
- Other buttons are tonal (`variant="contained"` with a colour gets the tonal theme style),
  outlined (`color="inherit"`, hairline border) or text buttons.
- Element hues (theme.palette[element].main) mark character data only.
- Status: success (gains), warning (something to fix), error (destructive). Not decorative.

## Type
- `type.section` (17/650) for page sections, `type.title` (15/650) for panels and dialogs,
  body 14, `type.label` (12.5/500, secondary) for labels and meta lines.
- Sentence case everywhere. No ALL-CAPS eyebrow labels, no letter-spaced small caps.
- Numbers: tabular (`numSx`), right-aligned in columns; headline figures `type.figure`.

## Words (the user's rule)
- Labels only. No hint paragraphs or subtitles under titles. An explanation goes in an ⓘ tooltip
  (`info` on `Panel`/`PanelHeader`, `tip` on `FieldLabel`), or in the control's tooltip.
- Buttons say what they do ("Optimize team", "Equip", "Copy as a table").
- Empty places: one muted line (`EmptyLine`), its explanation in ⓘ.
- Keep every existing i18n key and its default text unless the text itself is the confusion;
  new strings get an English default in the `t()` call (do not edit locale JSON files).

## Layout & density
- 8 px rhythm: gaps 8 / 12 / 16. Rows 36–40 px. Controls 30–36 px tall.
- Align numbers in columns; labels left, values right.
- Responsive to 360 px wide: wrap rows, stack columns, never overflow horizontally (except a
  timeline or wide table that scrolls inside its own inset).

## Motion (snappy, quiet)
- Hover / press: colour and background only, 120 ms (`quickSx`). No hover lifts, no scaling cards.
- Opening a section: `Disclosure` / Collapse, 180 ms, chevron turns.
- A result appears once with a short fade-rise (already in index.tsx). Nothing animates on its own.
- Long work shows a thin gold progress line, never a blocking spinner over the page.
- Respect `prefers-reduced-motion` (the helpers do).

## Snappy
- Opening any dialog, drawer or tab must not block: heavy children render after the frame
  (Suspense + skeleton, or rows in batches); keep work out of render (useMemo on real deps).
- No layout shift when data arrives: reserve space (fixed row heights, skeletons).

## Don'ts
- No sparkles/AI decoration, no blue accents, no gradients as decoration, no ⓘ next to a CTA.
- Don't change what anything computes, stores or exports; this is a visual and interaction pass.
