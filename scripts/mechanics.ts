// Counts each of our own mechanics' cards (app/Components/Searchbar/mechanics.ts) with the local search, into
// /data/mechanics.json beside the rest of the card data: node scripts/mechanics.ts [out dir]
// The nightly card data job runs it after scripts/card-data.ts (which empties data/ first) and before the
// upload, so the Keyword filter can say how many cards each mechanic finds. It writes, as MechanicsFile:
//   { built, mechanics: { <value>: { token, count, ids } } }   ids are the cards' oracle ids
// A mechanic that finds nothing, or whose search the local search can't run, is warned about and written with
// a count of 0, so a bad search never stops the night's card data.
// Uses SCRYFALL_BULK_DIR like card-data.ts, or downloads default_cards into fuzz-results/bulk (kept a day).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MECHANICS, type MechanicsFile } from "../app/Components/Searchbar/mechanics.ts";
import { DATA_DIR } from "../app/lib/carddata.ts";
import { bulkFile, listed, loadCards, parse } from "./local-search.ts";

const out = resolve(process.argv[2] ?? "card-data");
const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", resolve("fuzz-results", "bulk")));
console.log(`${data.cards.length.toLocaleString()} cards loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const file: MechanicsFile = { built: new Date().toISOString(), mechanics: {} };
const problems: string[] = [];
for (const m of MECHANICS) {
    let ids: string[] = [], problem = "";
    try {
        ids = listed(parse(m.token), data).sort();
    } catch (err) {
        problem = `can't be run locally (${(err as Error).message})`;
    }
    if (!problem && !ids.length) problem = "finds no cards";
    if (problem) {
        problems.push(m.label);
        console.warn(`⚠ ${m.label}: ${m.token} ${problem}`);
    }
    file.mechanics[m.value] = { token: m.token, count: ids.length, ids };
    console.log(`${String(ids.length).padStart(5)}  ${m.label}`);
}

const path = join(out, DATA_DIR, "mechanics.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(file));
console.log(`Wrote ${path}${problems.length ? `; check ${problems.join(", ")}` : ""}`);
