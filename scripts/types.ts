// Refreshes scripts/types.json: every type word, from Scryfall's catalogs (the lists the filter panel loads in
// app/Components/Searchbar/catalog.ts): npm run types
// The local search needs them because Scryfall reads t: two ways: a type's own name as a whole word (t:human
// isn't Inhuman, t:ape isn't Shapeshifter), anything else as part of the type line (t:uman, t:art, t:ant).
// Run it when a new set brings new types.

import { writeFileSync } from "node:fs";
import { politeFetch } from "./scryfall-answers.ts";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const CATALOGS = ["creature-types", "planeswalker-types", "land-types", "artifact-types", "enchantment-types", "spell-types", "battle-types", "supertypes", "card-types"];

const types = new Set<string>();
for (const name of CATALOGS) {
    const res = await politeFetch(`https://api.scryfall.com/catalog/${name}`);
    const body: any = await res.json();
    if (!Array.isArray(body.data)) throw new Error(`catalog ${name}: ${body.details ?? `HTTP ${res.status}`}`);
    for (const t of body.data as string[]) types.add(t.toLowerCase());
    await sleep(1200);
}
writeFileSync(new URL("./types.json", import.meta.url), JSON.stringify([...types].sort(), null, 1) + "\n");
console.log(`${types.size} types written to scripts/types.json`);
