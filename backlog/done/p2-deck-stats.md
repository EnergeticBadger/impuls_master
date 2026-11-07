---
id: p2-deck-stats
title: Mana curve and color breakdown on the deck page
phase: P2
priority: 6
depends_on: [p2-deck-page]
---
## Goal
Show the shape of a deck at a glance, using `manaCurve` and `colorCounts` from `app/lib/deck.ts`.

## Acceptance criteria
- New `app/Components/Deck/DeckStats.tsx` (+ `DeckStats.module.css`) used on `app/routes/deck.tsx`.
- Mana curve: one bar per mana value 0 to 7+, height relative to the tallest, with the count above and the
  value below. Plain CSS bars, no chart library, no new dependencies.
- Colors: one chip per color in the deck (W U B R G, and colorless) with its count, using the site's
  mana symbols if `ManaText` can render them.
- Bar heights come from a pure helper `curveBars(curve: number[]): { label: string; count: number;
  pct: number }[]` in `app/Components/Deck/deckStats.ts`, tested in `deckStats.test.ts` (empty deck gives
  all zeros, not NaN).
- Fits at 360px wide.
- PR description says what to look at: a deck with spells at several costs, and an empty deck.

## Verify
npm run verify
