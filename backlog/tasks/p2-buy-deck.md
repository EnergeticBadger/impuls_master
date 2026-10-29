---
id: p2-buy-deck
title: Buy this deck on TCGplayer through our affiliate link
phase: P2
priority: 7
depends_on: [p2-deck-page]
---
## Goal
Let people buy the whole deck in one go at TCGplayer, with our affiliate id (never Scryfall's), clearly
disclosed. Free stays free: this is a link, not an upsell.

## Acceptance criteria
- In `app/lib/affiliate.ts`, `tcgplayerDeckLink(lines: { count: number; name: string }[], ids =
  AFFILIATE_IDS): string`: TCGplayer's mass entry URL (`https://www.tcgplayer.com/massentry`,
  `productline=Magic`, cards as `c=` with `count name` joined by `||`, front-face names), passed through
  `buyLink("tcgplayer", ...)` so the partner wrapper is added only when we have an id.
- Tests in `scripts/test-affiliate.ts` (where the existing affiliate tests are): an empty id gives the plain
  mass entry URL, a set id gives the partner link with the mass entry URL in `u=`, and "A // B" names use "A".
- On `app/routes/deck.tsx`, a "Buy this deck on TCGplayer" link (main deck plus commander, sideboard
  optional with a checkbox), `rel="noopener sponsored"`, with a one-line disclosure under it that we may
  earn a commission.
- PR description asks a human to open the link and check TCGplayer's mass entry page fills in the cards.

## Verify
npm run verify
