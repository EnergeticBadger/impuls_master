---
id: p1-filter-list-scroll
title: Scroll long filter-panel dropdowns into view when they open
phase: P1
priority: 2
---
## Goal
In the filter panel (`app/Components/Searchbar/RulesBuilder.tsx`), a `PiecePicker` near the bottom of the
panel opens its list (`styles.pieceList`) below the fold, so on a phone the person sees nothing happen.
Arrowing through a long list can also move the highlight out of sight.

## Acceptance criteria
- When a `PiecePicker` list opens, it is scrolled into view with `scrollIntoView({ block: "nearest" })`
  (in a `useEffect` on `open`, through a ref on the `<ul>`), so a list that already shows doesn't jump.
- When `hi` changes while the list is open, the highlighted option (`#${listId}-${hi}`) is scrolled into view
  with `block: "nearest"` inside the list. The same for the `TagSearch` suggestions.
- Only `RulesBuilder.tsx` (and its CSS module, if needed) changes. No new dependencies.
- Works at 360px wide with no horizontal scroll.
- PR description says what to click through: open the filter panel on a narrow window, open the last
  ability picker, arrow down past the visible options, and check the tag search does the same.

## Verify
npm run verify
