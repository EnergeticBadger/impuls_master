---
id: p2-decks-sort
title: Sort the decks list by name as well as by most recent
phase: P2
priority: 7
depends_on: []
model: sonnet
---
## Goal
`/decks` always lists decks by last change. With many decks, people look for one by name. Add a sort toggle.

## Acceptance criteria
- New pure `decksByName<T extends { name: string }>(list: readonly T[]): T[]` in `app/lib/savedDecks.ts`:
  case-insensitive, `localeCompare` with `numeric: true` (so "Deck 2" comes before "Deck 10"), and it
  doesn't change its input. Tests in `app/lib/savedDecks.test.ts`: case, numbers, accents
  ("Éowyn" sorts with E), input untouched.
- `app/routes/decks.tsx`: with two or more decks, a "Sort:" group with two `aria-pressed` buttons, "Recent"
  (default) and "Name", like the deck page's "Group by" toggle. The name filter applies on top of the sort.
- The choice is page state only (not saved). Fits at 360px wide.
- PR description says what to click through: three decks, switch to Name, filter, switch back.

## Verify
npm run verify
