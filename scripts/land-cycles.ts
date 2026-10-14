// Refreshes scripts/land-cycles.json, the lands in each of Scryfall's land groups (is:fetchland, is:shockland…),
// for the local search (scripts/local-search.ts): npm run land-cycles
// Scryfall keeps these lists by hand (is:tangoland has Eclipsed Steppe the week it's out), so rather than guess
// them from the cards' wording, they're asked for once and kept. Run it when a new set brings a new cycle
// member; npm run test-syntax shows when one has.

import { writeFileSync } from "node:fs";
import { politeFetch } from "./scryfall-answers.ts";

// as Scryfall's syntax guide lists them; is:manland is another name for is:creatureland
const LAND_CYCLES = ["bikeland", "bondland", "bounceland", "canopyland", "checkland", "creatureland", "dual", "fastland", "fetchland", "filterland",
    "gainland", "painland", "pathway", "scryland", "shadowland", "shockland", "slowland", "storageland", "surveilland", "tangoland", "tricycleland", "triland"];
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const out: Record<string, string[]> = {};
for (const cycle of LAND_CYCLES) {
    out[cycle] = [];
    let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:${cycle}`)}`;
    while (url) {
        const res = await politeFetch(url);
        if (res.status === 429) { console.log("Scryfall asked to slow down; waiting 90s"); await sleep(90_000); continue; }
        const body: any = await res.json();
        if (!body.data) throw new Error(`is:${cycle}: ${body.details ?? res.status}`);
        out[cycle].push(...body.data.map((c: any) => c.name));
        url = body.has_more ? body.next_page : undefined;
        await sleep(1200);
    }
    console.log(`is:${cycle}: ${out[cycle].length}`);
}
writeFileSync(new URL("./land-cycles.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
