---
id: p2-buy-deck-partner
title: Include the partner commander in the "Buy this deck" link
phase: P2
priority: 5
depends_on: [p2-deck-price-currency]
model: sonnet
---
## Goal
`BuyDeck` (`app/Components/Deck/BuyDeck.tsx`) builds the TCGplayer list from commander, main and (optionally)
sideboard by hand, so a deck's partner is left out of the link although `deckPrice` counts it. The list of
cards to buy should come from one pure function.

## Acceptance criteria
- New exported `buyEntries(deck: Deck, opts: { side: boolean }): DeckEntry[]` in `app/lib/deck.ts`: commander,
  partner, main, then sideboard when `opts.side`. `deckPrice` uses it for its entries, so price and link always
  agree.
- `BuyDeck.tsx` uses `buyEntries` for the link and for the "nothing to buy" check.
- Tests in `app/lib/deck.test.ts`: a deck with commander, partner, main and side gives all four in that order
  with `side: true`, and no sideboard entries with `side: false`; `deckPrice` totals are unchanged in the
  existing tests.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts` and `app/Components/Deck/BuyDeck.tsx` change.
- PR description says what a human should click: a deck with a commander and partner; the TCGplayer link's
  card list includes both.

## Verify
npm run verify
