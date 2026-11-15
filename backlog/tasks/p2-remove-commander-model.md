---
id: p2-remove-commander-model
title: Remove a commander or partner in the deck model without leaving a partner on its own
phase: P2
priority: 4
depends_on: []
model: sonnet
---
## Goal
A deck can now hold a partner (`Deck.partner`, `app/lib/deck.ts`), but removing a commander is still done by a
local helper in the page (`removeAsCommander`, `app/routes/deck.tsx:44`) that sets `commander: undefined` and
leaves the partner behind: a deck with a partner and no commander, which nothing shows and `setPartner` would
never make. `readSavedDecks` (`app/lib/savedDecks.ts:113`) also keeps such a partner. Put the rules in the
model, with tests, so the page can use them (p2-deck-page-remove-commander).

## Acceptance criteria
- New exported `removeCommander(deck: Deck): Deck` in `app/lib/deck.ts`: the commander goes back to the main
  deck (merging with copies there, like `setCommander` does), and a partner, if any, moves up to the commander
  slot. No commander: the deck comes back unchanged. The input is never changed.
- New exported `removePartner(deck: Deck): Deck`: the partner goes back to main; the commander stays. No
  partner: unchanged.
- `readSavedDecks` in `app/lib/savedDecks.ts`: a saved deck with a partner but no commander gets that partner
  added to its main deck instead (no card is lost).
- Tests in `app/lib/deck.test.ts`: removeCommander with no partner, with a partner (partner becomes commander,
  old commander in main, `partner` undefined), with none (same object back is fine); removePartner both ways;
  neither mutates its input. In `app/lib/savedDecks.test.ts`: reading `[{ id, name, deck: { main: [], side: [],
  partner: <entry> } }]` gives a main deck holding that card and no partner.
- Only `app/lib/deck.ts`, `app/lib/deck.test.ts`, `app/lib/savedDecks.ts` and `app/lib/savedDecks.test.ts`
  change.

## Verify
npm run verify
