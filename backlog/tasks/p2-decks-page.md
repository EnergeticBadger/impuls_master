---
id: p2-decks-page
title: My decks page to create, rename, open and delete decks
phase: P2
priority: 5
depends_on: [p2-saved-decks]
---
## Goal
A home for the person's decks at `/decks`, and a way to get there from the site header.

## Acceptance criteria
- New route `route("decks", "routes/decks.tsx")` in `app/routes.ts`, with `app/routes/Decks.module.css`.
- Lists the decks from `app/Components/Context/decks.ts`, newest `updated` first: name, card count
  (main deck), and a link to `/decks/<id>` (that page comes in `p2-deck-page`; a 404 until then is fine).
- A "New deck" button (asks for a name in an inline input, default "Untitled deck"), rename in place,
  and delete with a confirm step. The current deck is marked.
- Empty state: one line saying decks are saved in this browser, and the "New deck" button.
- A "Decks" link in `app/Components/Site/SiteHeader.tsx`.
- Page `meta` title "My decks | Impulse Caster". Works at 360px wide with no horizontal scroll; any new
  input sets `box-sizing: border-box`.
- PR description says what to click through: create two decks, rename one, delete one, reload the page.

## Verify
npm run verify
