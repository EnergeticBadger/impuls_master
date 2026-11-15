---
id: p2-deck-export
title: Export a deck as text, Arena or MTGO from the deck page
phase: P2
priority: 7
depends_on: [p2-deck-page, p2-deck-text-format]
model: haiku
---
## Goal
Take a deck built here to Arena, MTGO or another site.

## Acceptance criteria
- On `app/routes/deck.tsx`, an "Export" section with three buttons: "Copy as text", "Copy for Arena",
  "Copy for MTGO". Each copies `formatDeckList(deck, style)` from `app/lib/decklist.ts` to the clipboard
  and the button says "Copied" for 2 seconds (as `Card.tsx`'s copy button does); a failed copy shows the
  text in a read-only textarea to copy by hand.
- A "Download .txt" link for the MTGO style (a Blob URL, file name from the deck name).
- No changes to `decklist.ts` itself unless a bug is found (then add a test for it).
- PR description says what to click through: copy each style and paste it into a text editor.

## Verify
npm run verify
