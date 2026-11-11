---
id: fix-edit-text-blank-line
title: A blank line in "Edit as text" silently moves the rest of the main deck to the sideboard
phase: P2
priority: 4
model: sonnet
---
## Goal
"Edit as text" (PR #137) fills the textarea with `formatDeckList(deck, "text")`, which marks every section with
a header ("Commander", "Deck", "Sideboard") or, for a deck with only a main deck, no header at all. Saving runs
`lookUpDeckList(text, ..., known)` (`app/routes/deck.tsx:200`) -> `unchangedEntries` (`app/lib/decklist.ts:105`)
-> `parseDeckList`, which follows MTGO's rule that a blank line in the main deck starts the sideboard
(`app/lib/decklist.ts:34`). That rule is right for pasted MTGO lists, but in the editor a blank line is just
an edit: deleting a line's text often leaves an empty line, and people add blank lines to group cards.

Failure scenario: a 60-card deck with no sideboard; open "Edit as text", which shows
```
4 Opt
2 Fire // Ice
20 Island
```
Clear the "2 Fire // Ice" line but leave it empty, so the text is `4 Opt\n\n20 Island\n`, and press Save. No
note is shown (it isn't a problem to the parser) and the deck is saved with 20 Island in the sideboard: the main
deck count drops to 4. The same happens after the "Deck" header of a Commander deck: every card below a blank
line ends up in the sideboard.

## Acceptance criteria
- `parseDeckList` in `app/lib/decklist.ts` takes an optional second argument, `{ blankLineStartsSideboard?:
  boolean }` (default `true`, so imports, quick add and deck links behave exactly as now). With `false`, a blank
  line never moves the main deck to the sideboard; it still ends the Commander section; the "Sideboard" header
  and "SB:" lines still work.
- `unchangedEntries` (the edit path) parses with `blankLineStartsSideboard: false`. The import path (no `known`
  deck in `app/Components/Deck/lookUpDeckList.ts`) is unchanged.
- Tests in `app/lib/decklist.test.ts`, using the file's existing `deck` fixture and `formatDeckList(..., "text")`
  output as the starting text:
  - a main-only deck's text with one line blanked out (`4 Opt\n\n20 Island\n`): `unchangedEntries` reuses both
    cards in `main`, nothing in `side`, no lookups;
  - the full fixture's text (Commander, Deck, Sideboard headers) with an extra blank line between "4 Opt" and
    "2 Fire // Ice": Fire // Ice and Island stay `main`, Negate stays `side`, Atraxa stays commander;
  - the existing MTGO test ("reads an MTGO list with a blank line before the sideboard") still passes, and
    `parseDeckList` with no options still sends lines after a blank line to the sideboard.
- Only `app/lib/decklist.ts` and `app/lib/decklist.test.ts` change.
- PR description says what a human should click: on a deck with no sideboard, "Edit as text", empty one line in
  the middle (leave the blank line), Save; the main deck count only drops by that card and the sideboard stays
  empty.

## Verify
npm run verify
