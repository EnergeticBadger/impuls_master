---
id: fix-remove-commander-partner
title: Removing or moving the commander must not strand the partner
phase: P2
priority: 4
depends_on: []
model: sonnet
---
## Goal
PR #152 (p2-partner-model) added `deck.partner`, "only with a commander" (`app/lib/deck.ts:7`), but the deck
page's ways of taking the commander out were not updated: `removeAsCommander` (`app/routes/deck.tsx:44-47`)
and `move` from the commander section (`app/routes/deck.tsx:40`) both set `commander: undefined` and keep
`partner`. Partner decks are reachable now through import (#159).

Failure scenario: import "Commander\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\nDeck\n98 Island", press
"Remove as commander" on Thrasios: Thrasios goes to main, and Tymna stays in `deck.partner` with no commander.
The page shows no commander row, Tymna is in no visible section, `setPartner`/`setCommander` can't reach her
(she isn't in main), and the deck still counts her in the size and price.

## Acceptance criteria
- New pure `removeCommander(deck: Deck, to: DeckZone = "main"): Deck` in `app/lib/deck.ts`: the commander goes to
  `to`, and a partner, if any, becomes the commander. No commander gives the deck back unchanged. The input
  isn't changed.
- `app/routes/deck.tsx` uses it in `removeAsCommander` and in `move` for the commander section, so both stay
  undoable through `change(...)`.
- Tests in `app/lib/deck.test.ts` with Scryfall-shaped cards (Thrasios commander, Tymna partner, Islands in
  main): removing to main gives commander Tymna, no partner, Thrasios in main; removing to side puts Thrasios in
  side; a deck without a partner just loses its commander to main, as today.
- PR description says what a human should click: import the list above, press "Remove as commander" on
  Thrasios, check Tymna is now the commander and Thrasios is in the main deck, then undo.

## Verify
npm run verify
