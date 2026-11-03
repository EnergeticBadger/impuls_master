---
id: fix-mtgo-commander-export
title: MTGO export: no section headers, commander after the blank line, so MTGO doesn't read the 99 as sideboard
phase: P2
priority: 4
depends_on: [fix-decklist-arena-names]
model: sonnet
---
## Goal
PR #109 added "Copy for MTGO" and "Download .txt" on the deck page (`app/routes/deck.tsx:51`, `:88`), both
from `formatDeckList(deck, "mtgo")`. For a deck with a commander, that writes Arena-style section headers
(`app/lib/decklist.ts:94` pushes `Commander`, `:97` adds `Deck` whenever there is a commander):

```
Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring
...
```

MTGO's .txt format has no section headers: it reads `count name` lines, and the first blank line starts the
sideboard. MTGO (and Moxfield's MTGO export) puts a Commander deck's commander in the sideboard. So the file
above imports as: a bad line `Commander`, Atraxa in the main deck, then everything after the blank line
(the whole 99) in the sideboard. A commander deck exported for MTGO is unusable. The unit tests miss it
because they only check that our own `parseDeckList` reads the output back, never MTGO's shape.

## Acceptance criteria
- In `app/lib/decklist.ts`, the `mtgo` style never writes `Commander`, `Deck` or `Sideboard` header lines when
  there is a main deck. With a commander it writes the main deck, one blank line, then the commander line,
  then the sideboard lines (same block, no extra blank line). Without a commander the output is unchanged.
- `text` and `arena` output is unchanged.
- Tests in `app/lib/decklist.test.ts`, on a realistic Commander deck (Atraxa, Praetors' Voice as commander,
  a main deck of e.g. `1 Sol Ring`, `1 Command Tower`, `30 Forest`, no sideboard):
  - `formatDeckList(deck, "mtgo")` equals `"1 Sol Ring\n1 Command Tower\n30 Forest\n\n1 Atraxa, Praetors' Voice\n"`,
    and contains no line matching `/^(Commander|Deck|Sideboard)$/m`.
  - `parseDeckList` of that output reads 32 main-deck cards and Atraxa in `side` with no problems.
  - The existing `mtgo: reads back what it writes` round-trip test is adjusted for MTGO only: the commander
    comes back as a sideboard line (MTGO has no commander zone); `text` and `arena` still return it as
    `commander`.
- Only `app/lib/decklist.ts` and `app/lib/decklist.test.ts` change.
- PR says what a human should click: on a deck with a commander, Download .txt and check the file is the main
  deck, a blank line, then the commander.

## Verify
npm run verify
