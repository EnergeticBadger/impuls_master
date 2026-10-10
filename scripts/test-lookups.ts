// Checks scripts/lookups.ts (catalogs, card lookups, rulings, autocomplete, sets answered from the bulk files)
// against Scryfall's API, request by request: npm run test-lookups
// The requests come from scripts/lookup-cases.ts (a few thousand, made from the bulk files with a fixed seed).
// Scryfall's answer to each is kept as it came (status and body) in <cache>/raw/, so a run after the first is
// offline; --refresh asks again. Requests go one at a time through scripts/scryfall-answers.ts (politeFetch).
//   --cache <dir>   default fuzz-results/lookups      --data <dir>   the built data, default <cache>/data
//   --fetch         only ask Scryfall what isn't cached yet (for a first run in the background)
//   --only <text>   only cases whose path contains it
// SCRYFALL_BULK_DIR is the folder of bulk files, as for scripts/lookups-build.ts. Build the data first, from the
// same bulk files: node scripts/lookups-build.ts <cache>/data
// <cache>/lookups-summary.md lists what differs, per endpoint; exit code 1 if anything does.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { politeFetch } from "./scryfall-answers.ts";
import { makeCases, type Case } from "./lookup-cases.ts";
import { Lookups, autocompleteKey, type Store } from "./lookups.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CACHE = resolve(option("cache", "fuzz-results/lookups"));
const ONLY = option("only", "");
const BULK = process.env.SCRYFALL_BULK_DIR ?? "fuzz-results/bulk";

// ---- Scryfall's answers, as they came ----
export type Raw = { path: string, at: number, status: number, body: string };
const rawFile = (path: string) => join(CACHE, "raw", `${createHash("sha1").update(path).digest("hex")}.json`);
function cached(path: string): Raw | undefined {
    const f = rawFile(path);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
}
async function ask(path: string, refresh = false): Promise<Raw> {
    const known = refresh ? undefined : cached(path);
    if (known) return known;
    const res = await politeFetch(`https://api.scryfall.com/${path}`);
    const raw = { path, at: Date.now(), status: res.status, body: await res.text() };
    mkdirSync(join(CACHE, "raw"), { recursive: true });
    writeFileSync(rawFile(path), JSON.stringify(raw));
    return raw;
}

// ---- the cases, made once ----
async function cases(): Promise<Case[]> {
    const file = join(CACHE, "cases.json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    const made = await makeCases(BULK);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(made, null, 1));
    return made;
}

const all = (await cases()).filter((c) => c.path.includes(ONLY));

if (args.includes("--fetch")) {
    // every endpoint and kind of case in turn, so a partial run already covers each of them
    const queues = new Map<string, Case[]>();
    for (const c of all) if (!cached(c.path)) (queues.get(c.endpoint + c.kind) ?? queues.set(c.endpoint + c.kind, []).get(c.endpoint + c.kind)!).push(c);
    let left = [...queues.values()].reduce((n, q) => n + q.length, 0), done = 0;
    console.log(`${left} requests to ask Scryfall`);
    while (left > 0) {
        for (const q of queues.values()) {
            const c = q.shift();
            if (!c) continue;
            await ask(c.path, args.includes("--refresh"));
            left--;
            if (++done % 50 === 0) console.log(`${done} asked, ${left} to go`);
        }
    }
    console.log("all asked");
    process.exit(0);
}

// ---- compare ----

// the built data, read from disk
const DATA = resolve(option("data", join(CACHE, "data")));
const store: Store = {
    async read(path) {
        const file = join(DATA, path);
        return existsSync(file) ? readFileSync(file, "utf8") : undefined;
    },
};
const lookups = await Lookups.open(store);

// Fields Scryfall updates every day apart from the cards, so a bulk file a few hours old has yesterday's:
// prices, and the EDHREC and Penny Dreadful ranks. Answers differing only in these count as the same, and are
// counted apart ("daily")
const DAILY = new Set(["prices", "edhrec_rank", "penny_rank"]);

// the first difference between two JSON values, as a path and both values; undefined when they're the same.
// Keys in `ignore` are skipped at any depth
function differ(a: unknown, b: unknown, ignore: Set<string>, path = ""): string | undefined {
    if (a === b) return undefined;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
        return `${path || "body"}: Scryfall ${JSON.stringify(a)?.slice(0, 200)}, local ${JSON.stringify(b)?.slice(0, 200)}`;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return `${path}: one is a list`;
    if (Array.isArray(a)) {
        const bb = b as unknown[];
        for (let i = 0; i < Math.max(a.length, bb.length); i++) {
            const d = differ(a[i], bb[i], ignore, `${path}[${i}]`);
            if (d) return a.length !== bb.length ? `${d} (Scryfall ${a.length} long, local ${bb.length})` : d;
        }
        return undefined;
    }
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
        if (ignore.has(k)) continue;
        const d = differ(ao[k], bo[k], ignore, path ? `${path}.${k}` : k);
        if (d) return d;
    }
    return undefined;
}

// rulings in an order that doesn't depend on the order of the same day's rulings, which the bulk file doesn't keep
const dayOrder = (body: any) => ({
    ...body,
    data: [...body.data].sort((x: any, y: any) => y.published_at.localeCompare(x.published_at) || x.comment.localeCompare(y.comment)),
});

// A card's all_parts (its tokens, meld parts, combo pieces) each point at one printing of the related card, and
// Scryfall picks that printing again from time to time: Highspire Infusion's Energy Reserve was tkld in both
// bulk files of 8 Oct and tdrc in the API on 9 Oct; Squire's Devotion's Vampire went from txln to plst. The
// newer pick isn't in any bulk file yet, so answers differing only there are counted apart ("related printing")
const otherParts = (body: any) => body?.object === "card" && Array.isArray(body.all_parts)
    ? { ...body, all_parts: body.all_parts.map(({ id, uri, ...rest }: any) => rest) }
    : body;

