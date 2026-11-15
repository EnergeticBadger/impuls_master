---
id: p2-partner-decklist
title: Import and export two commanders in deck lists
phase: P2
priority: 3
depends_on: [p2-partner-model]
model: sonnet
---
## Goal
After p2-partner-model a deck can have a `partner`, but `app/lib/decklist.ts` reads at most one
commander line and marks a second as "extra". Partner decks from Arena, Moxfield and MTGO lists should
come in and go out intact.

## Acceptance criteria
- `parseDeckList` accepts up to two lines in the Commander section: the second becomes `partner?: Line`
  on the result. A third line is still a problem ("there are already two commanders").
- `unchangedEntries`, `deckFromLines` and the `Zone` type handle a `"partner"` zone (or another equally
  clear way of carrying the second commander), so "Edit as text" keeps the partner without a new lookup.
- `formatDeckList`: text and Arena styles list both under "Commander"; MTGO puts both at the top of the
  sideboard block, as it does with one commander today.
- `app/Components/Deck/lookUpDeckList.ts` passes the partner through to the deck.
- Tests in `app/lib/decklist.test.ts`: parse a list with two commanders; a third is a problem; every
  style round-trips a deck with commander and partner (format, then parse, gives the same names and zones);
  a one-commander list is unchanged.

## Verify
npm run verify
