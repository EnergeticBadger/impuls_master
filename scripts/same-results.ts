// Does the engine still give the same results? npm run same-results -- --write, then change the engine, then
// npm run same-results (--check is the default). For changes to how the engine stores or finds things, not to
// what it finds: every search the suites know (the case files, fuzz-syntax's and test-keys' answers, every
// fuzz-search answer, the API cases through cardsSearch) is run and its whole list, in order, kept as a hash.
// --check lists every search whose list changed. Also reports the heap the loaded cards take (run node with
// --expose-gc for an exact figure, as npm run same-results does) and the median search time.
//   --file <path>   default fuzz-results/same-results.jsonl     --every <n>   only every nth search
// Use the same bulk files both times: SCRYFALL_BULK_DIR=fuzz-results/bulk-2026-10-14 npm run same-results

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Unsupported, bulkFile, listed, loadCards, parse, setsFile, type View } from "./local-search.ts";
import { cardsSearch } from "./search-api.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FILE = option("file", "fuzz-results/same-results.jsonl");
const EVERY = Number(option("every", "1"));
const WRITE = args.includes("--write");

const gc = (globalThis as { gc?: () => void }).gc;
const heap = () => { gc?.(); gc?.(); return process.memoryUsage().heapUsed; };
const before = heap();
const started = Date.now();
const bulk = join("fuzz-results", "bulk");
const data = await loadCards(await bulkFile("default_cards", bulk), await bulkFile("oracle_tags", bulk).catch(() => undefined),
    await setsFile(bulk).catch(() => undefined));
const loaded = Date.now() - started;
const mb = (n: number) => `${(n / 2 ** 20).toFixed(0)} MB`;
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${(loaded / 1000).toFixed(1)}s; `
    + `heap ${mb(heap())} (the cards ${mb(heap() - before)})${gc ? "" : ", without --expose-gc so roughly"}`);

// ---- every search the suites know ----

type Case = { id: string, run: () => Promise<unknown> | unknown };
const cases: Case[] = [];
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() && !l.trimStart().startsWith("#")) : [];
const keys = (file: string) => existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, "utf8"))) : [];
const viewOf = (qs: string): View => Object.fromEntries(new URLSearchParams(qs));
const search = (q: string, view: View = {}) => () => listed(parse(q), data, view);

for (const f of ["syntax", "panel", "combo"]) for (const q of lines(`scripts/${f}-cases.txt`)) cases.push({ id: `${f}\t${q}`, run: search(q) });
for (const l of lines("scripts/printing-cases.txt")) {
    const [q, qs] = l.split("\t");
    for (const view of qs ? [viewOf(qs)] : [{}, { unique: "prints" }, { order: "usd", dir: "desc" }]) cases.push({ id: `printing\t${q}\t${JSON.stringify(view)}`, run: search(q, view) });
}
for (const f of ["fuzz", "keys"]) for (const q of keys(`fuzz-results/scryfall-${f}.json`)) cases.push({ id: `${f}\t${q}`, run: search(q) });
const answers = "fuzz-results/search/answers.jsonl";
const asked = new Set<string>();
if (existsSync(answers)) for (const l of readFileSync(answers, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const key: string = JSON.parse(l).key;
    if (asked.has(key)) continue;
    asked.add(key);
    const [q, qs] = key.split("\u0000");
    cases.push({ id: `search\t${key}`, run: search(q, viewOf(qs ?? "")) });
}
for (const l of lines("scripts/api-cases.txt")) {
    const params = l.startsWith("?") ? Object.fromEntries(new URLSearchParams(l.slice(1))) : { q: l.trim() };
    cases.push({ id: `api\t${l}`, run: async () => (await cardsSearch(data, params, { card: (i) => data.prints[i].id })) });
}

// ---- run them ----

const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const got = new Map<string, string>();
const times: number[] = [];
for (const [i, c] of cases.entries()) {
    if (i % EVERY) continue;
    const t = performance.now();
    let out: unknown;
    try { out = await c.run(); } catch (e) { out = e instanceof Unsupported ? "unsupported" : `error: ${(e as Error).message}`; }
    times.push(performance.now() - t);
    got.set(c.id, `${Array.isArray(out) ? out.length : "-"} ${hash(out)}`);
}
times.sort((a, b) => a - b);
console.log(`${got.size.toLocaleString()} searches, median ${times[times.length >> 1].toFixed(1)} ms, slowest ${times[times.length - 1].toFixed(0)} ms`);

if (WRITE) {
    writeFileSync(FILE, [...got].map(([id, h]) => JSON.stringify([id, h])).join("\n") + "\n");
    console.log(`written to ${FILE}`);
} else {
    const was = new Map<string, string>(readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    const changed = [...got].filter(([id, h]) => was.has(id) && was.get(id) !== h);
    const missing = [...was.keys()].filter((id) => !got.has(id)).length;
    for (const [id, h] of changed.slice(0, 50)) console.log(`  ${id.replace(/\u0000/g, " | ")}: ${was.get(id)} -> ${h}`);
    console.log(changed.length ? `${changed.length} of ${got.size} searches changed` : `all ${got.size - [...got.keys()].filter((id) => !was.has(id)).length} searches the same`
        + (missing ? ` (${missing} in ${FILE} not run)` : ""));
    if (changed.length) process.exitCode = 1;
}
