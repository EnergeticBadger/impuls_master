---
id: p2-sample-hand
title: Draw a sample opening hand on the deck page
phase: P2
priority: 8
depends_on: [p2-deck-page]
model: sonnet
---
## Goal
Deck builders test their mana by drawing practice hands. Add a simple, local draw tester.

## Acceptance criteria
- New pure module `app/lib/sampleHand.ts`:
  - `libraryOf(deck: Deck): ScryfallCard[]`: one element per copy in the main deck (no sideboard, no commander).
  - `shuffle<T>(items: readonly T[], random: () => number): T[]`: Fisher–Yates, returns a new array.
  - `drawHand(library, size, random)`: shuffles and returns `{ hand, rest }`.
- Tests in `app/lib/sampleHand.test.ts` with a seeded `random` (a small LCG written in the test): `libraryOf`
  has as many cards as the main deck count; `shuffle` keeps every element and doesn't change its input; the same
  seed gives the same order; `drawHand` with 7 gives 7 in hand and the rest in `rest`; a 5-card library gives
  a 5-card hand.
- New `app/Components/Deck/SampleHand.tsx` (+ `SampleHand.module.css`) on `app/routes/deck.tsx`: "Draw
  7" deals a hand of small card images (from the cards' own `image_uris`, no new fetches), "Mulligan" deals
  one card fewer (down to 1), "Draw a card" adds the next card from the library. Uses `Math.random`.
  Disabled with a note when the main deck is empty.
- Images wrap in rows at 360px wide with no horizontal scroll.
- PR description says what to click through: draw, mulligan twice, draw a card.

## Verify
npm run verify
