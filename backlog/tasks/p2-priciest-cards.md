---
id: p2-priciest-cards
title: Show the deck's five most expensive cards under the price estimate
phase: P2
priority: 6
depends_on: [p2-buy-deck-partner, fix-deck-price-etched]
model: sonnet
---
## Goal
"About $412.50" doesn't tell people where the money goes. Under the estimate, list the cards that cost the
most, so they can swap a printing or a card.

## Acceptance criteria
- In `app/lib/deck.ts`, factor the per-card price lookup out of `deckPrice` into an exported
  `cardPrice(card: ScryfallCard, currency: "usd" | "eur" | "tix"): number | undefined` (same fallbacks as
  `deckPrice` has then, including `usd_etched`), and have `deckPrice` use it.
- New exported `priciestCards(deck: Deck, opts: { side: boolean; currency: "usd" | "eur" | "tix" }, n = 5):
  { name: string; count: number; each: number; total: number }[]` over `buyEntries(deck, opts)`: entries with a
  price, by `total` (each × count) highest first, ties by name; at most `n`.
- Tests in `app/lib/deck.test.ts`: order by total (a 4-of cheap card can beat a 1-of), ties by name, cards with
  no price left out, `n` respected, the sideboard only with `side: true`, and `cardPrice` falls back as
  documented.
- `app/Components/Deck/BuyDeck.tsx`: under the estimate, when there is at least one priced card, a short list
  "Most expensive" with lines like "4 × Ragavan, Nimble Pilferer — $203.96" in the chosen currency (use
  `formatPrice` from p2-deck-price-currency). Fits at 360px wide (long names wrap).
- PR description says what a human should click: a deck with a few pricey cards; the list matches the cards'
  prices, and switching currency or "Include the sideboard" updates it.

## Verify
npm run verify
