---
id: p2-commander-search
title: Limit search to the current deck's commander colors with one click
phase: P2
priority: 7
depends_on: [p2-current-deck-bar, p2-deck-legality]
model: sonnet
---
## Goal
While building a Commander deck, people only want cards inside their commander's color identity. Scryfall's
`id<=` does that; offer it from the current deck bar instead of making people type it.

## Acceptance criteria
- New pure `identityTerm(colors: readonly string[]): string` in `app/lib/deck.ts`: `["U","B"]` gives `id<=ub`
  (WUBRG order, lower case), `[]` gives `id:c`. Tests in `app/lib/deck.test.ts`, including order
  (`["G","W"]` gives `id<=wg`).
- New pure `toggleTerm(query: string, term: string): string` in `app/Components/Searchbar/searchUrl.ts` (or a
  new `queryTerms.ts` next to it, with a test): adds the term to the end when absent, removes it (and the extra
  space) when present; also replaces any other `id<=`/`id:` term so there's only one. Tests for add, remove,
  replace, and an empty query.
- In `app/Components/Deck/CurrentDeckBar.tsx`, when the current deck has a commander: a toggle button
  "In <commander name>'s colors" that runs the search with `toggleTerm(query, identityTerm(...))` through the
  existing query state in `app/Components/Context/query.ts`; it shows as pressed (`aria-pressed`) when the
  query already has that term.
- PR description says what to click through: set a commander in a deck, toggle the button on and off on the
  search page, check the query box and results.

## Verify
npm run verify
