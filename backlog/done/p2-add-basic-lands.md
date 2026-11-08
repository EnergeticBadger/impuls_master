---
id: p2-add-basic-lands
title: Add basic lands split by the deck's colors in one step
phase: P2
priority: 6
depends_on: [p2-deck-land-count]
model: sonnet
timeout_min: 50
---
## Goal
After picking spells, people add a pile of basics in proportion to their colors. Today that means typing
"9 Mountain" and "8 Island" one by one into quick add. Do the split for them.

## Acceptance criteria
- New pure `basicLandSplit(deck: Deck, count: number): { color: "W" | "U" | "B" | "R" | "G"; count: number }[]`
  in `app/lib/deck.ts`: shares `count` basics between the colors by the colored mana symbols in the main
  deck's and commander's mana costs (hybrid symbols count half for each color; generic, colorless and X
  don't count), weighted by card count. Use largest-remainder rounding so the parts add up to exactly
  `count`; ties go in WUBRG order. Colors with no symbols get nothing; a deck with no colored symbols gives
  `[]`. Returned in WUBRG order with zero entries left out.
- Tests in `app/lib/deck.test.ts`: mono-red gives all Mountains; 10 R + 10 U symbols and 17 lands gives
  U 9 + R 8 (a tie goes to the earlier color in WUBRG order); hybrid `{W/U}` counts half each; counts weight symbols;
  a colorless deck gives `[]`; the parts always sum to `count`.
- On `app/routes/deck.tsx`, an "Add basic lands" button (near quick add) opens a small form: a number
  input (`aria-label="Number of basic lands"`, `box-sizing: border-box`, default `max(0, 40% of the deck
  size rounded − lands already in the deck)`, using `deckSummary` from p2-deck-land-count; 100-card decks
  count the commander) that previews the split as mana symbols ("{R} 9 · {U} 8") and an "Add" button.
- "Add" looks up Plains/Island/Swamp/Mountain/Forest with `cardByName` (from `app/lib/card.ts`, which goes
  through our proxy) and adds them through the page's `change(...)` helper in one step, so one Undo takes
  them all back. A failed lookup shows a message and adds nothing.
- Fits at 360px wide.
- PR description says what to click through: a two-color deck, add 17 basics, check the split and counts,
  undo once.

## Verify
npm run verify
