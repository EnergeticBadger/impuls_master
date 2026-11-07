---
id: p2-choose-printing
title: Change which printing a deck row uses
phase: P2
priority: 7
depends_on: [fix-remove-card-wrong-entry]
model: sonnet
timeout_min: 50
---
## Goal
Rows keep whatever printing came from search or import. Collectors and people buying the deck want a
specific printing (cheaper, older, a favourite art). Let them pick one on the deck page.

## Acceptance criteria
- New pure `replacePrinting(deck: Deck, zone: "main" | "side" | "commander", from: ScryfallCard, to:
  ScryfallCard): Deck` in `app/lib/deck.ts`: the entry in `zone` whose card has `from`'s `id` gets `to` as
  its card, same count and same position; if another entry in that zone already holds `to`'s `id`, the two
  merge into one entry at the first one's position. Nothing else changes and the input is not mutated.
  Unknown `from` returns the deck unchanged.
- Tests in `app/lib/deck.test.ts`: swap in main keeps count and order; swap in the sideboard leaves main
  alone; commander swap; merge when the new printing is already a row; unknown card is a no-op.
- On `app/routes/deck.tsx`, each row gets a "Printing" button (`aria-label="Change printing of <name>"`).
  It loads the card's printings with `scryfallGet` from `app/lib/scryfall.ts` (proxied; never call Scryfall
  directly) using `cards/search?order=released&unique=prints&q=oracleid%3A<oracle id>`. Saved cards are
  slimmed and have no `prints_search_uri`, so build the path from the oracle id (front face's for
  double-faced cards, as `copiesIn` callers do with `oracleOf`). Only the first page (up to 175) is needed.
- The list shows set name, collector number and USD price for each printing as buttons; the current one is
  marked (`aria-current="true"`). Choosing one runs `change((d) => replacePrinting(...))` so Undo restores
  it, and closes the list. Loading and error states are shown in a `role="status"` element. Esc or a
  "Close" button closes it. Fits at 360px wide (the list scrolls vertically if long).
- PR description says what to click through: change Lightning Bolt to another printing, check the image
  peek and card link follow it, undo.

## Verify
npm run verify
