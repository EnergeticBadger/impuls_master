---
id: p1-quickview-keyboard
title: Esc closes the card quick view; left and right arrows move between cards
phase: P1
priority: 2
---
## Goal
The quick view (`app/Components/Card/QuickView.tsx`) can only be closed and navigated with the mouse or touch.

## Acceptance criteria
- Esc closes the quick view; ArrowLeft / ArrowRight show the previous / next card of the current results
  (no wrap at the ends). Keys typed into an input or textarea are ignored.
- The key-to-action mapping is a pure function in `app/Components/Card/quickViewKeys.ts`
  (`quickViewAction(key, index, count, inInput): "close" | { go: number } | undefined`), tested in
  `quickViewKeys.test.ts`, including both ends of the list and keys in an input.
- One `keydown` listener while the quick view is open, removed on close (follow the pattern in
  `app/Components/Searchbar/QueryInput.tsx`).
- Focus moves into the quick view when it opens and back to the card that opened it on close.
- PR description lists what to click through: open a card, Esc, arrows at both ends, typing in the search box.

## Verify
npm run verify
