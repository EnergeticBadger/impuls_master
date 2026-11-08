---
id: fix-reversible-mana-value
title: Reversible cards count as mana value 0 in the deck's curve, sort and groups
phase: P2
priority: 4
model: sonnet
---
## Goal
Scryfall's API leaves top-level `cmc` off `layout: "reversible_card"` cards and puts it on each `card_faces[]`
entry (as `scripts/local-search.ts:356-357` already notes: "a reversible printing keeps these on its faces only",
`mv: c.cmc ?? faces[0]?.cmc ?? 0`). The deck code only reads the top level:

- `sortEntries` (`app/lib/deck.ts:117-120`, PR #114): `a.card.cmc ?? 0`.
- `curveSlot` (`app/lib/deck.ts:132`), used by `manaCurve` (the deck page's mana curve, `DeckStats`, PR #106) and
  `groupByManaValue`.
- `deckSummary` (`app/lib/deck.ts:194`): `(card.cmc ?? 0) * count` for the average mana value.

On top of that, `slimCard` drops a face's `cmc` (`FACE_KEYS`, `app/lib/savedDecks.ts:60`), so a saved deck loses the
value even where it was there.

Raw Scryfall cards do reach decks: the deck row's "Printing" picker (`app/Components/Deck/PrintingPicker.tsx:27`)
lists `unique=prints` straight from Scryfall and `replacePrinting` stores the chosen object; search results also come
from Scryfall whenever the Worker falls back (`workers/search.ts`).

Failure scenario: a deck holds 1 Propaganda (mana value 3). On its row, tap Printing and choose the Secret Lair
reversible printing (`name: "Propaganda // Propaganda"`, no top-level `cmc`, faces `cmc: 3`). The mana curve now shows
it at 0 instead of 3, it jumps to the top of the Enchantment section (sorted as 0), "Group by: Mana value" lists it
under "Mana value 0", and the deck's average mana value drops.

## Acceptance criteria
- `CardFace` in `app/types.ts` gets an optional `cmc?: number`.
- New exported `manaValueOf(card: ScryfallCard): number` in `app/lib/deck.ts`: `card.cmc`, else
  `card.card_faces?.[0]?.cmc`, else 0. `sortEntries`, `curveSlot` and `deckSummary` use it.
- `slimCard` in `app/lib/savedDecks.ts` keeps `cmc` on each face when present (add it to `FACE_KEYS`).
- Tests on a reversible card in Scryfall's real API shape: `layout: "reversible_card"`, `name: "Propaganda //
  Propaganda"`, no top-level `cmc`, `oracle_id`, `mana_cost` or `type_line`; both `card_faces` `{ object: "card_face",
  name: "Propaganda", oracle_id: "prop-oracle", mana_cost: "{2}{U}", cmc: 3, type_line: "Enchantment", oracle_text:
  "...", colors: ["U"] }`:
  - in `app/lib/deck.test.ts`: `manaValueOf` gives 3; a deck with it and a 1-mana and a 4-mana enchantment:
    `manaCurve` has 1 at index 3 (0 at index 0), `sortEntries` puts it between them, `groupByManaValue` lists it
    under "3", `deckSummary(...).averageManaValue` counts it as 3.
  - in `app/lib/savedDecks.test.ts`: `manaValueOf(slimCard(card))` is 3, and still 3 after `readSavedDecks` of a
    saved deck holding it.
  - The existing "no cmc sorts as 0" test still passes (a card with no cmc anywhere is 0).
- Only `app/types.ts`, `app/lib/deck.ts`, `app/lib/deck.test.ts`, `app/lib/savedDecks.ts` and
  `app/lib/savedDecks.test.ts` change.
- PR description says what a human should click: on a deck with Propaganda, change its printing to the Secret Lair
  reversible one and check the curve, the Enchantment section's order and "Group by: Mana value" keep it at 3.

## Verify
npm run verify
