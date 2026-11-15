---
id: fix-card-by-name-variants
title: Deck import lookup: pick the same-name card that has the line's printing
phase: P2
priority: 5
model: sonnet
---
## Goal
`findEntryByName` (`app/lib/carddata.ts:179`, from PR #99) returns the first header entry whose page slug
equals `slug(name)`. But several different cards share one name, and the build (`scripts/card-data.ts:251-264`)
gives only the first of them (real cards before tokens, then oldest, then by oracle id) the plain slug; the
others get `<name>-2`, `<name>-3` or `<name>-token` and sit in the **same bucket**
(`scripts/card-data.ts:402`, `bucketOf(renamed[r.slug] ?? r.slug)`). `cardByName` (`app/lib/card.ts:90-93`)
then calls `pickPrinting` on that one record, whose fallback (`app/lib/carddata.ts:264`, `inSet[0]`) quietly
returns a printing of the wrong card.

Failure scenario: Unstable's Everythingamajig (and Very Cryptic Command, Garbage Elemental, Sly Spy, Ineffable
Blessing, Knight of the Kitchen Sink, ...) has six variants with different rules text and one oracle id each,
collector numbers UST 147a-147f. Importing `1 Everythingamajig (UST) 147c` finds entry `everythingamajig`
(say variant 147a), `pickPrinting(record, "UST", "147c")` finds no 147c in that record and returns its UST
printing 147a, so the deck gets variant a: wrong card text, wrong image, no "missing" warning. Same for a
token line like `1 Soldier (TM20) 3` when a real card shares the token's name.

## Acceptance criteria
- A pure helper in `app/lib/carddata.ts` (e.g. `pickByName(bytes, header, name, set?, number?)` or a
  candidate list plus a chooser) that considers every entry in the bucket whose record's `slug(record.name)`
  equals `slug(name)` (the plain slug and its renamed `-2`/`-token` siblings), and picks the record that has a
  printing with that set and collector number; else one with a printing in that set; else the plain-slug
  entry as today. Full-name matching from PR #99 (`"Fire // Ice"` -> `fire-ice`) keeps working.
- `cardByName` (`app/lib/card.ts`) uses it; front-face-only names still fall back to Scryfall through
  `scryfallGet`, never Scryfall directly.
- Tests in `app/lib/carddata.test.ts` on a bucket built like the real one (header line of
  `[page slug, oracle id, offset, length]` entries, then the JSON records, made with the same layout
  `scripts/card-data.ts` writes): two records named "Everythingamajig" with slugs `everythingamajig` (UST 147a)
  and `everythingamajig-2` (UST 147c): `("Everythingamajig", "UST", "147c")` gives the 147c record,
  `("Everythingamajig", "UST", "147a")` and `("Everythingamajig")` give the 147a one; and a "Soldier" card plus
  a `soldier-token` record: `("Soldier", "TM20", "3")` gives the token when only the token has that printing.
- Only `app/lib/card.ts`, `app/lib/carddata.ts` and `app/lib/carddata.test.ts` change.

## Verify
npm run verify
