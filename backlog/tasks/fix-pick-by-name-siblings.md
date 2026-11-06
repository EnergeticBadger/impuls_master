---
id: fix-pick-by-name-siblings
title: Deck import lookup: consider every renamed same-name record (-token-2, -emblem, -art-card...)
phase: P2
priority: 5
model: sonnet
---
## Goal
PR #120 added `pickByName` (`app/lib/carddata.ts`), which looks at the plain-slug record and its renamed
siblings in the bucket. It finds siblings with the regex at `app/lib/carddata.ts:191`,
`^<slug>-(\d+|token)$`. But the build names siblings differently (`scripts/card-data.ts:255-262`, with
`NOT_CARDS` at `:85`): a non-card layout gets `<slug>-<word>` where word is `token`, `emblem`, `art-card`,
`vanguard`, `scheme` or `plane`, and when that is taken, `<slug>-<word>-2`, `<slug>-<word>-3`, ... All of
them sit in the same bucket (`:402`). The regex misses `-token-2` and up, and every non-token word.

Failure scenario: "Soldier" has many token oracle ids (1/1 white Soldier, with lifelink, with vigilance,
2/2 ...). The build gives the first the plain slug `soldier`, the next `soldier-token`, then
`soldier-token-2`, `soldier-token-3`, ... A deck line `1 Soldier (<SET>) <N>` whose printing belongs to the
record `soldier-token-3` never sees that record: no exact or in-set match, so `pickByName` returns the
plain `soldier` record and `pickPrinting` quietly gives a different token, with no "missing" warning. Same
for an emblem or plane that shares a card's name.

## Acceptance criteria
- `pickByName` in `app/lib/carddata.ts` treats as candidates every bucket entry whose slug is the plain slug or
  `<slug>-<n>`, `<slug>-<word>` or `<slug>-<word>-<n>` for the words in the build's `NOT_CARDS`
  (`token`, `emblem`, `art-card`, `vanguard`, `scheme`, `plane`), and still keeps only records with
  `slug(record.name) === slug(name)`. Choice order (exact set+number, then set, then plain) is unchanged.
- Tests in `app/lib/carddata.test.ts`, using the existing `makeBucket` (built like `scripts/card-data.ts`
  writes buckets): four "Soldier" records with slugs `soldier` (XYZ 5), `soldier-token` (TM20 3),
  `soldier-token-2` (TLRC 7) and `soldier-token-3` (TMH2 2): `("Soldier", "TLRC", "7")` and
  `("Soldier", "TMH2", "2")` give those records, `("Soldier")` gives `soldier`; a `"Soldier Of Fortune"`
  record (slug `soldier-of-fortune`) in the same bucket is never picked for "Soldier". The existing
  Everythingamajig, Soldier and Fire // Ice tests still pass.
- Only `app/lib/carddata.ts` and `app/lib/carddata.test.ts` change.

## Verify
npm run verify
