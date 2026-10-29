---
id: p2-add-to-deck
title: Add-to-deck button on search results and the quick view
phase: P2
priority: 5
depends_on: [p2-saved-decks, p1-quickview-keyboard]
---
## Goal
Building a deck starts from search: one tap adds the card to the deck being built.

## Acceptance criteria
- A new button in `app/Components/Card/Card.tsx`'s `button_box` and in `QuickView.tsx`, next to compare,
  that adds one copy of the card to the current deck (`decks.current`) with `addCard` through `updateDeck`.
  With no decks yet, the first tap creates "Untitled deck" and makes it current.
- The button shows how many copies are already in the current deck's main deck (a small number badge,
  nothing at 0) and has `title`/`aria-label` "Add to <deck name>".
- The quick view also has a − button when the card is in the deck.
- A small pure helper `copiesIn(deck, oracleId)` in `app/lib/deck.ts` (counts by oracle id across
  printings), tested in `app/lib/deck.test.ts`.
- Same 24px button size and icon style as the others; the button row still fits at 360px wide.
- PR description says what to click through: search, add a card three times, open the quick view,
  remove one, open the deck from `/decks`.

## Verify
npm run verify
