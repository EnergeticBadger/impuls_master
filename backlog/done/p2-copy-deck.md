---
id: p2-copy-deck
title: Copy a deck from the decks page
phase: P2
priority: 7
model: haiku
---
## Goal
People try variations of a deck ("Mono-Red, no Embercleave"). Let them copy one instead of rebuilding it.

## Acceptance criteria
- New pure `copyDeck(saved: SavedDeck, now: number, id: string): SavedDeck` in `app/lib/savedDecks.ts`: new
  id, name `"<name> (copy)"`, `updated: now`, the same main, side and commander (a new deck object, so
  changing the copy can't change the original).
- `duplicateDeck(id: string)` in `app/Components/Context/decks.ts` adds the copy (wrapped in `ref()` like
  `createDeck`) and makes it current.
- On `app/routes/decks.tsx`, a "Copy" button next to "Rename" and "Delete" for each deck. The row of buttons
  still fits at 360px wide (wrap if needed, no horizontal scroll).
- Tests in `app/lib/savedDecks.test.ts`: the copy has the new id, name and time and equal cards; adding a card
  to the copy with `addCard` leaves the original's `main` unchanged.
- PR description says what to click through: copy a deck, open the copy, change it, check the original.

## Verify
npm run verify
