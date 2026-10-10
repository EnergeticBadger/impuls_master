// Refreshes scripts/cubes.json, the cards in each cube Scryfall's cube: keyword knows (cube:vintage, cube:modern…),
// for the local search (scripts/local-search.ts): npm run cubes
// The lists aren't in any bulk file: Scryfall keeps them itself, so they're asked for once and kept, like the land
// groups (scripts/land-cycles.ts). Run it when a cube changes; npm run test-syntax shows when one has.

import { writeFileSync } from "node:fs";
import { politeFetch } from "./scryfall-answers.ts";

// as Scryfall's syntax guide lists them
const CUBES = ["arena", "grixis", "legacy", "chuck", "twisted", "april", "protour", "uncommon", "modern", "amaz", "tinkerer", "livethedream",
    "chromatic", "vintage", "apcube"];

const out: Record<string, string[]> = {};
for (const cube of CUBES) {
    out[cube] = [];
    let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`cube:${cube}`)}`;
    while (url) {
        const res = await politeFetch(url);
        const body: any = await res.json();
        if (res.status === 404) break;
        if (!body.data) throw new Error(`cube:${cube}: ${body.details ?? res.status}`);
        out[cube].push(...body.data.map((c: any) => c.name));
        url = body.has_more ? body.next_page : undefined;
    }
    out[cube].sort();
    console.log(`cube:${cube}: ${out[cube].length}`);
}
writeFileSync(new URL("./cubes.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
