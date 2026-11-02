---
id: p2-deck-quick-add
title: Add a card to a deck by typing its name on the deck page
phase: P2
priority: 6
depends_on: [fix-card-by-name-dfc]
model: sonnet
---
## Goal
Deck builders often know the card they want ("4 Lightning Bolt"). Let them type it on the deck page instead
of going back to search.

## Acceptance criteria
- On `app/routes/deck.tsx`, above the card sections, a small form: one text input (placeholder
  `4 Lightning Bolt`, `aria-label="Add a card"`, `box-sizing: border-box`), a "Main" / "Sideboard" choice
  and an "Add" button.
- The input is read with the existing parser: `parseDeckList(text)` from `app/lib/decklist.ts`, taking its
  first main line (no count means 1; set and number are honoured when given). Nothing parsed shows
  "Type a card name, like 4 Lightning Bolt."
- The card is found with `cardByName(line)` from `app/lib/card.ts` and added with
  `updateDeck(id, d => addCard(d, card, zone, line.count))`. While looking it up the button is disabled and
  says "Adding…"; a miss shows "No card named <name>." The input clears after a successful add and keeps
  focus, so several cards can be added in a row.
- A pure `quickAddLine(text: string): Line | undefined` (in `app/lib/decklist.ts`, tested in
  `decklist.test.ts`) wraps the parsing: `"4 Opt"`, `"Opt"`, `"2x Opt"`, `"1 Opt (M19) 65"`, and empty or
  whitespace text giving `undefined`.
- Fits at 360px wide.
- PR description says what to click through: add `4 Opt`, `Delver of Secret Insight` (double-faced) and a
  made-up name, to main and sideboard.

## Verify
npm run verify
