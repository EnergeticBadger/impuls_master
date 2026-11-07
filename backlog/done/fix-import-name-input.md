---
id: fix-import-name-input
title: Decks page: the import form's name input is 12rem tall
phase: P2
priority: 5
model: sonnet
---
## Goal
The import form (PR #94) gives its deck-name input `className={styles.input}` (`app/routes/decks.tsx:93`).
`.input` in `app/routes/Decks.module.css:53` has `flex: 1 1 12rem`, which suits the row layout of the "New
deck" `.form` (`flex-wrap: wrap`, row). But the import form is `.importer`, a `flex-direction: column` box
(`Decks.module.css:64`). In a column the flex basis sets the *height*, so the one-line name input renders
12rem (about 192px) tall above the textarea, at any screen width.

Scenario: on /decks, tap "Import" -> the name field is a tall empty box the height of the deck-list textarea.

## Acceptance criteria
- The import form's name input is one line high and the full width of the form. Add a class for it (e.g.
  `.importName` with `box-sizing: border-box; width: 100%;` and the input look, and no flex basis), or
  override `flex` for `.importer .input`. The "New deck" and rename inputs keep their current layout.
- Inputs keep `box-sizing: border-box`; no horizontal scroll at 360px.
- Only `app/routes/Decks.module.css` and, if needed, `app/routes/decks.tsx` change.
- PR description says what to click through: on /decks at 360px and at desktop width, tap "Import" and check
  that the name field is one line high; tap "New deck" and "Rename" and check those look as before.

## Verify
npm run verify
