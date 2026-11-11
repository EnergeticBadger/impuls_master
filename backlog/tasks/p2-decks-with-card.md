---
id: p2-decks-with-card
title: Find which saved decks hold a card
phase: P2
priority: 5
depends_on: []
model: sonnet
---
## Goal
The card page only shows copies in the current deck (`copiesIn`, main deck only). People with several decks
want to know "which of my decks already run this?". Add the pure lookup first; p2-card-page-in-decks shows it.

## Acceptance criteria
- New exported `decksWithCard(list: readonly SavedDeck[], oracleId: string | undefined): { id: string; name:
  string; count: number }[]` in `app/lib/savedDecks.ts`: for each deck, copies of the card in main, sideboard,
  commander and partner together, matched by oracle id with `oracleOf` (`./carddata.ts`, so any printing and
  reversible cards count); decks with 0 are left out; in the list's order. `undefined` oracle id gives `[]`.
- Tests in `app/lib/savedDecks.test.ts`: a card in main of one deck and sideboard of another; as commander;
  as partner; two printings of it in one deck add up; a deck without it is left out; `undefined` gives `[]`;
  a reversible printing (oracle id only on its faces) is found.
- Only `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts` change.

## Verify
npm run verify
