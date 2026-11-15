---
id: p2-deck-import
title: Import a deck by pasting a list on the decks page
phase: P2
priority: 6
depends_on: [p2-card-by-name, p2-decks-page]
---
## Goal
People bring decks from Arena, MTGO and other sites. Paste the list, get a saved deck.

## Acceptance criteria
- On `app/routes/decks.tsx`, an "Import" button opens a textarea (`box-sizing: border-box`, full width) and
  a name input. "Import" runs `parseDeckList` from `app/lib/decklist.ts`, then `cardsByName` from
  `app/lib/card.ts`, showing "Finding cards… 12 / 40" while it works.
- The result is a new saved deck (main, sideboard, commander as parsed) made current, and the page goes to
  `/decks/<id>`.
- Parse problems and cards not found are listed before leaving the page, with "Import anyway" and "Back
  to the list" choices; nothing is saved until the person picks.
- Building the deck from the lookup results is a pure `deckFromLines(found)` in `app/lib/decklist.ts`
  (same card twice adds the counts), tested in `decklist.test.ts`.
- PR description says what to click through: paste an Arena export with a sideboard, a list with a typo
  in one name, and a Commander list.

## Verify
npm run verify
