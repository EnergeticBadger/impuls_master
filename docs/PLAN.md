# Impulse Caster: plan

The working notes (what we have, what we don't, bugs and decisions) live in the owner's Obsidian vault:
"MTG Suite Apps/Features.md" and "Issues.md". This file is the version agents can read. Build order (the
owner's call): the core and small features first, our own search engine last.

## Phases and definitions of done

### P1: Search and card page polish
- Every search failure says what happened on screen: no cards (done), bad query (done), Scryfall busy or
  rate-limited (503/429), network down.
- The card quick view works from the keyboard: Esc closes it, left/right move between cards.
- Long dropdown lists at the bottom of the filter panel scroll into view when opened.
- Buy links carry our affiliate ids, never Scryfall's (done: `app/lib/affiliate.ts`).

### P2: Deck building (the next big milestone)
- A deck model in pure code: cards with counts, grouped by type, mana curve, colors, format legality,
  Commander checks (color identity, singleton). Unit-tested.
- Import and export: plain text, Arena, MTGO.
- Add cards to a deck from search; a deck page; decks saved in the browser (accounts later).
- "Buy this deck" through the affiliate links.

### P3: Our own search engine ("the final boss")
- `scripts/local-search.ts` is 87% exact against Scryfall. Decide where it runs (browser, Worker or
  Postgres) and move search off the Scryfall API. Needs owner decisions first; don't plan tasks for it
  until this file says so.

## Not doing
- Paywalls, upsells or ads in the way of search.
- Simple search mode (tried and removed in PR #54), First/Last page buttons.
