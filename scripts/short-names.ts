// Refreshes scripts/short-names.json: the legends whose text names them only partly ("Whenever Ryan attacks")
// where Scryfall's ~ doesn't follow the local rule (see cardText in scripts/local-search.ts): npm run short-names
// The rule is right for about 99% of them; Scryfall picks the rest by hand (Ryan Sinclair is "Ryan", but Chandra,
// Pyrogenius isn't "Chandra"). So every such legend is asked about (o:~ with 15 of them at a time, by oracle id),
// and where Scryfall and the rule disagree, the card's own short names are kept: the parts of its name its text
// uses when Scryfall says ~ finds it, none when it says not.
// Uses SCRYFALL_BULK_DIR or fuzz-results/bulk like the other scripts. Run it when a new set brings new legends.

import { createReadStream, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { bulkFile, cardText } from "./local-search.ts";
import { politeFetch } from "./scryfall-answers.ts";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "this creature" and the like: a card that says it is found by ~ whatever its name
const THIS = /\bthis (creature|artifact|enchantment|land|planeswalker|battle|spell|card|permanent|token|aura|equipment|vehicle|saga|siege|class|contraption|attraction|spacecraft)\b/i;

type Candidate = { id: string, name: string, parts: string[], rule: boolean };
const candidates: Candidate[] = [];
const seen = new Set<string>();
const path = await bulkFile("default_cards", join(resolve("fuzz-results"), "bulk"));
for await (const line of createInterface({ input: createReadStream(path).pipe(createGunzip()) })) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (!c.oracle_id || seen.has(c.oracle_id)) continue;
    seen.add(c.oracle_id);
    const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
    if (!/legendary/i.test(c.type_line ?? "") || ["token", "double_faced_token", "art_series", "emblem"].includes(c.layout)) continue;
    // the rule alone, without what this script found last time
    const { printed, text } = cardText(c, {});
    const all = printed.join("\n");
    if ([c.name, ...faces.map((f) => f.name)].some((n: string) => all.includes(n)) || THIS.test(all)) continue;
    // the parts of its name the text uses: word runs from the start or the end of a face's name
    const parts = new Set<string>();
    for (const face of [c.name, ...faces.map((f) => f.name)] as string[]) {
        const words = face.split(" ");
        for (let i = 1; i < words.length; i++) {
            parts.add(words.slice(0, i).join(" ").replace(/,$/, ""));
            parts.add(words.slice(i).join(" "));
        }
    }
    const used = [...parts].filter((p) => p.length > 1 && new RegExp(`\\b${escapeRe(p)}\\b`).test(all)).sort((a, b) => b.length - a.length);
    if (used.length) candidates.push({ id: c.oracle_id, name: c.name, parts: used, rule: text.some((t) => t.includes("~")) });
}
console.log(`${candidates.length} legends name themselves only partly; asking Scryfall about them`);

const found = new Set<string>();
for (let i = 0; i < candidates.length; i += 15) {
    const q = `o:~ (${candidates.slice(i, i + 15).map((c) => `oracleid:${c.id}`).join(" or ")})`;
    const res = await politeFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`);
    if (res.status === 429) { console.log("Scryfall asked to slow down; waiting 90s"); await sleep(90_000); i -= 15; continue; }
    const body: any = await res.json();
    if (res.status !== 200 && res.status !== 404) throw new Error(`${res.status}: ${body.details}`);
    for (const c of body.data ?? []) found.add(c.oracle_id);
    process.stdout.write(`\r${Math.min(i + 15, candidates.length)}/${candidates.length}`);
    await sleep(1200);
}

// only where Scryfall and the rule disagree: the longest part its text uses, or none
const out: Record<string, string[]> = {};
for (const c of candidates) if (found.has(c.id) !== c.rule) out[c.name] = found.has(c.id) ? c.parts.slice(0, 1) : [];
writeFileSync(new URL("./short-names.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${Object.keys(out).length} legends where Scryfall's ~ differs from the rule, kept in scripts/short-names.json`);
