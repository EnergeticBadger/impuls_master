---
id: p2-decks-filter
title: Filter the my decks list by name
phase: P2
priority: 7
depends_on: [p2-decks-list-summary]
model: sonnet
---
## Goal
With a dozen saved decks the my decks page is a long list to scroll on a phone. Add a name filter.

## Acceptance criteria
- New pure `filterDecks<T extends { name: string }>(list: readonly T[], query: string): T[]` in
  `app/lib/savedDecks.ts`, tested in `savedDecks.test.ts`: matching is case-insensitive and ignores
  accents (use `normalize("NFD")` and drop combining marks); every word of the query must appear in the
  name, in any order; an empty or whitespace query returns the whole list; the order is kept.
- On `app/routes/decks.tsx`, when there are 6 or more decks, a search input (`type="search"`,
  `aria-label="Filter decks"`, placeholder "Filter decks", `box-sizing: border-box`) above the list filters
  it as you type. The filter is page state only, not saved.
- When nothing matches, show "No decks match "<query>"." instead of the list.
- Fits at 360px wide.
- PR description says what to click through: make 6 decks, filter by part of a name, by two words in the
  other order, and by a word that matches nothing.

## Verify
npm run verify
