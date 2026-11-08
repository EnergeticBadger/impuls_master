---
id: p2-set-commander
title: Make a card the deck's commander from the deck page
phase: P2
priority: 4
depends_on: [p2-deck-undo]
model: sonnet
---
## Goal
A deck only gets a commander today when an imported list names one. Someone building a Commander deck from
search has no way to pick theirs. Let them promote a main-deck card to commander on the deck page.

## Acceptance criteria
- New pure functions in `app/lib/deck.ts`, tested in `app/lib/deck.test.ts`:
  - `canBeCommander(card: ScryfallCard): boolean`: true for a legendary creature (`type_line`, or the
    front face's `type_line` for double-faced cards, has both "Legendary" and "Creature"), or a card whose
    oracle text (any face) says "can be your commander". Otherwise false.
  - `setCommander(deck: Deck, card: ScryfallCard): Deck`: takes one copy of `card` out of the main deck
    (matched the same way `removeCard` matches) and makes it the commander with count 1. Any commander
    already there goes back into the main deck. The input deck is not changed.
- Tests: a legendary creature, a "can be your commander" planeswalker, a double-faced card whose front is a
  legendary creature, a non-legendary creature (false); `setCommander` on a deck with no commander, on a
  deck that already has one (the old one ends up in `main`), and on a 2-of (one copy stays in main).
- On `app/routes/deck.tsx`, main-deck rows of cards where `canBeCommander` is true get a "Make commander"
  button (`aria-label="Make <name> the commander"`). It goes through the page's `change(...)` helper from
  p2-deck-undo, so it can be undone.
- The commander row keeps its existing "To main" button.
- Fits at 360px wide; row buttons may wrap, no horizontal scroll.
- PR description says what to click through: add a legendary creature from search, make it commander,
  make a second one commander (the first goes back to main), undo.

## Verify
npm run verify
