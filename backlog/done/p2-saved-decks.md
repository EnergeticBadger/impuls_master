---
id: p2-saved-decks
title: Keep decks in the browser: a valtio store saved to localStorage
phase: P2
priority: 4
depends_on: [p2-deck-model]
---
## Goal
Deck pages and the "Add to deck" button need somewhere to keep decks. No accounts yet: decks live in the
browser, the same way the compare drawer does (`app/Components/Context/compare.ts`).

## Acceptance criteria
- New pure module `app/lib/savedDecks.ts` (relative `.ts` imports or `import type` only):
  `type SavedDeck = { id: string; name: string; updated: number; deck: Deck }` (`Deck` from `./deck.ts`),
  `newDeck(name, now, id): SavedDeck`, and `readSavedDecks(json: unknown): SavedDeck[]` that keeps only
  well-formed decks (drops entries without an id, a name, or cards with `card.id` and a positive `count`).
- `app/lib/savedDecks.test.ts` covers `readSavedDecks` with junk input (null, a string, a deck missing its
  name, an entry with count 0) and a good deck round-tripping through `JSON.stringify`.
- New `app/Components/Context/decks.ts`: `decks = proxy<{ list: SavedDeck[]; current?: string }>`, plus
  `createDeck(name)`, `renameDeck(id, name)`, `deleteDeck(id)`, `setCurrentDeck(id)`, `updateDeck(id, fn)`
  (applies a `Deck => Deck` function from `deck.ts` and bumps `updated`) and `loadDecks()`.
  Decks are stored with `ref()` like compare's cards. Ids come from `crypto.randomUUID()`.
- Saved under the localStorage key `decks` with a `subscribe`, read by `loadDecks()` after hydration, called
  where `loadCompare()` is called. A failed save (storage full) is logged, not thrown.

## Verify
npm run verify
