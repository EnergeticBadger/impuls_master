---
id: fix-can-be-commander
title: "Make commander" is missing for Grist and legendary Vehicles that can lead a Commander deck
phase: P2
priority: 4
model: sonnet
---
## Goal
`canBeCommander` (`app/lib/deck.ts:275-281`, PR #104) only accepts a front face that is a "Legendary ... Creature"
or a card whose text says "can be your commander". The deck page shows "Make commander" only when it is true
(`app/routes/deck.tsx:348`), so in Commander a few real, popular commanders can never be set:

- Grist, the Hunger Tide: type line "Legendary Planeswalker — Grist", text "As long as Grist, the Hunger Tide
  isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types." It is a creature in the
  command zone, so it is a legal commander, and Scryfall's `is:commander` returns it. `canBeCommander` gives false:
  no "Make commander" button, and the deck shows "There is no commander." forever.
- Legendary Vehicles and Spacecraft with power and toughness (The Falcon, Airship Restored): Scryfall's
  `is:commander` includes them; `canBeCommander` gives false.

The repo already has the rule, matched against Scryfall's `is:commander`: `canLead` in
`scripts/local-search.ts:897-899` (a front face that is legendary and a creature; or a legendary Vehicle /
Spacecraft with a power; or text "can be your commander" or "isn't on the battlefield, it's a ... creature").
The deck model disagrees with the site's own search, so `is:commander` finds Grist and the deck page refuses it.

Failure scenario: set a deck's format to Commander, add Grist, the Hunger Tide from search, open the deck page:
Grist's row has no "Make commander" button.

## Acceptance criteria
- `canBeCommander` in `app/lib/deck.ts` also returns true for:
  - a card whose oracle text (top level or any face) matches `isn't on the battlefield, it's a [^.]*\bcreature\b`
    (case-insensitive), as `canLead` does;
  - a front face that is Legendary and a Vehicle or Spacecraft, when the card (or its front face) has a `power`.
- It stays false for a Background on its own ("Legendary Enchantment — Background": that pairing is
  p2-partner-model's job), a legendary Vehicle/Spacecraft without power, a non-legendary creature, and a
  legendary artifact.
- Tests in `app/lib/deck.test.ts` on cards in Scryfall's API shape (`type_line`, `oracle_text`, `power`,
  `toughness` at the top level for single-faced cards):
  - Grist: `name: "Grist, the Hunger Tide"`, `type_line: "Legendary Planeswalker — Grist"`, `loyalty: "3"`,
    `oracle_text` starting with the real line above -> true.
  - `name: "The Falcon, Airship Restored"`, `type_line: "Legendary Artifact — Vehicle"`, `power: "4"`,
    `toughness: "4"` -> true; the same card without `power`/`toughness` -> false.
  - `type_line: "Legendary Enchantment — Background"` -> false.
  - The existing canBeCommander tests still pass.
- Only `app/lib/deck.ts` and `app/lib/deck.test.ts` change.
- PR description says what a human should click: a Commander-format deck holding Grist, the Hunger Tide; its row
  shows "Make commander", pressing it moves Grist to the Commander section and "There is no commander." goes away.

## Verify
npm run verify
