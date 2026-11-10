---
id: p2-extract-format-section
title: Move the deck page's format picker and legality problems into their own component
phase: P2
priority: 6
depends_on: [p2-deck-page-remove-commander]
model: sonnet
---
## Goal
Keep shrinking `app/routes/deck.tsx`. The "Format" select and the "Legal in …" / problem list (with links to
card rows) become one component. This is a pure move.

## Acceptance criteria
- New `app/Components/Deck/FormatSection.tsx` exports `FormatSection({ id, deck, format, anchorOf })`, where
  `anchorOf(name: string): string | undefined` gives the row anchor for a card name (the page keeps building
  `anchored` because rows use it). It owns `FORMATS`, `formatLabel`, the `legalityProblems` call and
  `cardNamed`, and calls `setDeckFormat(id, ...)` as today.
- Pure helpers that are worth testing (e.g. `cardNamed(problem, names)`, longest matching name wins) move to a
  pure module such as `app/lib/deck.ts` with a test; otherwise keep them in the component.
- `deck.tsx` still needs `isCommander` for the commander buttons; it may compute that from `saved.format`.
- Same CSS classes from `~/routes/DeckPage.module.css`; no visible change. `npm run typecheck` is clean.
- PR description says what a human should click: pick Commander on a deck with problems, click a problem's
  card link (jumps to the row), switch to "No format".

## Verify
npm run verify
