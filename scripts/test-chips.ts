// Checks that the filter panel's chips read left to right, with the local search: npm run test-chips
//   --count <n>   how many runs of chips (default 400)      --seed <n>   which ones (default 1)      --out <dir>
// For random runs of 2–5 chips (every filter, "What it does" too), each joined to what's before it with AND or OR:
//   - the search buildQuery writes finds what the chips do one at a time, left to right: each chip's printings
//     ANDed or ORed onto the ones so far. A card matches when one of its printings does, so it's printings
//     that are folded, not cards (r:rare s:neo is one printing that's both)
//   - parseQuery reads that search back into chips that find the same cards
//   - a search written before chips read left to right (`a or b c`, where AND bound tighter) still finds the
//     same cards once parseQuery has read it back
// Set and artist chips are left out: they show printings that are otherwise hidden to the whole search, so a
// chip's printings depend on what's beside it. Exit code 1 if anything is off.
// Runs with node --import ./scripts/app-paths.ts, since filters.ts imports the app's ~/ paths.

import { join, resolve } from "node:path";
import { buildQuery, joinQuery, parseQuery } from "../app/Components/Searchbar/filters.ts";
import { EFFECTS, ROLES } from "../app/Components/Searchbar/rules.ts";
import { bulkFile, loadCards, parse, search, searchPrintings, setsFile } from "./local-search.ts";
import { OTHERS, chip, rules, type Chip, type Spec } from "./panel-chips.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const COUNT = Number(option("count", "400"));

let state = Number(option("seed", "1")) >>> 0 || 1;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const pool: Spec[] = [
    ...OTHERS.filter((s) => s.id !== "set" && s.id !== "artist"),
    ...ROLES.slice(0, 10).map((r) => rules({ values: [r.value] })),
    ...EFFECTS.filter((_, i) => i % 6 === 0).map((e) => rules({ blocks: [{ trigger: "", effect: e.value, words: "" }] })),
    rules({ text: "draw a card" }),
];

const printings = new Map<string, Set<number>>();
const printsOf = (q: string) => printings.get(q) ?? printings.set(q, new Set(searchPrintings(parse(q), data))).get(q)!;
const cardsOf = (q: string) => new Set(search(parse(q), data));
const toCards = (prints: Set<number>) => new Set([...prints].map((p) => data.prints[p].card));
const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));

// the chips one at a time, left to right
function folded(chips: Chip[]): Set<number> {
    let so = new Set(printsOf(chips[0].token));
    for (const c of chips.slice(1)) {
        const these = printsOf(c.token);
        so = c.join === "and" ? new Set([...so].filter((p) => these.has(p))) : new Set([...so, ...these]);
    }
    return toCards(so);
}

// the search as chips were written before they read left to right: an AND added without brackets
const oldQuery = (chips: Chip[]) => chips.reduce((q, c) => q && c.join === "and" ? `${q} ${c.token}` : joinQuery(q, c.token, c.join), "");

const problems: string[] = [];
let oldDiffer = 0, sameText = 0;
for (let n = 0; n < COUNT; n++) {
    const chips = Array.from({ length: 2 + Math.floor(random() * 4) }, (_, i) => chip(pick(pool), i && random() < 0.4 ? "or" : "and"));
    const q = buildQuery(chips);
    const about = chips.map((c, i) => `${i ? `${c.join.toUpperCase()} ` : ""}[${c.token}]`).join(" ");
    const found = cardsOf(q);
    const want = folded(chips);
    if (!same(found, want)) problems.push(`not left to right: ${about}\n  \`${q}\` finds ${found.size}, the chips one at a time ${want.size}`);
    const back = buildQuery(parseQuery(q));
    if (back === q) sameText++;
    else if (!same(cardsOf(back), found)) problems.push(`read back differently: ${about}\n  \`${q}\` → \`${back}\``);
    const old = oldQuery(chips);
    if (old !== q) {
        oldDiffer++;
        const reread = buildQuery(parseQuery(old));
        if (!same(cardsOf(reread), cardsOf(old))) problems.push(`an old search changed meaning: \`${old}\` → \`${reread}\``);
    }
}

console.log(`${COUNT} runs of chips: ${problems.length ? `${problems.length} problems` : "all read left to right"}; ${sameText} read back to the same search, the rest to one that finds the same cards; ${oldDiffer} would have been written differently before, and read back the same way they meant then. Took ${((Date.now() - started) / 1000).toFixed(0)}s`);
for (const p of problems.slice(0, 20)) console.log(`- ${p}`);
process.exitCode = problems.length ? 1 : 0;
