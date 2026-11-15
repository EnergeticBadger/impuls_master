---
id: p2-extract-text-editor
title: Move the deck page's "Edit as text" editor into its own component
phase: P2
priority: 6
depends_on: [p2-extract-format-section, fix-edit-text-blank-line]
model: sonnet
---
## Goal
Keep shrinking `app/routes/deck.tsx`. The "Edit as text" textarea, its lookup progress and the "These need a
look" review become one component. This is a pure move.

## Acceptance criteria
- New `app/Components/Deck/EditAsText.tsx` exports `EditAsText({ deck, onSave, onClose })`. It starts from
  `formatDeckList(deck, "text")`, owns the `editing` and `editProgress` state, runs `lookUpDeckList(text,
  progress, deck)` as `saveText` does today, and calls `onSave(next)` then `onClose()` on success or "Save
  anyway"; "Cancel" calls `onClose()`.
- `deck.tsx` keeps one boolean (`editing`), shows the "Edit as text" button when it's false, renders
  `<EditAsText deck={latest.current.deck} onSave={(next) => change(() => next)} onClose={() =>
  setEditing(false)} />` in place of the stats and lists when true, and drops the moved state and imports.
- Saving is still undoable with one Undo. Same CSS classes from `~/routes/DeckPage.module.css`; no visible
  change. `npm run typecheck` is clean.
- PR description says what a human should click: Edit as text, change a count, Save, Undo; Edit as text with a
  misspelled card, see the note, "Back to the list", Cancel.

## Verify
npm run verify
