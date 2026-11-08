---
id: p2-decks-list-summary
title: Show each deck's colors and format on the my decks page
phase: P2
priority: 7
depends_on: [p2-deck-legality]
model: sonnet
---
## Goal
On `app/routes/decks.tsx` every deck shows only its name and card count, so a list of decks is hard to tell
apart. Show its colors and format too.

## Acceptance criteria
- New pure `deckColors(deck: Deck): string[]` in `app/lib/deck.ts`: the colors (WUBRG order) of the
  commander's color identity when there is a commander, otherwise every color with a count above 0 in
  `colorCounts(deck)`; an empty or colorless deck gives `[]`. Tests in `app/lib/deck.test.ts` for a
  commander deck, a two-color 60-card deck, and an empty deck.
- Each deck row on `app/routes/decks.tsx` shows the colors as mana symbols (`ManaText` with `{W}{U}`, or
  `{C}` for none) and the saved format name ("Commander", "Modern"...) when one is set, after the card count.
  For Commander decks the count includes the commander.
- The row still fits at 360px wide; a long deck name is cut with an ellipsis rather than pushing the
  buttons off screen.
- PR description says what to look at: a Commander deck, a two-color Modern deck and an empty deck.

## Verify
npm run verify
