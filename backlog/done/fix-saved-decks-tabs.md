---
id: fix-saved-decks-tabs
title: Saved decks: don't let one browser tab wipe decks made in another
phase: P2
priority: 3
model: sonnet
---
## Goal
The decks store (PR #88) reads localStorage once and then writes its whole in-memory list on every change
(`app/Components/Context/decks.ts:56-61`, the `subscribe`). It never hears about writes from other tabs, so
the last tab to change anything overwrites the others' decks:

1. Tab 1: search page (`loadDecks()` runs, list is `[]` or the old decks).
2. Tab 2: open `/decks` (header link in a new tab), create "Burn".
3. Back in tab 1, tap Add on Lightning Bolt -> tab 1 has no "Burn" in memory, so it creates "Untitled deck"
   (or adds to an older deck) and saves `{ list: [<tab 1's decks>] }`. "Burn" is gone for good on reload.

Decks are the user's work (unlike the compare drawer), so this is data loss.

## Acceptance criteria
- `decks.ts` listens for the `storage` event on `window` and, when `event.key === 'decks'`, reloads the store
  from `event.newValue` through `readSavedDecks` (keeping `current` if that deck still exists), without writing
  the same value straight back (no ping-pong between tabs).
- `readSavedDecks` output re-serialises to the same JSON it was read from for a well-formed deck, so a reload
  can't trigger a changed write: a test in `app/lib/savedDecks.test.ts` with a realistic deck (cards shaped
  like Scryfall's API objects: `id`, `oracle_id`, `name`, `type_line`, `legalities`, `image_uris`,
  `card_faces` for a DFC, plus a commander) checks
  `JSON.stringify(readSavedDecks(JSON.parse(s))) === s` where `s` is the stringified list.
- PR description says what to click through: open the search page and `/decks` in two tabs, create a deck in
  `/decks`, add a card in the search tab, reload both: both decks are there.
- Only `app/Components/Context/decks.ts`, `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts` change.

## Verify
npm run verify
