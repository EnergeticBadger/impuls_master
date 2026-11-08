---
id: fix-slim-card-face-oracle
title: Saved decks keep the faces' oracle id, so reversible cards still show their in-deck count
phase: P2
priority: 4
model: sonnet
---
## Goal
PR #101 (`p2-slim-saved-cards`) slims every saved card with `slimCard` (`app/lib/savedDecks.ts`). Each face
keeps only `FACE_KEYS` (`app/lib/savedDecks.ts:44`: `name`, `mana_cost`, `type_line`, `oracle_text`,
`colors`), so a face's `oracle_id` is dropped.

Scryfall's API leaves top-level `oracle_id` off `layout: "reversible_card"` cards and puts it only on each
`card_faces[]` entry. `oracleOf` (`app/lib/carddata.ts:61`) reads it from there, and `copiesIn` / `sameCard`
(`app/lib/deck.ts:37`, `:54`) rely on it (that was the whole fix in `fix-add-to-deck-reversible`). Search
results are raw Scryfall objects, and `addToCurrentDeck` -> `updateDeck` (`app/Components/Context/decks.ts:52`)
now stores the slimmed card, which has no oracle id anywhere.

Failure scenario: search `propaganda`, tap Add on the Secret Lair reversible printing
(`name: "Propaganda // Propaganda"`, faces each `{ name: "Propaganda", oracle_id: ... }`) three times.
The deck holds 3, but `copiesIn(deck, oracleOf(card))` is 0, so the badge in `Card.tsx:26` and the count/−
button in `QuickView.tsx:100` never appear. A deck with 2 regular Propaganda + 1 reversible shows 2, not 3.
Decks saved before #101 lose the face oracle id too, because `readSavedDecks` slims what it reads.

## Acceptance criteria
- `slimCard` in `app/lib/savedDecks.ts` keeps `oracle_id` on each face when it is present (add it to
  `FACE_KEYS`); nothing else in the kept-field list changes.
- Tests in `app/lib/savedDecks.test.ts` on a reversible card in Scryfall's real API shape: `layout:
  "reversible_card"`, `name: "Propaganda // Propaganda"`, no top-level `oracle_id`, set `sld`, both
  `card_faces` `{ object: "card_face", name: "Propaganda", oracle_id: "prop-oracle", mana_cost: "{2}{U}",
  type_line: "Enchantment", oracle_text: "...", colors: ["U"], artist: "...", image_uris: {...all six sizes} }`:
  - `oracleOf(slimCard(card))` is `"prop-oracle"`.
  - `addCard` the slimmed card 3 times, then `slimDeck`: `copiesIn(deck, "prop-oracle")` is 3; with 2 of a
    regular Propaganda (top-level `oracle_id: "prop-oracle"`) plus 1 reversible, it is 3.
  - `readSavedDecks` of a saved deck holding that card keeps the faces' oracle id.
- Only `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts` change.
- PR says what a human should click: search `propaganda`, add the Secret Lair reversible printing twice, and
  check the add button shows 2.

## Verify
npm run verify
