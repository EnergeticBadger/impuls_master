---
id: fix-background-commander-slot
title: A Background listed first in an imported Commander section is wrongly flagged "can't be your commander"
phase: P2
priority: 4
model: sonnet
---
## Goal
PR #175 added "<name> can't be your commander." to `legalityProblems` (`app/lib/deck.ts:396-402`). It lets a
Background through only in the **partner** slot (`app/lib/deck.ts:399-400`); the commander slot is checked with
`canBeCommander` alone (`app/lib/deck.ts:396`), which is false for a "Legendary Enchantment — Background".

Which card lands in which slot is just file order: `parseDeckList` (`app/lib/decklist.ts:65-67`) makes the first
line of the Commander section the commander and the second the partner. Exports list the two commanders in any
order (alphabetical in several deck sites), and `canPartner` (`app/lib/deck.ts:147`) already accepts the pair
either way round.

Failure scenario: import
```
Commander
1 Raised by Giants
1 Wilson, Refined Grizzly
Deck
...
```
and set the format to Commander. `deck.commander` is Raised by Giants, `deck.partner` is Wilson. The pair passes
`canPartner`, yet the legality list shows "Raised by Giants can't be your commander.", so a legal deck never reads
"Legal in Commander". Swapped, the same two cards give no problem.

## Acceptance criteria
- In `legalityProblems` (Commander format), a Background in either slot is not flagged by the "can't be your
  commander" check when the deck has both a commander and a partner (whether the pair works stays the existing
  "can't both be commanders" check). A Background that is the only commander (no partner) is still flagged.
  A non-Background, non-commander card (e.g. an instant) is still flagged in either slot.
- Tests in `app/lib/deck.test.ts`, on cards shaped like Scryfall's (Raised by Giants: `type_line: "Legendary
  Enchantment — Background"`, its real oracle text; Wilson, Refined Grizzly: `type_line: "Legendary Creature —
  Bear Warrior"`, oracle text including the line "Choose a Background"):
  - commander Raised by Giants + partner Wilson: no "can't be your commander" and no "can't both be commanders"
    problem;
  - commander Wilson + partner Raised by Giants: still no such problem;
  - Raised by Giants alone as commander: "Raised by Giants can't be your commander.";
  - commander Raised by Giants + partner Shock (an Instant): "Shock can't be your commander." is reported.
- The existing legality tests still pass.
- Only `app/lib/deck.ts` and `app/lib/deck.test.ts` change.
- PR description says what a human should click: import the list above (padded to 100 green cards), set the format
  to Commander, and check that neither card is reported as unable to be a commander.

## Verify
npm run verify
