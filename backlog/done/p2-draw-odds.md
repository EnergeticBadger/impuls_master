---
id: p2-draw-odds
title: Show the odds of drawing a card by a given turn on the deck page
phase: P2
priority: 7
model: sonnet
---
## Goal
"How likely am I to see my 4-of by turn 3?" is a standard deck building question. Answer it next to the
sample hand, with exact hypergeometric odds.

## Acceptance criteria
- New pure functions in `app/lib/sampleHand.ts`, tested in `app/lib/sampleHand.test.ts`:
  - `atLeastOneChance(deckSize: number, copies: number, seen: number): number`: the chance that `seen`
    cards drawn without replacement from `deckSize` include at least one of `copies`
    (`1 - C(deckSize - copies, seen) / C(deckSize, seen)`), computed as a running product so 100-card decks
    don't overflow. 0 when `copies` is 0, 1 when `seen > deckSize - copies`; clamps bad input
    (negative numbers) to 0 rather than throwing.
  - `cardsSeen(turn: number, onThePlay: boolean): number`: 7 + turn - 1 on the play, 7 + turn on the draw.
- Tests: 60 cards, 4 copies, 7 seen is about 0.3995 (check to 4 decimals); copies 0 gives 0; seen 0 gives
  0; copies equal to deck size gives 1 for any seen ≥ 1; a 100-card deck with 1 copy and 10 seen is 0.1;
  `cardsSeen(1, true)` is 7 and `cardsSeen(3, false)` is 10.
- New `app/Components/Deck/DrawOdds.tsx` on `app/routes/deck.tsx`, right after `<SampleHand>`: a "Draw
  odds" heading, a `<select>` of the main deck's cards (by name, with their count), a turn `<select>` (1 to
  10) and an "On the play / On the draw" `<select>`. Below, one sentence: "52.8% to draw at least one
  Lightning Bolt (4 of 60) by turn 3 on the draw." Deck size is the main deck count (the library, as in
  `libraryOf`). Hidden when the main deck is empty. All selects have `aria-label`s and fit at 360px wide.
- PR description says what to click through: pick a 4-of in a 60-card deck, turn 1 on the play (39.9%),
  change the turn and play/draw.

## Verify
npm run verify
