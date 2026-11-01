---
id: p2-card-page-add-to-deck
title: Add-to-deck and remove buttons on the card page
phase: P2
priority: 5
depends_on: [fix-add-to-deck-reversible]
model: sonnet
---
## Goal
Search results and the quick view can add a card to the current deck (`app/Components/Card/Card.tsx`,
`QuickView.tsx`), but the card page (`app/routes/card.tsx`), where people read a card before choosing it,
can't. The deck page's empty state even says "Add some from a card page".

## Acceptance criteria
- On `app/routes/card.tsx`, near the card image's existing buttons: "Add to <deck name>" calling
  `addToCurrentDeck(card)` from `app/Components/Context/decks.ts`, plus, when the deck already has copies
  (counted with `copiesIn` as `QuickView.tsx` does), "In deck: 3" and a "Remove one" button calling
  `removeFromCurrentDeck(card)`.
- Decks are loaded with `loadDecks()` in an effect (after hydration, as `deck.tsx` does), so server and
  client render the same thing first. With no decks yet, the add button creates one the way the search
  results' button does (reuse the same code path, don't copy it).
- The buttons fit at 360px wide with no horizontal scroll and are reachable by keyboard.
- The empty-state text on `app/routes/deck.tsx` changes to "No cards yet. Add some from search or a card page."
- PR description says what to click through: open a card page, add it twice, check the count, remove one,
  open the deck and check it has one copy; also a double-faced card.

## Verify
npm run verify
