---
id: fix-deck-price-eur-foil
title: The euro deck price counts foil-only printings as "no price"
phase: P2
priority: 5
model: sonnet
---
## Goal
PR #166 added a currency picker to the deck price estimate (`app/Components/Deck/BuyDeck.tsx`). In dollars,
`deckPrice` falls back from `usd` to `usd_foil` and then to `usd_etched`. In euros it has no fallback at all
(`app/lib/deck.ts:294`: `prices?.[opts.currency] ?? (opts.currency === "usd" ? ... : undefined)`). Scryfall
keeps a foil-only printing's Cardmarket price in `prices.eur_foil` and leaves `eur: null`. Secret Lair drops,
promos and many foil-only Commander printings look like this. On top of that, `slimCard`
(`app/lib/savedDecks.ts:71`) keeps only `usd`, `usd_foil`, `usd_etched`, `eur` and `tix`, so a saved deck
loses `eur_foil` before `deckPrice` ever sees it. Every deck card goes through `slimDeck` on save.

Failure scenario: a deck holds a foil-only printing whose Scryfall prices are
`{ usd: null, usd_foil: "8.00", usd_etched: null, eur: null, eur_foil: "7.50", tix: null }`. In USD the
estimate includes $8.00. Switch the picker to EUR and it shows "(1 card has no price)" for that card and leaves
it out of "About €…", even though the card page shows "EUR foil €7.50" for the same printing.

## Acceptance criteria
- `slimCard` in `app/lib/savedDecks.ts` also keeps `eur_foil`.
- `deckPrice` in `app/lib/deck.ts`, for `eur`: `eur`, else `eur_foil`. `usd` keeps its order (`usd`,
  `usd_foil`, `usd_etched`) and `tix` is unchanged. Update the comment above `deckPrice` to match.
- Tests on cards in Scryfall's real price shape (all six keys present, unused ones `null`):
  - in `app/lib/deck.test.ts`: the card above, count 2, gives `total: 15` and `missing: []` for `eur`, and
    `total: 16` for `usd`; a card with all six `null` is still in `missing` for `eur`; the existing
    deckPrice tests still pass. If the existing test that expects `missing: ["A", "B", "C"]` for `eur` relied
    on a card that only has a foil price, update it and say so in the PR.
  - in `app/lib/savedDecks.test.ts`: `slimCard` of that card keeps `eur_foil: "7.50"`, and `deckPrice` (eur)
    of a deck read back through `readSavedDecks(JSON.parse(JSON.stringify([saved])))` still totals 15.
    Update the existing slim-prices assertion for the kept key.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts`, `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts`
  change.
- The PR description says what a human should click: on a deck, use "Printing" to switch a card to a
  foil-only printing (a Secret Lair one, for example), then pick EUR. The estimate includes it and shows no
  "no price" note for it.

## Verify
npm run verify
