---
id: p2-partner-deck-page
title: Pick and show a partner commander on the deck page
phase: P2
priority: 4
depends_on: [p2-partner-model, p2-extract-basic-lands]
model: sonnet
---
## Goal
With `partner` in the model (p2-partner-model), let users pick a second commander and see it everywhere the
commander shows up today.

## Acceptance criteria
- `app/routes/deck.tsx`: the Commander section lists the commander and then the partner (heading
  "Commanders" when there are two). The partner row has "Remove as commander" (it goes back to main) and
  "Printing" (`replacePrinting` gets a `"partner"` zone, with a test in `app/lib/deck.test.ts`).
- In a Commander-format deck that has a commander, main-deck rows where
  `canBeCommander(card) && canPartner(deck.commander.card, card)` (or the card is a Background the
  commander can choose) get a "Make partner" button (`aria-label="Make <name> the partner"`) that calls
  `setPartner` through `change(...)`, so it can be undone.
- The main deck count, the problem links (anchors) and the row order take the partner into account.
- `app/Components/Deck/CurrentDeckBar.tsx` limits search to `commanderIdentity(deck)` rather than only the
  commander's identity. `app/routes/decks.tsx` counts the partner in the card total.
- Fits at 360px wide.
- PR description says what to click through: a Commander deck with Thrasios and Tymna (two Partner cards):
  make one commander and the other partner, check the color identity filter on search, then undo.

## Verify
npm run verify
