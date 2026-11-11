---
id: p2-deck-page-remove-commander
title: Use the model's removeCommander and removePartner on the deck page
phase: P2
priority: 5
depends_on: [p2-remove-commander-model, p2-partner-deck-page]
model: sonnet
---
## Goal
The deck page still has its own `removeAsCommander` and a `move` that drops the commander slot by hand
(`app/routes/deck.tsx`). With partners on the page, those leave a partner without a commander. Switch the page
to `removeCommander` / `removePartner` from `app/lib/deck.ts`.

## Acceptance criteria
- `app/routes/deck.tsx` no longer defines `removeAsCommander`; the commander row's "Remove as commander" calls
  `change(removeCommander)`, the partner row's calls `change(removePartner)`.
- Nothing else in `deck.tsx` sets `commander: undefined` or `partner: undefined` by hand (check `move` and any
  helper p2-partner-deck-page added); if a pure helper is still needed, it goes in `app/lib/deck.ts` with a test.
- Both are undoable with one Undo. `npm run typecheck` is clean.
- PR description says what a human should click: a Commander deck with Thrasios as commander and Tymna as
  partner; "Remove as commander" on Thrasios makes Tymna the commander and puts Thrasios in main; Undo puts it
  back; "Remove as commander" on the partner row puts Tymna in main.

## Verify
npm run verify
