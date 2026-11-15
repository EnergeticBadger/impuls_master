---
id: p2-deck-empty-state
title: Deck page empty state links to search
phase: P2
priority: 5
model: haiku
---
## Goal
An empty deck page says "No cards yet. Add some from a card page." with no way to get there. Point people to
search, which is where cards are added from.

## Acceptance criteria
- In `app/routes/deck.tsx`, the empty-deck message becomes: "No cards yet. " followed by a `<Link to="/">`
  "Search for cards" (class `styles.link`) and " and press Add to deck." Keep the existing `styles.empty`
  paragraph.
- The message shows under the same condition as now (`groups.length === 0`); don't change it.
- No other changes to the page.
- PR description says what to look at: a new empty deck, then click the link.

## Verify
npm run verify
