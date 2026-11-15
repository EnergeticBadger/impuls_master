---
id: p2-deck-save-warning
title: Tell people on screen when their decks could not be saved
phase: P2
priority: 4
model: sonnet
---
## Goal
Decks live only in localStorage. When a write fails (storage full, private mode, storage blocked), the
subscriber in `app/Components/Context/decks.ts` only calls `console.error('Could not save decks', e)`, so
people keep building a deck that is gone on reload. Show a warning they can see.

## Acceptance criteria
- New pure `saveErrorMessage(error: unknown): string` in `app/lib/savedDecks.ts`, tested in
  `app/lib/savedDecks.test.ts`: a `DOMException`-like error whose `name` is `QuotaExceededError` (or
  `NS_ERROR_DOM_QUOTA_REACHED`) gives "Your browser's storage is full, so the latest deck changes were not
  saved. Delete a deck or copy this one out with Export."; any other error gives "Your browser didn't let us
  save your decks, so the latest changes will be lost on reload." Test with plain objects
  (`{ name: "QuotaExceededError" }`), an `Error`, and a string.
- In `app/Components/Context/decks.ts`, a separate proxy `deckSave = proxy<{ error?: string }>({})` (not a
  field on `decks`, so setting it does not trigger another deck write). A failed write sets
  `deckSave.error = saveErrorMessage(e)`; the next successful write clears it.
- New `app/Components/Deck/SaveWarning.tsx`: when `deckSave.error` is set, a `role="alert"` box with the
  message. Shown at the top of `<main>` on `app/routes/deck.tsx` and `app/routes/decks.tsx`. Styled in the
  existing page CSS modules or its own `SaveWarning.module.css`; fits at 360px wide.
- No other behaviour changes; `console.error` stays.
- PR description says what a human can try: in devtools, fill localStorage (e.g. a loop setting a big
  string under another key), then add a card to a deck and check the warning shows; remove the junk key,
  add another card, check it goes away.

## Verify
npm run verify
