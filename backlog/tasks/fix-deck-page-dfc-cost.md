---
id: fix-deck-page-dfc-cost
title: Deck page: show double-faced cards' mana cost when the card came from our card data
phase: P2
priority: 4
model: sonnet
---
## Goal
The deck page (PR #93) shows no mana cost for transform and modal double-faced cards that came from the
site's card data. In production that covers every imported deck and, if the card page builds its card with
`printingCard`, every card added from a card page too.

`manaCostOf` in `app/routes/deck.tsx:22` is
`entry.card.mana_cost ?? card_faces?.map(f => f.mana_cost).filter(Boolean).join(" // ") ?? ""`. Scryfall leaves
top-level `mana_cost` off `transform` and `modal_dfc` cards, so the card data build stores no `mana_cost` on
the record (`scripts/card-data.ts:193`, `clean()` drops `undefined`). Then `printingCard`
(`app/lib/carddata.ts:277`) sets `mana_cost: record.mana_cost ?? ""`. The empty string isn't nullish, so `??`
never reaches the faces:
- 4 Delver of Secrets // Insectile Aberration imported from a list -> the row shows no cost (should be `{U}`).
- Valakut Awakening // Valakut Stoneforge -> no cost (should be `{2}{R}{R}`).

It only works on Scryfall API-shaped cards, where top-level `mana_cost` is absent (`undefined`).

## Acceptance criteria
- A pure `manaCostOf(card: ScryfallCard): string` in `app/lib/deck.ts` (exported, tested), used by
  `app/routes/deck.tsx` instead of the local helper. Use the top-level `mana_cost` when it is non-empty;
  otherwise join the faces' non-empty `mana_cost`s with `" // "`; otherwise `""`.
- Tests in `app/lib/deck.test.ts`, with cards built by `printingCard` from `app/lib/carddata.ts` on
  `CardRecord`s shaped like the real build (no top-level `mana_cost` for DFCs, `faces` with `mana_cost`):
  - Delver of Secrets (`layout: "transform"`, faces `{U}` and `""`) gives `"{U}"`.
  - Valakut Awakening // Valakut Stoneforge (`modal_dfc`, faces `{2}{R}{R}` and `""`) gives `"{2}{R}{R}"`.
  - Fire // Ice (`split`, record `mana_cost: "{1}{R} // {1}{U}"`) keeps `"{1}{R} // {1}{U}"`.
  - Forest (record without `mana_cost`, no faces) gives `""`.
  - Delver in Scryfall's API shape (no top-level `mana_cost`) also gives `"{U}"`.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts` and `app/routes/deck.tsx` change.
- PR description: import `4 Delver of Secrets` and `1 Valakut Awakening` on /decks and check that both rows on
  the deck page show their costs.

## Verify
npm run verify
