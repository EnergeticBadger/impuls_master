---
id: p2-import-sets-format
title: Set the Commander format on imported decks that have a commander
phase: P2
priority: 4
depends_on: []
model: sonnet
---
## Goal
An imported Commander list arrives with no format, so the legality check and the commander-only buttons
(like "Make commander") stay hidden until the user picks "Commander" by hand. A list with a commander
section is a Commander deck. Set the format when importing.

## Acceptance criteria
- New pure `guessFormat(deck: Deck): string | undefined` in `app/lib/deck.ts`: `"commander"` when the deck
  has a commander, otherwise `undefined`. Tests in `app/lib/deck.test.ts` cover both cases.
- `createDeckWith` in `app/Components/Context/decks.ts` takes an optional `format` and saves it on the new deck.
- `app/routes/decks.tsx` passes `guessFormat(deck)` when it saves an import ("Import" and "Import anyway"),
  including imports opened from a shared deck link.
- The format picker on the deck page can still change it afterwards. Nothing changes for decks already saved.
- PR description says what to click through: import a list with a "Commander" section and see
  "Commander" picked on the deck page; import a 60-card list and see "No format".

## Verify
npm run verify
