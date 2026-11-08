---
id: p2-extract-quick-add
title: Move the deck page's quick add form into its own component
phase: P2
priority: 5
depends_on: [p2-extract-buy-section]
model: sonnet
---
## Goal
Keep shrinking `app/routes/deck.tsx`. The "4 Lightning Bolt" quick add form becomes its own component.
This is a pure move.

## Acceptance criteria
- New `app/Components/Deck/QuickAdd.tsx` exports `QuickAdd({ onAdd }: { onAdd: (card: ScryfallCard,
  zone: DeckZone, count: number) => void })`. It owns `quickText`, `quickZone`, `quickBusy`,
  `quickMessage` and the input ref, and does the `quickAddLine` / `cardByName` lookup and messages
  exactly as today, including putting the focus back in the input afterwards.
- `deck.tsx` renders `<QuickAdd onAdd={(card, zone, count) => change((d) => addCard(d, card, zone, count))} />`,
  so adds can still be undone, and drops the moved state and unused imports.
- Same CSS classes from `~/routes/DeckPage.module.css`; no visible change. `npm run typecheck` is clean.
- PR description says what to click through: add "4 Lightning Bolt" to main, "2 Duress" to sideboard, a
  misspelled name (message shows), then Undo.

## Verify
npm run verify
