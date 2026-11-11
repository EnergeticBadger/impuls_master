---
id: fix-slim-card-power
title: Keep power on saved cards so legendary Vehicles can be made commander
phase: P2
priority: 3
depends_on: []
model: sonnet
---
## Goal
PR #160 (fix-can-be-commander) made `canBeCommander` (`app/lib/deck.ts:326-327`) accept a legendary Vehicle or
Spacecraft only when the card or its front face has a `power`. But every card in a saved deck goes through
`slimCard` (`app/lib/savedDecks.ts:62-65`), and neither `CARD_KEYS` nor `FACE_KEYS` keeps `power` (or
`toughness`). `updateDeck` (`app/Components/Context/decks.ts:71`) slims on every change, including
`addToCurrentDeck`, and `readSavedDecks` slims on load. So the deck page never sees a power and the new Vehicle
branch can't fire there. #160's test used an un-slimmed card, so it passed.

Failure scenario: set a deck's format to Commander, add "The Falcon, Airship Restored" (Legendary Artifact —
Vehicle, 4/4) from search, open the deck page: its row has no "Make commander" button, though
`canBeCommander` on the search result gives true.

## Acceptance criteria
- `slimCard` in `app/lib/savedDecks.ts` keeps `power` and `toughness`, at the top level and on each face.
- Tests in `app/lib/savedDecks.test.ts` on cards in Scryfall's API shape:
  - `canBeCommander(slimCard(falcon))` is true, where `falcon` has `name: "The Falcon, Airship Restored"`,
    `type_line: "Legendary Artifact — Vehicle"`, `power: "4"`, `toughness: "4"` plus fields slimCard drops
    (e.g. `artist`, `image_uris.large`).
  - The same after a JSON round trip through `readSavedDecks` of a deck holding it.
  - A transform card whose faces carry `power`/`toughness` keeps them on the slimmed faces.
- Only `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts` change.

## Verify
npm run verify
