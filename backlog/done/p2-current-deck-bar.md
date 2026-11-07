---
id: p2-current-deck-bar
title: Show which deck search results are added to, and let people switch it
phase: P2
priority: 5
depends_on: [p2-deck-page]
model: sonnet
---
## Goal
The add-to-deck buttons on search results (`app/Components/Card/Card.tsx`, `QuickView.tsx`) add to the
current deck, but the search page never says which deck that is. Show it, and let people switch.

## Acceptance criteria
- New `app/Components/Deck/CurrentDeckBar.tsx` (+ `CurrentDeckBar.module.css`), shown on `app/routes/home.tsx`
  near the results only when at least one deck exists (decks are loaded with `loadDecks` after hydration,
  as `decks.tsx` does; no flash before that).
- It shows "Adding to" and a `<select>` of the saved decks (most recently updated first) with the deck chosen
  by `currentDeckOf(list, current)`; picking one calls `setCurrentDeck`. Next to it: the main deck card count
  ("37 cards") and an "Open" link to `/decks/<id>`.
- Fits on one or two lines at 360px wide with no horizontal scroll; a long deck name is cut with an ellipsis.
- The sort order of the options is a pure `decksByRecent(list)` in `app/lib/savedDecks.ts`, tested in
  `savedDecks.test.ts` (and used by `decks.tsx` in place of its inline sort).
- PR description says what to click through: with two decks, switch decks in the bar, add a card from search,
  open the deck and check it landed there.

## Verify
npm run verify
