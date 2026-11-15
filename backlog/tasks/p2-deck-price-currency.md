---
id: p2-deck-price-currency
title: Let the deck price estimate show euros or MTGO tickets
phase: P2
priority: 6
depends_on: [p2-extract-buy-section]
model: sonnet
---
## Goal
`deckPrice` already supports `usd`, `eur` and `tix`, but the deck page only shows dollars. European and
MTGO players want their own currency. Let them pick it, and remember the choice.

## Acceptance criteria
- New `app/Components/Context/priceCurrency.ts`, modelled on `deckGrouping.ts`: a valtio proxy
  `{ currency: "usd" | "eur" | "tix" }` (default `"usd"`), `loadPriceCurrency()` reads localStorage after
  hydration (and ignores unknown values), and changes are written back.
- In `app/Components/Deck/BuyDeck.tsx`, a small select next to the estimate (`aria-label="Currency"`,
  options "USD", "EUR", "MTGO tix") picks the currency. The estimate shows "About $12.34", "About €12.34"
  or "About 12.34 tix", and "no price" counts the missing cards for that currency.
- New pure `formatPrice(total: number, currency: "usd" | "eur" | "tix"): string` in `app/lib/deck.ts`, with
  tests in `app/lib/deck.test.ts` for all three currencies (always two decimals).
- The TCGplayer link and the disclosure don't change. Box sizing follows the CLAUDE.md input note; fits at
  360px wide.
- PR description says what to click through: switch to EUR, reload the page, and it's still EUR.

## Verify
npm run verify
