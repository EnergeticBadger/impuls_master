---
id: p2-deck-model
title: Deck model: counts, type groups, mana curve, colors and format legality
phase: P2
priority: 3
timeout_min: 50
---
## Goal
The core of deck building, as pure code with no UI yet, so the deck page and import/export can build on it.

## Acceptance criteria
- New `app/lib/deck.ts`. It takes cards by `import type` from `~/types` (the `ScryfallCard` shape) and keeps
  no state of its own. A deck is `{ main: DeckEntry[]; side: DeckEntry[]; commander?: DeckEntry }` with
  `DeckEntry = { card: ScryfallCard; count: number }`.
- Functions: `addCard`, `removeCard` (returning new decks), `groupByType` (Creature, Planeswalker,
  Instant, Sorcery, Artifact, Enchantment, Battle, Land, by the front face's type line), `manaCurve` (0..7+,
  lands excluded), `colorCounts`, and `legalityProblems(deck, format)`: cards not legal in the format, too
  many copies (4, basic lands and "any number" cards exempt), deck size, and for commander: singleton,
  100 cards, color identity within the commander's.
- `app/lib/deck.test.ts` with small hand-made card objects (no network, no card data files).

## Verify
npm run verify
