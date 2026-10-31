---
id: p2-deck-text-format
title: Read and write deck lists as plain text, Arena and MTGO
phase: P2
priority: 4
depends_on: [p2-deck-model]
---
## Goal
Decks move between sites as text. Reading a list gives card names and counts to look up; writing one gives
text another site accepts.

## Acceptance criteria
- New `app/lib/decklist.ts`: `parseDeckList(text): { main: Line[]; side: Line[]; commander?: Line;
  problems: string[] }` with `Line = { count: number; name: string; set?: string; number?: string }`.
  Reads "4 Opt", "4x Opt", Arena's "4 Opt (XLN) 65", "Sideboard"/"Commander" headers and a blank line
  before the sideboard (MTGO). Unreadable lines go in `problems` with their line number.
- `formatDeckList(deck, style: "text" | "arena" | "mtgo"): string` for the deck from `app/lib/deck.ts`.
- `app/lib/decklist.test.ts`: each format reads back what it writes, and real-looking lists from each
  site parse (put them inline in the test).

## Verify
npm run verify
