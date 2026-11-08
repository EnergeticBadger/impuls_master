---
id: p2-deck-land-count
title: Show land count and average mana value in the deck stats
phase: P2
priority: 6
model: sonnet
---
## Goal
The first two numbers deck builders check are how many lands they run and how high their curve sits. The
stats section (`app/Components/Deck/DeckStats.tsx`) shows a curve and colors but neither number.

## Acceptance criteria
- New pure `deckSummary(deck: Deck): { lands: number; spells: number; averageManaValue: number }` in
  `app/lib/deck.ts`, counting the main deck plus the commander (same cards as `manaCurve` and `colorCounts`
  use, not the sideboard). A card is a land by the same test `colorCounts` uses (its front face for
  double-faced cards, so a modal DFC with a spell front counts as a spell). `averageManaValue` is over
  non-land cards weighted by count, rounded to 2 decimals, and 0 when there are no spells.
- Tests in `app/lib/deck.test.ts`: 24 lands + 36 spells; counts > 1 weight the average; a commander is
  included; the sideboard is not; an empty deck gives `{ lands: 0, spells: 0, averageManaValue: 0 }`.
- `DeckStats` shows one line above the mana curve: "24 lands · 36 spells · average mana value 2.61"
  (the average left out when there are no spells). Fits at 360px wide (it may wrap).
- PR description says what to look at: a deck page with lands, spells and a commander.

## Verify
npm run verify
