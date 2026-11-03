---
id: fix-buy-deck-checkbox
title: Deck page: make the "Include the sideboard" checkbox visible
phase: P2
priority: 4
model: sonnet
---
## Goal
PR #107 added `<input type="checkbox">` for "Include the sideboard" on the deck page
(`app/routes/deck.tsx:165`) with no styling. `app/app.css:26-29` resets every `input` with `all: unset`, which
sets `appearance` to its initial value `none` and drops the size, so the checkbox renders as nothing: there's
no box and no checkmark. It's the only checkbox in the app, so no existing CSS puts it back.

Failure scenario: open a deck with a sideboard. Only the text "Include the sideboard" shows. Tapping it does
toggle the hidden input (the label wraps it), but nothing on screen changes, so the user can't tell whether the
"Buy this deck on TCGplayer" link includes the sideboard and may buy the wrong cards.

## Acceptance criteria
- The checkbox is visible and shows its checked state on the deck page: e.g. a class in the deck page's CSS
  module that sets `appearance: auto` (or draws a box with `:checked` styling), a size of at least 20px, and
  `box-sizing: border-box`, plus a visible `:focus-visible` outline for keyboard users.
- The label and box sit on one line at 360px wide with no horizontal scroll; the label text stays tappable.
- No change to `app/app.css`'s global reset (other inputs depend on it).
- Only `app/routes/deck.tsx` and the deck page's CSS module change.
- PR description asks a human to open a deck with a sideboard at 360px wide, tick and untick the box, and
  check the box shows its state and the TCGplayer link gains/loses the sideboard cards.

## Verify
npm run verify
