---
id: fix-deck-dfc-colors
title: Deck model: count double-faced cards' colors and allow Nazgûl and Seven Dwarves in Commander
phase: P2
priority: 3
model: sonnet
---
## Goal
Two defects in `app/lib/deck.ts` (from PR #83), both hidden by hand-made test cards that real data doesn't
look like.

1. **Double-faced cards count as colorless.** `colorCounts` reads only the top-level `card.colors`
   (`app/lib/deck.ts:88`). Scryfall leaves top-level `colors` out for `transform` and `modal_dfc` cards and
   puts it on each `card_faces[]` entry instead; our compact card data has no face colors at all, and
   `printingCard` (`app/lib/carddata.ts:286`) turns the missing top-level `colors` into `[]`. So
   4 Delver of Secrets (front face `{U}`) gives `{ U: 0, ..., C: 4 }` instead of `{ U: 4, C: 0 }`; the same
   for Valakut Awakening, Brutal Cathar, every MDFC spell. The test's `mdfc` card sets a top-level
   `colors: ["R"]` that real data doesn't have. (`CardFace` in `app/types.ts` also lacks `colors`.)
2. **Commander caps "up to N cards named" cards at one.** `legalityProblems` sets the Commander limit to 1
   for everything except basics and "any number" cards (`app/lib/deck.ts:134`). Card text overrides the
   singleton rule, so a Commander deck with 9 Nazgûl ("A deck can have up to nine cards named Nazgûl.") or
   7 Seven Dwarves gets "Nazgûl appears 9 times; Commander decks are singleton." It should use
   `copyLimit(card)` when that is not 4 (9 for Nazgûl, 7 for Seven Dwarves) and 1 otherwise.

## Acceptance criteria
- `colorCounts` takes a card's colors from top-level `colors` when it has any, else from the front face:
  `card_faces[0].colors` when present (API shape), else the colored mana symbols in `card_faces[0].mana_cost`
  (compact-data shape, including hybrid symbols like `{W/U}`). A truly colorless card (Ornithopter, `colors: []`,
  no faces) still counts as C. Add `colors?: string[]` to `CardFace` in `app/types.ts`.
- Tests in `app/lib/deck.test.ts` on realistic card shapes:
  - Delver of Secrets as Scryfall's API returns it: `layout: "transform"`, no top-level `colors`,
    `card_faces: [{ name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature — Human Wizard",
    colors: ["U"] }, { name: "Insectile Aberration", mana_cost: "", type_line: "Creature — Human Insect",
    colors: ["U"] }]`; 4 copies give `U: 4, C: 0`.
  - The same card as `printingCard` builds it from compact data (top-level `colors: []`, faces with
    `mana_cost` but no `colors`) also gives `U: 4, C: 0`.
  - Valakut Awakening // Valakut Stoneforge (`modal_dfc`, front `{2}{R}{R}` Instant) counts as R; replace
    the existing `mdfc` fixture's fake top-level `colors` with the real shape.
- Tests: a Commander deck with 9 Nazgûl (oracle text "A deck can have up to nine cards named Nazgûl.") has
  no copy problem; 10 Nazgûl does ("the limit is 9"); 7 Seven Dwarves is fine; 2 Grizzly Bears still gets
  the singleton problem; Relentless Rats stays unlimited.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts` and `app/types.ts` change.

## Verify
npm run verify
