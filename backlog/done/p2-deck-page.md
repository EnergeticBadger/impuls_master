---
id: p2-deck-page
title: Deck page: cards grouped by type with counts you can change
phase: P2
priority: 5
depends_on: [p2-decks-page]
timeout_min: 50
---
## Goal
`/decks/:id` shows one saved deck as a list people can read and edit, the way deck sites do.

## Acceptance criteria
- New route `route("decks/:id", "routes/deck.tsx")` with `app/routes/DeckPage.module.css`. An unknown id
  shows "No deck here" and a link to `/decks`.
- Opening the page makes it the current deck (`setCurrentDeck`). The deck name is editable at the top.
- Main deck shown with `groupByType` from `app/lib/deck.ts`: a heading per group with its card count, then
  one row per card: count, name (linked with `cardPath` from `app/lib/card.ts`), mana cost (reuse
  `app/Components/CardDetails/ManaText.tsx`), and − / + buttons that call `removeCard` / `addCard` through
  `updateDeck`. Removing the last copy removes the row.
- Sideboard and commander (if set) in their own sections. Each row has "To sideboard" / "To main" so a card
  can move between them.
- Hovering or tapping a card name shows its image (the small image, no new fetches).
- Totals at the top: main deck and sideboard card counts.
- Works at 360px wide with no horizontal scroll.
- PR description says what to click through: add copies, remove to zero, move to sideboard, reload.

## Verify
npm run verify
