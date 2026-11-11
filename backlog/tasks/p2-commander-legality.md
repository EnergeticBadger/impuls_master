---
id: p2-commander-legality
title: Flag a commander (or partner) that can't be a commander in the legality check
phase: P2
priority: 5
depends_on: []
model: sonnet
---
## Goal
`legalityProblems(deck, "commander")` (`app/lib/deck.ts`) checks size, singleton, color identity and whether
two commanders can pair, but not whether the commander itself may be one. An imported list can put any card in
the Commander section (e.g. "Commander\n1 Lightning Bolt"), and the deck page then says "Legal in Commander"
once the other rules pass.

## Acceptance criteria
- In a Commander-format check, `legalityProblems` adds `"<name> can't be your commander."` when
  `!canBeCommander(deck.commander.card)`.
- For the partner: the same sentence when it is neither `canBeCommander` nor a Background (a creature-less
  "Legendary Enchantment — Background" partner is fine; whether the pair works is still the existing
  "can't both be commanders" check).
- Other formats are unchanged.
- Tests in `app/lib/deck.test.ts`: Lightning Bolt as commander gives the new problem; a legendary creature
  commander does not; a Background partner with a "Choose a Background" commander does not; an instant as
  partner does. Existing legality tests still pass.
- Only `app/lib/deck.ts` and `app/lib/deck.test.ts` change.
- PR description says what a human should click: import "Commander\n1 Lightning Bolt\nDeck\n1 Island", set the
  format to Commander, and see "Lightning Bolt can't be your commander." with a link to its row.

## Verify
npm run verify
