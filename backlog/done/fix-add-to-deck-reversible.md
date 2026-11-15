---
id: fix-add-to-deck-reversible
title: Add-to-deck count and remove button work for reversible cards
phase: P2
priority: 5
model: sonnet
---
## Goal
The add-to-deck badge and the quick view's remove button (PR #90) never appear for reversible cards.

`Card.tsx:25` and `QuickView.tsx:99` call `copiesIn(deck, card.oracle_id)`, and `copiesIn`
(`app/lib/deck.ts:41`) returns 0 when the oracle id is missing. Scryfall's API leaves top-level `oracle_id`
off `layout: "reversible_card"` cards and puts it on each `card_faces[]` entry instead (the repo already
handles this: `oracleOf` in `app/lib/carddata.ts:60`, "reversible cards keep the oracle id on their faces").
Search results come straight from Scryfall's `cards/search` (`Searchbar.tsx:38`), so for a Secret Lair
reversible printing:
- tap Add three times -> the deck holds 3 copies, but the badge shows nothing and the quick view says
  "Add to deck" with no count and no − button, so the card can't be removed from the quick view.
- the same holds when the deck has the regular printing and the reversible one is in the results.

`removeCard`'s `sameCard` (`app/lib/deck.ts:29`) has the same gap (it falls back to comparing names, and a
reversible card's name is "Propaganda // Propaganda", not "Propaganda").

## Acceptance criteria
- `copiesIn` and `sameCard` in `app/lib/deck.ts` resolve oracle ids with `oracleOf` (import it from
  `./carddata.ts`, which has no runtime imports) on both the deck entry and the card; `Card.tsx` and
  `QuickView.tsx` pass the oracle id from `oracleOf(card)` (or the card itself, if `copiesIn` takes a card).
- `removeCard` takes copies out of one matching entry, not every entry that matches.
- Tests in `app/lib/deck.test.ts` with a reversible card in Scryfall's real shape: `layout: "reversible_card"`,
  no top-level `oracle_id`, `name: "Propaganda // Propaganda"`, `card_faces` both `{ name: "Propaganda",
  oracle_id: "prop-oracle", ... }`; and a regular Propaganda with top-level `oracle_id: "prop-oracle"`.
  Adding the reversible one 3 times gives `copiesIn` 3; a deck with 2 regular + 1 reversible gives 3;
  `removeCard` with the reversible card takes one copy out and leaves the other entry alone.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts`, `app/Components/Card/Card.tsx` and
  `app/Components/Card/QuickView.tsx` change.

## Verify
npm run verify
