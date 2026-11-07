---
id: p2-deck-row-order
title: Sort cards in each deck section by mana value, then name
phase: P2
priority: 5
model: haiku
---
## Goal
The deck page (`app/routes/deck.tsx`) lists cards inside each type group in the order they were added, so a
long deck is hard to scan. Sort them the way deck builders expect: cheapest first, then by name.

## Acceptance criteria
- New pure `sortEntries(entries: readonly DeckEntry[]): DeckEntry[]` in `app/lib/deck.ts`: a new array
  sorted by `card.cmc` (missing counts as 0) ascending, then by `card.name` with `localeCompare`. It does
  not change the input array.
- `groupByType` returns each group's entries through `sortEntries`.
- The sideboard section on `app/routes/deck.tsx` uses `sortEntries(deck.side)` as well.
- Tests in `app/lib/deck.test.ts`: mana value order; equal mana value falls back to name; a card with no
  `cmc` sorts as 0; the input array is untouched; `groupByType` output is sorted inside a group.
- PR description says what to look at: a deck page with several creatures at different costs.

## Verify
npm run verify
