---
id: fix-deck-price-etched
title: Deck price counts etched-only printings as "no price"
phase: P2
priority: 5
model: sonnet
---
## Goal
Scryfall keeps an etched foil's price in its own field, `prices.usd_etched`. Printings that only come etched
(many Commander Legends, Commander Masters and Secret Lair printings, e.g. the CMR etched "Jeweled Lotus") have
`usd: null`, `usd_foil: null`, `usd_etched: "<price>"`. The rest of the site already falls back to it
(`app/lib/carddata.ts:365`, `app/routes/card.tsx:57`), but the deck price from PR #117 does not:

- `deckPrice` (`app/lib/deck.ts:294`) falls back only from `usd` to `usd_foil`.
- `slimCard` (`app/lib/savedDecks.ts:71`) keeps only `usd`, `usd_foil`, `eur`, `tix`, so a saved deck loses
  `usd_etched` anyway. Every deck card goes through `slimDeck` (`app/Components/Context/decks.ts`, `updateDeck`).

Failure scenario: a deck holds an etched-only printing (pick it with the row's "Printing" picker, or import
"1 Jeweled Lotus (CMR) 612"). The deck page shows "(1 card has no price)" with "Jeweled Lotus" in the title, and
"About $…" leaves it out, though Scryfall has a USD price for it and the card page shows that price.

## Acceptance criteria
- `slimCard` in `app/lib/savedDecks.ts` also keeps `usd_etched`.
- `deckPrice` in `app/lib/deck.ts`, for `usd`: `usd`, else `usd_foil`, else `usd_etched`. `eur` and `tix`
  behave as they do now.
- Tests on cards in Scryfall's real price shape (all six keys present, unused ones `null`):
  - in `app/lib/deck.test.ts`: a card with `prices: { usd: null, usd_foil: null, usd_etched: "12.34", eur: null,
    eur_foil: null, tix: null }`, count 2, gives `total: 24.68` and `missing: []` for `usd`; a card with all six
    `null` is still listed in `missing`; the existing deckPrice tests still pass.
  - in `app/lib/savedDecks.test.ts`: `slimCard` of that etched-only card keeps `usd_etched: "12.34"`, and
    `deckPrice` of a deck read back through `readSavedDecks(JSON.parse(JSON.stringify([saved])))` still totals
    it. Update the existing slim-prices assertion (`savedDecks.test.ts:161`) for the kept key.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts`, `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts`
  change.
- PR description says what a human should click: on a deck, switch a card to an etched-only printing with
  "Printing" (Commander Legends etched cards are an example); the estimate goes up by its price and no
  "no price" note appears for it.

## Verify
npm run verify
