---
id: p2-partner-model
title: Let a deck hold a second commander (partners and backgrounds) in the deck model
phase: P2
priority: 2
depends_on: []
model: sonnet
timeout_min: 50
max_turns: 80
---
## Goal
P2 requires Commander checks, but a deck can hold only one commander. Pairs are common (Partner,
"Partner with", Friends forever, Choose a Background, Doctor's companion), and their legality is
wrong today: the partner counts as a main-deck card and its colors aren't part of the deck's identity.
This task changes only the pure model. Import/export and the deck page come in follow-up tasks.

## Acceptance criteria
- `app/lib/deck.ts`: `Deck` gets an optional `partner?: DeckEntry` (the second commander, count 1).
  The existing `commander` field keeps its meaning, so saved decks stay valid.
- `cardsOf` includes `partner`, so curve, colors, summary, basic land split, price and copy counts all
  count it, as they already count `commander`.
- New `commanderIdentity(deck: Deck): string[]` returns the union of the commander's and partner's color
  identities in WUBRG order. `deckColors` and the Commander color identity check in `legalityProblems`
  use it. The 100-card size check counts the partner too.
- New `canPartner(a: ScryfallCard, b: ScryfallCard): boolean`, which reads oracle text on any face:
  both have the "Partner" keyword on its own line (not "Partner with"); or `a` says "Partner with <b's
  name>" (and the other way round); or both say "Friends forever"; or one says "Choose a Background" and
  the other's type line has "Background"; or one says "Doctor's companion" and the other is a
  "Time Lord Doctor" creature.
- `legalityProblems` for commander: when there's a partner and `canPartner(commander, partner)` is false,
  add "<commander> and <partner> can't both be commanders.". A partner with no commander isn't possible
  (`setPartner` below won't make one), so it needs no check.
- New `setPartner(deck, card): Deck` works like `setCommander` (one copy out of main, any old partner back
  to main). `setCommander` keeps the partner. The input deck isn't changed.
- `app/lib/savedDecks.ts`: `slimDeck`, `readSavedDecks` and `copyDeck` keep `partner` the same way they
  keep `commander`.
- Tests in `app/lib/deck.test.ts` and `app/lib/savedDecks.test.ts` cover: two Partner cards (legal, identity
  is the union, size counts both); a "Partner with" pair; a Background pair; a pair that can't partner
  (one problem); `setPartner` replacing an old partner; slim and read round-trip with a partner.

## Verify
npm run verify
