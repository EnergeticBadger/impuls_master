---
id: p2-group-by-mana-value
title: Let the deck page group the main deck by mana value as well as by type
phase: P2
priority: 8
depends_on: [p2-deck-land-count]
model: sonnet
---
## Goal
The deck page always groups the main deck by card type. When tuning a curve, people want to see the cards
at each mana value together. Add a toggle.

## Acceptance criteria
- New pure `groupByManaValue(deck: Deck): { group: string; entries: DeckEntry[] }[]` in `app/lib/deck.ts`:
  the main deck only (like the existing `groupByType({ ...deck, commander: undefined })` call), non-land
  cards in groups "0", "1", ... "6", "7+" by their mana value (the same value `manaCurve` uses), then all
  lands in a "Lands" group last. Empty groups are left out; entries in each group are ordered with
  `sortEntries`.
- Tests in `app/lib/deck.test.ts`: groups in ascending order with Lands last; an 8-drop lands in "7+"; a
  modal DFC with a land back but a spell front goes by its front's mana value; empty deck gives `[]`.
- On `app/routes/deck.tsx`, a two-option control above the main deck sections ("Group by: Type | Mana
  value", buttons with `aria-pressed`) switches between `groupByType` and `groupByManaValue`. Headings read
  "Mana value 2 (8)" and "Lands (24)". The choice is remembered in localStorage under its own key
  (`deckGrouping`), read after hydration like `app/Components/Context/view.ts` does; the default is Type.
- Row buttons and behaviour are unchanged in both views. Fits at 360px wide.
- PR description says what to click through: switch to mana value, reload (choice kept), switch back.

## Verify
npm run verify
