---
id: p2-extract-basic-lands
title: Move the deck page's "Add basic lands" form into its own component
phase: P2
priority: 5
depends_on: [p2-extract-quick-add]
model: sonnet
---
## Goal
Keep shrinking `app/routes/deck.tsx`. The "Add basic lands" button and form become their own component.
This is a pure move.

## Acceptance criteria
- New `app/Components/Deck/AddBasicLands.tsx` exports `AddBasicLands({ deck, isCommander, onAdd })`, where
  `onAdd(found: { card: ScryfallCard; count: number }[])` is called once with every basic land to add.
  It owns `basicsOpen`, `basicsText`, `basicsBusy` and `basicsMessage`, plus `BASIC_NAMES`, and works out
  the suggested count and `basicLandSplit` as today.
- `deck.tsx` passes an `onAdd` that applies all of them in one `change(...)`, so a single Undo removes the
  whole batch, as it does today. Drop the moved state and unused imports.
- Same CSS classes from `~/routes/DeckPage.module.css`; no visible change. `npm run typecheck` is clean.
- PR description says what to click through: a two-color deck, open "Add basic lands", change the number,
  Add, then Undo once.

## Verify
npm run verify
