---
id: p2-card-by-name
title: Look up a card by name (and set/number) for deck import
phase: P2
priority: 5
depends_on: [p2-deck-text-format]
---
## Goal
An imported list gives names, sometimes with a set and collector number. Turn each into a `ScryfallCard`,
from our own card data files first and Scryfall (through the proxy) only when those aren't there.

## Acceptance criteria
- In `app/lib/carddata.ts`, a pure `pickPrinting(record: CardRecord, set?: string, number?: string):
  Printing` that returns the printing matching set and number, else the first printing of that set, else
  the printing the card's page opens on (`record.prints[record.main]`). Tested in a new `app/lib/carddata.test.ts`
  with a hand-made record.
- In `app/lib/card.ts`, `cardByName(line: { name: string; set?: string; number?: string }):
  Promise<ScryfallCard | undefined>`: finds the bucket by `slug(name)` (front face name for "A // B"),
  the header entry by slug, then `printingCard(record, pickPrinting(...))`. When the data file isn't there
  (local dev) it calls `scryfallGet("cards/named?exact=...")` (adding `&set=` when given). Never call
  Scryfall directly. Undefined when nothing is found.
- `cardsByName(lines, onProgress?)` looks lines up one after another (so Scryfall fallbacks stay within
  the proxy's spacing) and returns `{ found: { line, card }[]; missing: Line[] }`.
- Name matching ignores case and accents (it goes through `slug`).

## Verify
npm run verify
