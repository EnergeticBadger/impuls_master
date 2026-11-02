---
id: p2-share-deck-link
title: Share a deck as a link that imports it
phase: P2
priority: 7
depends_on: [p2-deck-export, fix-decklist-arena-names]
model: sonnet
---
## Goal
Decks live in one browser until accounts exist. Let people send a deck to a friend (or their own phone) as a
link: opening it fills in the importer on the my decks page. The list goes in the URL hash, so it never
reaches our Worker.

## Acceptance criteria
- New pure functions in `app/lib/decklist.ts`, tested in `decklist.test.ts`:
  - `deckLinkHash(name: string, deck: Deck): string`: `#deck=<base64url of JSON { n: name, l: list }>`
    where `list` is `formatDeckList(deck, "text")`. Base64url via `btoa`/`atob` over UTF-8 bytes
    (`TextEncoder`/`TextDecoder`), no padding.
  - `readDeckLinkHash(hash: string): { name: string; text: string } | undefined`: the reverse; anything
    malformed (no `deck=`, bad base64, bad JSON, missing fields) gives `undefined`, never throws.
  - Tests: round trip with a non-ASCII name ("Æther Vial deck") and a commander; garbage hashes.
- On `app/routes/deck.tsx`, in the export area, "Share link" calls `shareLink` from `app/lib/card.ts` with
  `/decks` + the hash and shows "Link copied" / "Shared" / "Couldn't share" like `app/Components/CardDetails/ShareButton.tsx` does (reuse it if it fits).
- On `app/routes/decks.tsx`, after decks load, a valid `#deck=` hash opens the import form filled with the
  name and list (it does not import on its own), then clears the hash with `history.replaceState`.
- PR description says what to click through: share a deck, open the link in a private window, import it,
  compare the two decks.

## Verify
npm run verify
