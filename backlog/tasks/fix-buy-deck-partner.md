---
id: fix-buy-deck-partner
title: Put the partner commander in the deck's TCGplayer buy link
phase: P2
priority: 4
depends_on: []
model: sonnet
---
## Goal
PR #152 (p2-partner-model) added `deck.partner` and made `cardsOf` count it, so `deckPrice` includes the
partner. `BuyDeck` builds the buy link from its own list (`app/Components/Deck/BuyDeck.tsx:8`:
commander, main, maybe side) and leaves the partner out. Since #159 a partner deck comes in from any list with
two lines under "Commander".

Failure scenario: import "Commander\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\nDeck\n98 Island" and open
the deck page: "About $X" counts Tymna, but the "Buy this deck on TCGplayer" link lists Thrasios and the
Islands only, so the cart is a card short and doesn't match the price shown.

## Acceptance criteria
- A pure exported function in `app/lib/deck.ts`, e.g. `buyEntries(deck: Deck, side: boolean): DeckEntry[]`:
  commander, partner, main, then side when `side` is true. `deckPrice` uses the same list, so price and link
  can't drift apart again.
- `BuyDeck` builds the link from it.
- Tests in `app/lib/deck.test.ts` on a deck with Scryfall-shaped cards (Thrasios as commander, Tymna as
  partner, a main deck and a sideboard, with `prices.usd` set): the entries include Tymna once, with and
  without the side, and `deckPrice`'s total equals the sum over the same entries.
- PR description says what a human should click: import the list above, check the TCGplayer link's card
  list includes Tymna the Weaver.

## Verify
npm run verify
