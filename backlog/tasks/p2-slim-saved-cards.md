---
id: p2-slim-saved-cards
title: Save only the card fields decks need, so localStorage doesn't fill up
phase: P2
priority: 4
model: sonnet
---
## Goal
`app/Components/Context/decks.ts` saves every deck entry's whole `ScryfallCard` to localStorage. A full card
is several KB (prices, purchase URIs, all image sizes, related cards…), so a few 100-card Commander decks can
reach the browser's ~5 MB limit, and then `setItem` throws and every later change is silently lost. Keep
only what the deck code uses.

## Acceptance criteria
- New pure `slimCard(card: ScryfallCard): ScryfallCard` in `app/lib/savedDecks.ts` that keeps only: `id`,
  `oracle_id`, `name`, `layout`, `mana_cost`, `cmc`, `type_line`, `oracle_text`, `colors`, `color_identity`,
  `legalities`, `set`, `collector_number`, `rarity`, `prices` (only `usd`, `usd_foil`, `eur`, `tix`),
  `image_uris` (only `small` and `normal`), and `card_faces` (each face: `name`, `mana_cost`, `type_line`,
  `oracle_text`, `colors`, `image_uris` with `small` and `normal`). Fields that are missing stay missing (no
  `undefined` keys written). If `ScryfallCard` makes some of these required, satisfy the type without `any`.
- `slimDeck(deck: Deck): Deck` applies it to main, side and commander.
- `addToCurrentDeck` and `updateDeck` in `decks.ts` store slimmed cards (slim the result of the update), and
  `readSavedDecks` slims what it reads, so decks saved before this change shrink on the next save.
- Tests in `app/lib/savedDecks.test.ts`: a card with extra fields (`purchase_uris`, `related_uris`,
  `image_uris.png`, `all_parts`) comes back without them and with every kept field equal; a double-faced card
  keeps both faces' names, mana costs and small images; `JSON.stringify` of a slimmed realistic card is less
  than half the length of the original; `colorCounts`, `manaCurve` and `legalityProblems` from
  `app/lib/deck.ts` give the same results on a slimmed deck as on the original.
- Only `app/lib/savedDecks.ts`, `app/lib/savedDecks.test.ts` and `app/Components/Context/decks.ts` change.

## Verify
npm run verify
