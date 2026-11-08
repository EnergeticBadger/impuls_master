---
id: fix-remove-card-wrong-entry
title: Deck page − and "To sideboard" change the wrong row when two printings share an oracle id
phase: P2
priority: 4
model: sonnet
---
## Goal
PR #102 (fix-add-to-deck-reversible) made `removeCard` (`app/lib/deck.ts:44`) take copies out of the *first*
entry that `sameCard` matches, and `sameCard` (`app/lib/deck.ts:37`) now matches by `oracleOf`. But `addTo`
(`app/lib/deck.ts:25`) still keeps entries apart by name, so a deck can hold two rows with the same oracle id:
a regular "Propaganda" and a Secret Lair reversible "Propaganda // Propaganda" (Scryfall's real shape: no
top-level `oracle_id`, `card_faces[]` both carry it). The deck page passes the row's own card to
`removeCard`, and now the first oracle match wins instead of that row:

- `app/routes/deck.tsx:200` (the row's − button): main = [Propaganda ×2, Propaganda // Propaganda ×1]. Tap −
  on the reversible row -> the regular row drops to 1 and the reversible row still shows 1.
- `app/routes/deck.tsx:30` (`move`, "To sideboard"): same deck, tap "To sideboard" on the reversible row ->
  `removeCard(deck, reversible, "main", 1)` takes one out of the *regular* row, then the reversible card is
  added to the side. Main still lists the reversible card, the regular count is wrong. With the reversible row
  at ×3 and regular ×2, moving the reversible row deletes the whole regular row (2 - 3 < 0, filtered out) and
  leaves the reversible ×3 in main *and* ×3 in the side: two Propagandas vanish, three are duplicated.

The PR's own test (`app/lib/deck.test.ts`, the `lessRegular` assertion expecting `[1, 2]`) locks this in:
removing the regular card takes a copy out of the reversible row ahead of it.

## Acceptance criteria
- `removeCard` takes copies out of the entry with the same `name` as the card when there is one, and only
  falls back to the first `sameCard` (oracle id) match when no entry has that name. Keep the oracle fallback,
  so the quick view's − (a search result printing with a different name) still removes a copy.
- Tests in `app/lib/deck.test.ts` on Scryfall-shaped cards (regular Propaganda with top-level
  `oracle_id: "prop-oracle"`; reversible `layout: "reversible_card"`, `name: "Propaganda // Propaganda"`, no
  top-level `oracle_id`, both `card_faces` `{ name: "Propaganda", oracle_id: "prop-oracle", ... }`):
  - main [regular ×2, reversible ×1]: `removeCard(deck, reversible)` gives counts [2] (reversible row gone);
    `removeCard(deck, regular)` gives [1, 1].
  - main [reversible ×2, regular ×2]: `removeCard(deck, regular)` gives [2, 1] (replace the old `lessRegular`
    expectation of [1, 2]).
  - main [regular ×2, reversible ×3]: `removeCard(deck, reversible, "main", 3)` leaves only regular ×2.
  - a reversible card whose name is in no entry still removes one copy from the regular row (oracle fallback).
- Only `app/lib/deck.ts` and `app/lib/deck.test.ts` change.
- PR description says what to click through: add a regular and a reversible printing of the same card to a
  deck (any card with a Secret Lair reversible printing; add the regular and the reversible one from search), open the deck page, tap − and "To sideboard" on the reversible row and
  check only that row changes.

## Verify
npm run verify
