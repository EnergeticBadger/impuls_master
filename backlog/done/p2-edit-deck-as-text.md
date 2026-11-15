---
id: p2-edit-deck-as-text
title: Edit a whole deck as a text list on the deck page
phase: P2
priority: 6
depends_on: [p2-deck-undo, fix-card-by-name-variants]
model: sonnet
timeout_min: 50
---
## Goal
Many deck builders work faster in a text list than with buttons. Let them open the deck as text, edit it
and save it back, using the import parser and lookup that already exist.

## Acceptance criteria
- Move the lookup in `runImport` in `app/routes/decks.tsx` (build `lines` from the parsed list, call
  `cardsByName`, `deckFromLines`, collect the "Card not found" notes) into one exported async function
  `lookUpDeckList(text, onProgress)` in a new `app/Components/Deck/lookUpDeckList.ts`. It returns
  `{ deck, notes }`. `decks.tsx` calls it and behaves exactly as before.
- On `app/routes/deck.tsx`, an "Edit as text" button opens a textarea (`aria-label="Deck list"`,
  `box-sizing: border-box`, full width) filled with `formatDeckList(deck, "text")`, plus "Save" and
  "Cancel" buttons. While it is open the card sections are hidden.
- "Save" runs `lookUpDeckList` and shows "Finding cards… done / total" in a `role="status"` element. With no
  notes it replaces the deck through the page's `change(...)` helper (so Undo restores the old list) and
  closes the editor. With notes it lists them and offers "Save anyway" and "Back to the list", as the
  import form does.
- Cards whose line did not change keep the card objects they had (no new lookup), so a long deck saves
  quickly. Put the "which lines changed" logic in a pure, tested function: `unchangedEntries(deck, text)`
  (or similar) in `app/lib/decklist.ts` with tests in `decklist.test.ts`: unchanged list (all reused), one
  count changed, one card added, one removed, a card moved to the sideboard.
- Fits at 360px wide.
- PR description says what to click through: change a count, add a line, delete a line, type a made-up
  card and "Save anyway", then Undo.

## Verify
npm run verify
