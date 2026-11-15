---
id: p2-deck-undo
title: Undo deck page changes, and remove a card in one click
phase: P2
priority: 6
model: sonnet
---
## Goal
On the deck page a mis-tap is permanent, and taking a card out completely means pressing "−" once per copy.
Add a "Remove" button per row, made safe by an "Undo" for the last few changes.

## Acceptance criteria
- New pure module `app/lib/history.ts` with `history.test.ts`:
  `type History<T> = { past: T[]; present: T }`, `startHistory(present)`, `record(h, next, limit = 20)`
  (pushes the present onto `past`, keeps at most `limit` entries, dropping the oldest), `undo(h)` (returns
  `h` unchanged when `past` is empty) and `canUndo(h)`. Tests for each, including the limit.
- `app/routes/deck.tsx` keeps a `History<Deck>` for the open deck in component state (not saved). Every
  change made on the page (count steps, moves, remove, and any later deck-page actions that use the same
  helper) goes through one `change(fn: (d: Deck) => Deck)` that records and calls `updateDeck`. Opening
  another deck starts a fresh history.
- An "Undo" button near the totals, disabled when there is nothing to undo; pressing it writes the previous
  deck back with `updateDeck` and announces "Undone" in a `role="status"` element.
- Each main and sideboard row gets a "Remove" button (`aria-label="Remove all <name>"`) that takes every
  copy out of that zone.
- Fits at 360px wide: the row buttons may wrap, but no horizontal scroll.
- PR description says what to click through: remove a 4-of, undo, move a card to the sideboard, undo twice.

## Verify
npm run verify
