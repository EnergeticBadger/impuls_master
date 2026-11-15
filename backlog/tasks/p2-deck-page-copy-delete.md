---
id: p2-deck-page-copy-delete
title: Copy or delete a deck from its own page
phase: P2
priority: 7
depends_on: [p2-extract-text-editor]
model: sonnet
---
## Goal
Copying and deleting a deck only work from the "My decks" list. People on a deck page (say, before trying a
risky change) want "Copy deck" right there, and "Delete deck" when they're done with it.

## Acceptance criteria
- `app/routes/deck.tsx`, in the totals row next to "All decks": a "Copy deck" button calls
  `duplicateDeck(id)` (`app/Components/Context/decks.ts`) and navigates to the copy's page.
- A "Delete deck" button asks first, like the list does: it turns into "Delete <name>?" (class
  `styles.danger` if `DeckPage.module.css` has one; otherwise add it, matching `Decks.module.css`) and "Keep".
  Confirming calls `deleteDeck(id)` and navigates to `/decks`.
- Opening the copy starts with an empty Undo history (as opening any other deck does).
- Fits at 360px wide; the buttons wrap. `npm run typecheck` is clean.
- PR description says what a human should click: Copy deck (lands on "<name> (copy)"), change it, go back to
  the original (unchanged); Delete deck, Keep (nothing happens), Delete deck, confirm (back on My decks, deck
  gone).

## Verify
npm run verify
