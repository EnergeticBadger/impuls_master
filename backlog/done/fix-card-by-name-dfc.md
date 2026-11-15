---
id: fix-card-by-name-dfc
title: Deck import lookup: find split and double-faced cards by full or front-face name
phase: P2
priority: 3
model: sonnet
---
## Goal
`cardByName` (`app/lib/card.ts:86`, from PR #89) can't find any card with more than one face once the site's
card data files are there, which is always in production.

It looks the card up by `slug(line.name.split(" // ")[0])`, the *front face* slug. But the card data build
(`scripts/card-data.ts:243` and `:402`) names each record's page slug and bucket file after the record's
*full* name (`record.name` is Scryfall's `c.name`, "Fire // Ice"), so the record lives at slug `fire-ice` in
bucket `bucketOf("fire-ice")`. `loadRecord` (`app/lib/card.ts:75`) and `cardByOracle`
(`app/lib/carddata.server.ts:162`) both use the full name. So:
- `{ name: "Fire // Ice" }` -> looks in `bucketOf("fire")` for entry `"fire"` -> `undefined`.
- `{ name: "Bonecrusher Giant", set: "ELD", number: "115" }` (how Arena and MTGO export adventure, transform,
  modal DFC and flip cards: front face only) -> looks for `"bonecrusher-giant"`, but the record is
  `"bonecrusher-giant-stomp"` -> `undefined`.

And because the bucket file *was* found, `cardByName` returns `undefined` at line 92 instead of falling back
to Scryfall, so every split, adventure, DFC and MDFC in an imported list ends up in `missing`. The
`carddata.test.ts` tests only use "Opt", so they never reach this.

## Acceptance criteria
- A pure helper in `app/lib/carddata.ts`, e.g. `findEntryByName(entries: BucketEntry[], name: string)`,
  plus the bucket to look in, built on `slug(fullName)` (no `split(" // ")`), so "Fire // Ice" and
  "Bonecrusher Giant // Stomp" (any case, any accents) find their records.
- `cardByName` looks up the full name's slug; when the data files are there but no entry matches (a
  front-face-only name like "Bonecrusher Giant" or "Delver of Secrets"), it falls back to
  `scryfallGet("cards/named?exact=...")` (which matches face names) instead of returning `undefined`.
  It still never calls Scryfall directly.
- Tests in `app/lib/carddata.test.ts` with header entries shaped like the real build's
  (`[page slug, oracle id, offset, length]`, page slugs `"fire-ice"`, `"bonecrusher-giant-stomp"`,
  `"opt"`, a renamed `"soldier-token"`): "Fire // Ice" and "fire // ice" find `fire-ice`;
  "Bonecrusher Giant // Stomp" finds `bonecrusher-giant-stomp`; "Bonecrusher Giant" finds nothing (so the
  caller falls back); "Opt" still finds `opt`; and the bucket for "Fire // Ice" is `bucketOf("fire-ice")`.
- Only `app/lib/card.ts`, `app/lib/carddata.ts` and `app/lib/carddata.test.ts` change.

## Verify
npm run verify