// a card's name and printing, or an error's details, to read a difference by
function brief(body: string) {
    try {
        const b = JSON.parse(body);
        if (b.object === "card") return `${b.name} (${b.set} ${b.collector_number} ${b.lang})`;
        if (b.object === "error") return `“${b.details}”`;
        return b.object;
    } catch { return body.slice(0, 80); }
}

// same: the very same answer. daily: the same but for DAILY fields. rulings order: the same rulings, with the
// same day's in another order
type Outcome = "same" | "daily" | "related printing" | "tie order" | "differs" | "unanswered" | "unasked";
type Result = { c: Case, outcome: Outcome, note?: string };
const results: Result[] = [];
for (const c of all) {
    const theirs = cached(c.path);
    if (!theirs) { results.push({ c, outcome: "unasked" }); continue; }
    const ours = await lookups.get(c.path);
    if (!ours) { results.push({ c, outcome: "unanswered" }); continue; }
    if (theirs.status !== ours.status) {
        results.push({ c, outcome: "differs", note: `status: Scryfall ${theirs.status} ${brief(theirs.body)}, local ${ours.status} ${brief(ours.body)}` });
        continue;
    }
    const a = JSON.parse(theirs.body), b = JSON.parse(ours.body);
    const exact = differ(a, b, new Set());
    if (!exact) { results.push({ c, outcome: "same" }); continue; }
    const d = differ(a, b, DAILY);
    if (!d) { results.push({ c, outcome: "daily", note: exact }); continue; }
    if (!differ(otherParts(a), otherParts(b), DAILY)) { results.push({ c, outcome: "related printing", note: d }); continue; }
    // the same keys in the same places: only names that tie have moved (possibly across the 20-name cut)
    const asked = new URLSearchParams(c.path.split("?")[1]).get("q") ?? "";
    const keys = (x: any) => JSON.stringify(x.data.map((n: string) => autocompleteKey(asked, n)));
    const sameNames = (x: any, y: any) => keys(x) === keys(y);
    if ((c.endpoint === "rulings" && a.object === "list" && !differ(dayOrder(a), dayOrder(b), new Set()))
        || (c.endpoint === "autocomplete" && a.object === "catalog" && sameNames(a, b))) {
        results.push({ c, outcome: "tie order", note: d });
        continue;
    }
    results.push({ c, outcome: "differs", note: d });
}

const out: string[] = [`# Lookups vs Scryfall`, "", `${new Date().toISOString()}, data built ${lookups.index.built}`, "",
    "Same: the whole answer is. Daily: the same but for prices or EDHREC/Penny ranks, which Scryfall updates every day " +
    "apart from the cards. Related printing: the same but for which printing all_parts points at, which Scryfall " +
    "picks again after the bulk file is made. Tie order: the same rulings, but the same day's in another order (the bulk " +
    "file doesn't keep Scryfall's), or the same autocomplete names, but names equally near in another order " +
    "(Scryfall's order for those follows nothing in the data). Strict counts only same; explained counts all four.", ""];
out.push("| endpoint | asked | same | daily | related printing | tie order | differs | not answered here | % strict | % explained |",
    "|---|---|---|---|---|---|---|---|---|---|");
const endpoints = [...new Set(results.map((r) => r.c.endpoint))];
let bad = 0;
const count = (rs: Result[], o: Outcome) => rs.filter((r) => r.outcome === o).length;
for (const e of endpoints) {
    const rs = results.filter((r) => r.c.endpoint === e && r.outcome !== "unasked");
    const explained = count(rs, "same") + count(rs, "daily") + count(rs, "related printing") + count(rs, "tie order");
    bad += rs.length - explained;
    const pct = (n: number) => rs.length ? (100 * n / rs.length).toFixed(2) : "-";
    out.push(`| ${e} | ${rs.length} | ${count(rs, "same")} | ${count(rs, "daily")} | ${count(rs, "related printing")} | ` +
        `${count(rs, "tie order")} | ${count(rs, "differs")} | ${count(rs, "unanswered")} | ${pct(count(rs, "same"))} | ${pct(explained)} |`);
}
const unasked = count(results, "unasked");
const head = out.length;
if (unasked) out.push("", `${unasked} not asked of Scryfall yet (npm run test-lookups -- --fetch)`);
const quote = (path: string) => "`" + decodeURIComponent(path) + "`";
for (const e of endpoints) {
    const rs = results.filter((r) => r.c.endpoint === e && ["differs", "unanswered", "tie order", "related printing"].includes(r.outcome));
    if (!rs.length) continue;
    out.push("", `## ${e}`, "");
    for (const r of rs) out.push(`- ${r.outcome === "differs" ? "" : `(${r.outcome}) `}${r.c.kind}: ${quote(r.c.path)}: ${r.note ?? ""}`);
}
const daily = results.filter((r) => r.outcome === "daily");
if (daily.length) {
    out.push("", `## Daily fields (${daily.length}, the first 20)`, "");
    for (const r of daily.slice(0, 20)) out.push(`- ${quote(r.c.path)}: ${r.note}`);
}
mkdirSync(CACHE, { recursive: true });
writeFileSync(join(CACHE, "lookups-summary.md"), out.join("\n") + "\n");
console.log(out.slice(0, head + (unasked ? 2 : 0)).join("\n"));
console.log(`\nDetails: ${join(CACHE, "lookups-summary.md")}`);
process.exit(bad ? 1 : 0);
