---
id: fix-import-orphan-partner
title: An imported partner whose commander line isn't found must not be left without a commander
phase: P2
priority: 4
depends_on: []
model: sonnet
---
## Goal
PR #159 (p2-partner-decklist) made the second "Commander" line a `"partner"` zone line. `lookUpDeckList`
looks every line up and passes only the found ones to `deckFromLines`, which sets `deck.partner` on its own
(`app/lib/decklist.ts:101-102`). When the first commander line isn't found (a typo, an Alchemy name), the deck
gets a partner and no commander, which the model says can't happen (`app/lib/deck.ts:7`, `setPartner` refuses
it). The deck page shows only `deck.commander`, so the partner disappears from view, yet it still counts in
the price, the curve and the 100-card size, and `legalityProblems` says "There is no commander."

Failure scenario: import "Commander\n1 Thrasios, Tritn Hero\n1 Tymna the Weaver\n\nDeck\n98 Island". Notes say
"Card not found: 1 Thrasios, Tritn Hero"; the deck has `partner` = Tymna and no `commander`; no commander row
shows and Tymna can't be seen or moved.

## Acceptance criteria
- `deckFromLines` in `app/lib/decklist.ts`: when the result has a partner and no commander, the partner
  becomes the commander (no partner left). With both found, nothing changes.
- Tests in `app/lib/decklist.test.ts` with Scryfall-shaped cards: `deckFromLines` with only a found
  `"partner"` line (Tymna the Weaver) plus main lines gives `commander` = Tymna and no `partner`; with both
  lines it keeps both; the order of the found lines doesn't matter (partner line before commander line).
- Only `app/lib/decklist.ts` and `app/lib/decklist.test.ts` change.

## Verify
npm run verify
