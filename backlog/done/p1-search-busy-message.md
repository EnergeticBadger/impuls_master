---
id: p1-search-busy-message
title: Say so on screen when Scryfall is busy or the network fails
phase: P1
priority: 1
---
## Goal
A search that fails because Scryfall is busy (503 from our proxy) or rate-limited (429) shows nothing; it
looks like a search that found no cards. Seen 7 Oct: the same search found its cards on the next try.
Only 404 and 400 get the pop-up today (`app/Components/Searchbar/Searchbar.tsx`, the `catch` in `go`,
around the `error.status === 404 || error.status === 400` check).

## Acceptance criteria
- New pure function `searchErrorMessage(status: number | undefined): string | undefined` in
  `app/Components/Searchbar/searchErrors.ts`: 404 and 400 keep today's text; 503 and 429 give "Scryfall is
  busy right now. Try again in a moment."; no status (network failure) gives "Couldn't reach the search.
  Check your connection and try again."; anything else gives undefined (logged as today).
- `Searchbar.tsx` uses it in place of the 404/400 check, in the same pop-up.
- `app/Components/Searchbar/searchErrors.test.ts` covers every case above.
- PR description says what to click through: stop the dev Worker's network (or force a 503) and search.

## Verify
npm run verify
