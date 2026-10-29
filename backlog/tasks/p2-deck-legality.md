---
id: p2-deck-legality
title: Pick a format on the deck page and list what makes the deck illegal
phase: P2
priority: 6
depends_on: [p2-deck-page]
---
## Goal
Tell people whether their deck is legal in the format they're building for, Commander included.

## Acceptance criteria
- `SavedDeck` in `app/lib/savedDecks.ts` gets an optional `format?: string`; `readSavedDecks` keeps it when
  it is a string (test added in `savedDecks.test.ts`).
- On `app/routes/deck.tsx`, a format `<select>` (Standard, Pioneer, Modern, Legacy, Vintage, Pauper,
  Commander, and "No format"), saved on the deck.
- Below it, the list from `legalityProblems(deck, format)`; "Legal in <format>" when there are none.
  Problems naming a card link to that row.
- In Commander, each legendary creature row (and any card whose text says it "can be your commander")
  gets a "Make commander" button that moves it into `deck.commander`, and the commander has "Remove as
  commander". Which cards qualify is a pure `canBeCommander(card)` in `app/lib/deck.ts`, tested in
  `deck.test.ts`.
- PR description says what to click through: a 60-card deck in Commander, set a commander, add a card
  outside its colors, switch to Modern.

## Verify
npm run verify
