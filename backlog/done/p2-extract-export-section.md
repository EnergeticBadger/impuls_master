---
id: p2-extract-export-section
title: Move the deck page's Export section into its own component
phase: P2
priority: 3
depends_on: []
model: sonnet
---
## Goal
`app/routes/deck.tsx` is close to 600 lines, so every deck page task runs into merge conflicts there. Start
splitting it up. This is a pure move: nothing should look or behave differently.

## Acceptance criteria
- `ExportSection`, `EXPORT_BUTTONS`, `SHARE_LABELS` and `fileNameOf` move from `app/routes/deck.tsx` to a new
  `app/Components/Deck/ExportSection.tsx` (named export `ExportSection`, same props `{ deck, name }`).
- It keeps using the same CSS classes by importing `~/routes/DeckPage.module.css`. Don't add a new CSS file.
- `deck.tsx` imports it and drops the imports it no longer uses (`shareLink`, `deckLinkHash`,
  `DeckListStyle`, ... whatever becomes unused).
- No other change to markup, text or behaviour. `npm run typecheck` is clean.
- PR description says what to click through: on a deck page, each Copy button, Download .txt and Share link.

## Verify
npm run verify
