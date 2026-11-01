---
id: p2-deck-notes
title: Free-text notes on a deck
phase: P2
priority: 8
depends_on: [p2-deck-legality]
model: haiku
---
## Goal
Let people jot down a deck's plan, sideboard guide or cards to buy, next to the list.

## Acceptance criteria
- `SavedDeck` in `app/lib/savedDecks.ts` gets an optional `notes?: string`; `readSavedDecks` keeps it when it
  is a string and drops it otherwise. Tests in `app/lib/savedDecks.test.ts` for both.
- A `setDeckNotes(id: string, notes: string)` in `app/Components/Context/decks.ts` saves it and bumps
  `updated`, like `renameDeck` does.
- On `app/routes/deck.tsx`, below the card sections, a "Notes" heading and a `<textarea>`
  (`aria-label="Deck notes"`, `box-sizing: border-box`, full width, at most 2000 characters) that saves on
  blur, not on every keystroke.
- PR description says what to click through: write notes, reload the page, check they're still there.

## Verify
npm run verify
