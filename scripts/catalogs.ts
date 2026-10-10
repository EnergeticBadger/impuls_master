// Refreshes scripts/catalogs.json, the catalogs scripts/lookups-build.ts can't work out from the bulk files alone:
// npm run catalogs
// Most of Scryfall's catalogs are lists Scryfall keeps by hand, in the order it added to them: the type lists come
// from the Comprehensive Rules (with types no card has yet, like Boss and Hero), the keyword lists and flavor words
// are in no order a card shows. Powers, toughnesses and loyalties are sorted by their number, but cards with the
// same number ("*", "?", "∞", "+0") come in Scryfall's own order. A few artists in artist-names are never credited
// on a card by name (only by id). So those lists are kept here as Scryfall last gave them, and the build checks
// them against the bulk files: a new type on a card gets added, a new keyword gets reported.
// Run it when the build reports something new, or after a new set.

import { writeFileSync } from "node:fs";
import { politeFetch } from "./scryfall-answers.ts";

// every list the build takes from here (the rest it makes from the cards: card-names, word-bank, watermarks)
export const KEPT = [
    "supertypes", "card-types", "artifact-types", "battle-types", "creature-types", "enchantment-types", "land-types",
    "planeswalker-types", "spell-types", "keyword-abilities", "keyword-actions", "ability-words", "flavor-words",
    "powers", "toughnesses", "loyalties", "artist-names",
] as const;

if (import.meta.main) {
    const lists: Record<string, string[]> = {};
    for (const name of KEPT) {
        const res = await politeFetch(`https://api.scryfall.com/catalog/${name}`);
        const body: any = await res.json();
        if (!Array.isArray(body.data)) throw new Error(`catalog ${name}: ${body.details ?? `HTTP ${res.status}`}`);
        lists[name] = body.data;
    }
    const file = { fetched: new Date().toISOString().slice(0, 10), lists };
    writeFileSync(new URL("./catalogs.json", import.meta.url), JSON.stringify(file, null, 1) + "\n");
    console.log(`${KEPT.length} catalogs written to scripts/catalogs.json`);
}
