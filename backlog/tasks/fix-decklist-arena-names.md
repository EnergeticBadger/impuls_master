---
id: fix-decklist-arena-names
title: Deck lists: write double-faced cards by front name for Arena/MTGO, and don't double the Arena companion
phase: P2
priority: 4
model: sonnet
---
## Goal
Two defects in `app/lib/decklist.ts` (from PR #87). The tests only use single-faced and split cards, and an
Arena export without a companion, so neither shows.

1. **Arena and MTGO don't accept full double-faced names.** `write` uses `entry.card.name`
   (`app/lib/decklist.ts:70`), which for transform, modal DFC, adventure and flip cards is the full
   "Front // Back" name. Arena and MTGO list these by the front face only: a deck with Bonecrusher Giant
   exports as `4 Bonecrusher Giant // Stomp (ELD) 115`, which Arena's importer rejects (Arena writes
   `4 Bonecrusher Giant (ELD) 115`); the same for Delver of Secrets, Valakut Awakening, Brazen Borrower.
   Split cards (`layout: "split"`, Fire // Ice) keep the full name in both.
2. **Arena's companion is read twice.** Arena exports the companion in a `Companion` section *and* again
   in `Sideboard` (it has to be in the sideboard to be your companion). `HEADERS` maps `companion` to the
   sideboard (`app/lib/decklist.ts:15`), so
   `Companion\n1 Lurrus of the Dream-Den (IKO) 226\n\nDeck\n...\n\nSideboard\n1 Lurrus of the Dream-Den (IKO) 226\n14 ...`
   parses to two Lurrus lines in `side`, and the imported deck has a 16-card sideboard (and fails
   `legalityProblems`' 15-card check).

## Acceptance criteria
- In the `arena` and `mtgo` styles, a card whose `layout` is `transform`, `modal_dfc`, `adventure` or
  `flip` is written by `card_faces[0].name`; other layouts (split, aftermath, single-faced) keep
  `card.name`. The `text` style is unchanged.
- The companion section's card goes into the sideboard once: if the sideboard already lists that card
  (same name, case-insensitive), the companion line isn't added again; if it doesn't, it is added as today.
- Tests in `app/lib/decklist.test.ts`:
  - A deck with Bonecrusher Giant (`layout: "adventure"`, `name: "Bonecrusher Giant // Stomp"`,
    `card_faces` named "Bonecrusher Giant" and "Stomp", set `eld`, number `115`) writes
    `4 Bonecrusher Giant (ELD) 115` for Arena and `4 Bonecrusher Giant` for MTGO; Fire // Ice still writes
    `Fire // Ice`; `text` still writes the full name.
  - A real-looking Arena export with `Companion` / `Deck` / `Sideboard` sections where the companion also
    appears in `Sideboard` parses to one Lurrus line, a 15-card sideboard, and no problems.
- Only `app/lib/decklist.ts` and `app/lib/decklist.test.ts` change.

## Verify
npm run verify
