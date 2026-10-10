// Refreshes scripts/keyword-words.json: every keyword ability, keyword action and ability word, from Scryfall's
// catalogs: npm run keyword-words
// scripts/search-api.ts needs them because Scryfall warns about a kw: it doesn't know ("Unknown keyword “zzqx”")
// from these lists, not from the keywords cards have: kw:poisonous is known though no card in the bulk file lists it.
// Run it when a new set brings new keywords.

import { writeFileSync } from "node:fs";
import { politeFetch } from "./scryfall-answers.ts";

const CATALOGS = ["keyword-abilities", "keyword-actions", "ability-words"];

const words = new Set<string>();
for (const name of CATALOGS) {
    const res = await politeFetch(`https://api.scryfall.com/catalog/${name}`);
    const body: any = await res.json();
    if (!Array.isArray(body.data)) throw new Error(`catalog ${name}: ${body.details ?? `HTTP ${res.status}`}`);
    for (const w of body.data as string[]) words.add(w.toLowerCase());
}
writeFileSync(new URL("./keyword-words.json", import.meta.url), JSON.stringify([...words].sort(), null, 1) + "\n");
console.log(`${words.size} keywords written to scripts/keyword-words.json`);
