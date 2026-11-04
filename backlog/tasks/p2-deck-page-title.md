---
id: p2-deck-page-title
title: Show the deck's name in the browser tab title
phase: P2
priority: 7
model: haiku
---
## Goal
Every deck page's tab says "Deck | Impulse Caster", so several open decks look the same. Decks live in
localStorage, so the route's `meta()` can't see the name; set it once the deck is loaded.

## Acceptance criteria
- In `app/routes/deck.tsx`, a `useEffect` sets `document.title` to `<deck name> | Impulse Caster` when the
  deck is found, and updates it when the deck is renamed. Keep `meta()` as it is (it is the title before
  the deck loads and for crawlers).
- When no deck is found, the title is "No deck here | Impulse Caster".
- The effect sits with the other hooks, before the early returns, so the hook order never changes.
- PR description says what to look at: open a deck, rename it, check the tab title follows.

## Verify
npm run verify
