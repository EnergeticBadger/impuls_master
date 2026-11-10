---
id: p2-card-page-in-decks
title: List the saved decks that hold a card on its card page
phase: P2
priority: 6
depends_on: [p2-decks-with-card]
model: sonnet
---
## Goal
On a card page, show which of the user's decks already include the card, with links to them.

## Acceptance criteria
- In `app/routes/card.tsx`, `DeckButtons` (decks are read after hydration, as now) shows below its buttons,
  when `decksWithCard(list, oracleOf(card))` is not empty, a line "In your decks:" followed by links
  `<Link to={`/decks/${id}`}>` with text "<deck name> (<count>)", separated by commas. Nothing is shown when no
  deck holds it, or before hydration.
- The existing "In deck: N" / "Remove one" for the current deck stays as it is.
- Long deck names wrap; fits at 360px wide with no horizontal scroll. Styles go in
  `app/routes/CardPage.module.css` if any are needed.
- `npm run typecheck` is clean; only `app/routes/card.tsx` and `app/routes/CardPage.module.css` change.
- PR description says what a human should click: put Lightning Bolt in two decks (one in the sideboard), open
  its card page, see both decks with counts, click one to open it.

## Verify
npm run verify
