---
id: fix-decklist-reversible-names
title: Deck lists: write reversible cards by their one name, not "Propaganda // Propaganda"
phase: P2
priority: 5
model: sonnet
---
## Goal
PR #96 made `write` in `app/lib/decklist.ts:94` use `card_faces[0].name` for Arena and MTGO, but only for
layouts `transform`, `modal_dfc`, `adventure` and `flip`. It misses `reversible_card`. Scryfall names those
printings (Secret Lair reversible cards) "Front // Back" with the same name on both faces, e.g.
`name: "Propaganda // Propaganda"`. No game or site knows the card by that name.

These cards do end up in decks. Search results are raw Scryfall `cards/search` objects (`Searchbar.tsx:38`,
see `fix-add-to-deck-reversible`), and tapping Add on a reversible printing stores it as it is. Then:
- "Copy for MTGO" writes `1 Propaganda // Propaganda`, and MTGO rejects the line.
- "Copy for Arena" writes `1 Propaganda // Propaganda (SLD) <number>`. Arena doesn't have the SLD set, so it
  falls back to the name, which it also doesn't know.
- The `text` style writes `1 Propaganda // Propaganda`, which no other site recognises. Importing that list
  back into this app looks the card up under the doubled name.

## Acceptance criteria
- In `write` (`app/lib/decklist.ts`), a card with `layout: "reversible_card"` is written by
  `card_faces[0].name` in **all** styles, `text` included, because the doubled name isn't the card's name
  anywhere. If `card_faces[0].name` is missing, fall back to `card.name` as now. Leave the existing
  transform/modal_dfc/adventure/flip handling as it is (front name for arena/mtgo, full name for text), and
  keep `split` cards (Fire // Ice) on their full name.
- A test in `app/lib/decklist.test.ts` uses a reversible card in Scryfall's real API shape:
  `layout: "reversible_card"`, `name: "Propaganda // Propaganda"`, no top-level `oracle_id`, set `sld`,
  collector number `"1446"`, and `card_faces` both
  `{ name: "Propaganda", oracle_id: "prop-oracle", type_line: "Enchantment", mana_cost: "{2}{U}" }`. It checks
  that `formatDeckList` writes `1 Propaganda (SLD) 1446` for arena, `1 Propaganda` for mtgo and
  `1 Propaganda` for text.
- The existing Bonecrusher Giant and Fire // Ice assertions still pass unchanged.
- Only `app/lib/decklist.ts` and `app/lib/decklist.test.ts` change.

## Verify
npm run verify
