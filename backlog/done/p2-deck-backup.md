---
id: p2-deck-backup
title: Back up all decks to a file and restore them
phase: P2
priority: 6
depends_on: [p2-slim-saved-cards]
model: sonnet
---
## Goal
Decks live only in this browser until accounts exist. Clearing site data or switching phones loses them.
Let people download every deck as one file and load it back.

## Acceptance criteria
- New pure functions in `app/lib/savedDecks.ts`:
  - `backupJson(list: SavedDeck[]): string`: `{ "app": "impulse-caster", "version": 1, "decks": [...] }`,
    cards slimmed with `slimCard`.
  - `readBackup(text: string): { decks: SavedDeck[]; error?: string }`: invalid JSON or a file without
    `app: "impulse-caster"` gives no decks and a one-line error; otherwise the decks go through
    `readSavedDecks`, so bad entries are dropped, never thrown on.
  - `mergeDecks(existing: SavedDeck[], incoming: SavedDeck[]): SavedDeck[]`: a deck with a new id is added;
    with an id already present, the one with the later `updated` wins.
- On `app/routes/decks.tsx`, under the list: "Back up decks" downloads `impulse-caster-decks-YYYY-MM-DD.json`
  (Blob URL), and "Restore from file" (a file input) merges the file's decks in and says
  "Restored 3 decks" or shows the error. Hidden when there are no decks to back up (restore stays).
- A `restoreDecks(incoming: SavedDeck[])` in `app/Components/Context/decks.ts` applies `mergeDecks`.
- Tests in `app/lib/savedDecks.test.ts`: backup then read gives the same decks; garbage text, `{}`, and a
  different app's JSON give an error; merge adds new ids, keeps the newer of two with one id.
- PR description says what to click through: back up, delete a deck, restore, check it's back.

## Verify
npm run verify
