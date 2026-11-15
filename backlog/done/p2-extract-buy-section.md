---
id: p2-extract-buy-section
title: Move the deck page's buy link and price into their own component
phase: P2
priority: 4
depends_on: [p2-extract-export-section]
model: sonnet
---
## Goal
Keep shrinking `app/routes/deck.tsx` (see p2-extract-export-section). The buy section at the bottom (the
sideboard checkbox, "Buy this deck on TCGplayer", the price estimate and the affiliate disclosure) becomes
its own component. This is a pure move.

## Acceptance criteria
- New `app/Components/Deck/BuyDeck.tsx` exports `BuyDeck({ deck }: { deck: Deck })`. It owns the
  `withSide` state, works out the buy entries and `deckPrice`, and renders exactly what `deck.tsx` renders
  today (nothing when there are no entries to buy).
- It uses the same classes from `~/routes/DeckPage.module.css`. The link keeps `rel="noopener sponsored"`
  and `target="_blank"`, and the disclosure text is unchanged.
- `deck.tsx` renders `<BuyDeck deck={deck} />` where the section was and drops the now-unused state and
  imports (`withSide`, `tcgplayerDeckLink`, `deckPrice`, ...).
- No visible change. `npm run typecheck` is clean.
- PR description says what to click through: a deck with a sideboard; tick "Include the sideboard" and see
  the price and the TCGplayer link change.

## Verify
npm run verify
