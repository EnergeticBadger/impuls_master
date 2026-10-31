---
id: p2-deck-price
title: Show an estimated deck price next to the buy link
phase: P2
priority: 8
depends_on: [p2-buy-deck]
model: sonnet
---
## Goal
Before clicking "Buy this deck", people want a rough total. Our cards already carry Scryfall prices.

## Acceptance criteria
- New pure `deckPrice(deck: Deck, opts: { side: boolean; currency: "usd" | "eur" | "tix" }): { total: number;
  missing: string[] }` in `app/lib/deck.ts`: sums price × count over main, commander and (if `side`)
  sideboard. For `usd` a card with no `usd` price falls back to `usd_foil`; cards with no price at all are
  listed by name in `missing` (each name once) and add nothing. Prices are strings in Scryfall data; parse
  them, and return the total rounded to cents.
- Tests in `app/lib/deck.test.ts`: counts multiply; foil fallback; a card with no price lands in `missing`;
  the sideboard counts only when asked; an empty deck gives `{ total: 0, missing: [] }`.
- On `app/routes/deck.tsx`, next to the "Buy this deck" link: "About $123.45" (follows the same sideboard
  checkbox), plus "(3 cards have no price)" when `missing` is not empty, with the names in a `title`.
  Labelled as an estimate from the printings in the deck.
- PR description says what to look at: a deck with a card that has no USD price.

## Verify
npm run verify
