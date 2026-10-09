// Checks scripts/search-api.ts, our stand-in for Scryfall's GET /cards/search, against Scryfall's own responses:
// npm run test-api. Each case is asked of Scryfall once and kept, raw, in <out>/raw (see scryfall-raw.ts), so a
// run after the first is offline.
// The cases are scripts/syntax-cases.txt and panel-cases.txt (searches that work) and scripts/api-cases.txt
// (broken and odd ones, and the API's other parameters). For each, page 1; for a longer answer also a page picked
// at random (the same one every run) and, for some, the last page.
// Each response is compared field by field: status, object, code, total_cards, has_more, next_page, warnings,
// details, and the cards in data by id. What differs is put in one of two piles:
//   - response: the shape, status, paging, warnings and error text, which are search-api.ts's job
//   - cards: which cards, printings and order, which are the engine's (local-search.ts)
//   --out <dir>   default fuzz-results/api      --refresh   ask Scryfall again      --only <text>   cases containing it
//   --fetch-only   only ask Scryfall (no engine), to fill the cache   --offline   only the cases already asked
// <out>/api-summary.md lists what differs; exit code 1 if a response differs.

import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { API, RawAnswers, type Raw } from "./scryfall-raw.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results/api"));
const ONLY = option("only", "");
const REFRESH = args.includes("--refresh");
const FETCH_ONLY = args.includes("--fetch-only");
// only the cases already asked, without asking Scryfall anything
const OFFLINE = args.includes("--offline");
const PAGE = 175;

// a case is a search on its own, or "?" and the whole query string as sent (for page, order, unique…)
const FILES = ["syntax", "panel", "api"];
const lines = [...new Set(FILES.flatMap((f) => readFileSync(new URL(`./${f}-cases.txt`, import.meta.url), "utf8").split("\n"))
    .map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes(ONLY)))];
// a line from api-cases.txt is kept as written (spaces matter there), the others trimmed
const caseQuery = (line: string) => line.startsWith("?") ? line.slice(1) : new URLSearchParams({ q: line.trim() }).toString();

// the same "random" page every run: from the case's text
const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
const withPage = (query: string, page: number) => {
    const p = new URLSearchParams(query);
    p.set("page", String(page));
    return p.toString();
};

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);
const raw = new RawAnswers(join(OUT, "raw"), say);

// the requests for a case: page 1 (or the page it asks for), and for a longer answer a page at random and, for one
// in three, the last one
async function requests(line: string, ask: (query: string) => Promise<Raw>): Promise<string[]> {
    const first = caseQuery(line);
    const out = [first];
    if (new URLSearchParams(first).has("page")) return out;
    const r = await ask(first);
    if (r.status !== 200 || !r.body?.has_more) return out;
    const last = Math.ceil(r.body.total_cards / PAGE);
    const h = hash(line);
    out.push(withPage(first, 2 + (h % (last - 1))));
    if (h % 3 === 0 && last > 2) out.push(withPage(first, last));
    return [...new Set(out)];
}

class NotAsked extends Error {}
const url = (query: string) => `${API}cards/search?${query}`;
let asked = 0;
const ask = async (query: string) => {
    const known = REFRESH ? undefined : raw.known(url(query));
    if (known) return known;
    if (OFFLINE) throw new NotAsked();
    asked++;
    say(`asking Scryfall (${asked}): ${decodeURIComponent(query)}`);
    return raw.get(url(query), true);
};

// Scryfall's side first, so the comparison runs in one go
const all: { line: string, queries: string[] }[] = [];
for (const line of lines) {
    try {
        const queries = await requests(line, ask);
        for (const q of queries) await ask(q);
        all.push({ line, queries });
    } catch (e) {
        if (!(e instanceof NotAsked)) throw e;
    }
}
if (asked) say(`asked Scryfall ${asked} requests\n`);
if (FETCH_ONLY) process.exit(0);

// ---- our side ----
const { Unsupported, bulkFile, loadCards, setsFile } = await import("./local-search.ts");
const { cardsSearch } = await import("./search-api.ts");

// every printing's card object, as the bulk file has it, read on demand: the file unpacked once into <out>, and
// where each printing the engine loads starts in it
class CardStore {
    private fd: number;
    private at: number[];
    private size: number[];
    private constructor(file: string, at: number[], size: number[]) {
        this.fd = openSync(file, "r");
        this.at = at;
        this.size = size;
    }
    static async open(gz: string, dir: string): Promise<CardStore> {
        const file = join(dir, "default_cards.jsonl"), index = join(dir, "default_cards.index.json");
        const stamp = statSync(gz).mtimeMs;
        if (existsSync(index)) {
            const old = JSON.parse(readFileSync(index, "utf8"));
            if (old.stamp === stamp && existsSync(file)) return new CardStore(file, old.at, old.size);
        }
        mkdirSync(dir, { recursive: true });
        const outStream = createWriteStream(file);
        const at: number[] = [], size: number[] = [];
        let offset = 0;
        for await (const line of createInterface({ input: createReadStream(gz).pipe(createGunzip()), crlfDelay: Infinity })) {
            const bytes = Buffer.byteLength(line) + 1;
            if (line.trim()) {
                // the engine skips a line without an oracle id (see loadCards), so the indexes line up
                const c = JSON.parse(line);
                if (c.oracle_id ?? c.card_faces?.[0]?.oracle_id) { at.push(offset); size.push(bytes - 1); }
            }
            if (!outStream.write(`${line}\n`)) await new Promise((res) => outStream.once("drain", res));
            offset += bytes;
        }
        await new Promise((res) => outStream.end(res));
        writeFileSync(index, JSON.stringify({ stamp, at, size }));
        return new CardStore(file, at, size);
    }
    get count() { return this.at.length; }
    card(i: number): any {
        const buf = Buffer.alloc(this.size[i]);
        readSync(this.fd, buf, 0, this.size[i], this.at[i]);
        return JSON.parse(buf.toString("utf8"));
    }
    close() { closeSync(this.fd); }
}

const started = Date.now();
const bulk = join(OUT, "bulk");
const printsFile = await bulkFile("default_cards", bulk);
const data = await loadCards(printsFile, await bulkFile("oracle_tags", bulk).catch(() => undefined), await setsFile(bulk).catch(() => undefined));
const store = await CardStore.open(printsFile, OUT);
if (store.count !== data.prints.length) throw new Error(`card store has ${store.count} printings, the engine ${data.prints.length}`);
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// ---- comparing ----
// a difference is the response's (search-api.ts) or the cards' (the engine: which cards, printings, order)
type Diff = { query: string, pile: "response" | "cards", what: string };
const diffs: Diff[] = [];
let compared = 0, unsupported = 0, sameCards = 0, pagesWithData = 0, objectsChecked = 0;
const unsupportedList: string[] = [];
const objectDiffs = new Map<string, number>();
const show = (v: unknown) => JSON.stringify(v);
const base = "https://local.test/";

for (const { queries } of all) {
    for (const query of queries) {
        const theirs = (await ask(query)).body;
        const theirStatus = (await ask(query)).status;
        let ours: { status: number, body: any };
        try {
            ours = await cardsSearch(data, Object.fromEntries(new URLSearchParams(query)), { base, card: (i: number) => store.card(i) });
        } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
            unsupported++;
            unsupportedList.push(`\`${decodeURIComponent(query)}\`: ${(e as Error).message}`);
            continue;
        }
        compared++;
        const d = (pile: Diff["pile"], what: string) => diffs.push({ query, pile, what });
        if (typeof theirs === "string") { d("response", `Scryfall sent text: ${theirs.slice(0, 80)}`); continue; }
        const o = ours.body;
        // the cards differ when the totals do; then has_more, next_page and a 404 for none follow from that
        const cardsDiffer = theirs.object === "list" && o.object === "list" && theirs.total_cards !== o.total_cards
            || (theirStatus === 404) !== (ours.status === 404) && !theirs.warnings?.length && !o.warnings?.length && theirs.code !== "bad_request" && o.code !== "bad_request";
        const pileFor = (field: string) => cardsDiffer && ["status", "object", "code", "details", "total_cards", "has_more", "next_page"].includes(field) ? "cards" : "response";
        if (theirStatus !== ours.status) d(pileFor("status"), `status: Scryfall ${theirStatus}, here ${ours.status}`);
        // the fields and their order
        const keys = (b: any) => Object.keys(b).join(",");
        if (theirStatus === ours.status && keys(theirs) !== keys(o)) d("response", `fields: Scryfall ${keys(theirs)}, here ${keys(o)}`);
        for (const field of ["object", "code", "details", "total_cards", "has_more"]) {
            if (show(theirs[field]) !== show(o[field])) d(pileFor(field), `${field}: Scryfall ${show(theirs[field])}, here ${show(o[field])}`);
        }
        if (show(theirs.warnings) !== show(o.warnings)) d("response", `warnings: Scryfall ${show(theirs.warnings)}, here ${show(o.warnings)}`);
        const next = (s?: string) => s?.replace(API, base);
        if (next(theirs.next_page) !== o.next_page) d(pileFor("next_page"), `next_page: Scryfall ${show(theirs.next_page)}, here ${show(o.next_page)}`);
        if (Array.isArray(theirs.data) && Array.isArray(o.data)) {
            pagesWithData++;
            const ids = (list: any[]) => list.map((c) => c.id).join();
            if (ids(theirs.data) === ids(o.data)) sameCards++;
            else {
                // by card: the same cards in another order, or with other printings, or other cards
                const oracle = (c: any) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
                const name = (list: any[], i: number) => list[i] ? `${list[i].name} (${list[i].set} ${list[i].collector_number})` : "nothing";
                const at = theirs.data.findIndex((c: any, i: number) => c.id !== o.data[i]?.id);
                const sameOracle = theirs.data.map(oracle).join() === o.data.map(oracle).join();
                d("cards", `data${sameOracle ? " (same cards, another printing)" : ""}: from #${at + 1}, Scryfall ${name(theirs.data, at)}, here ${name(o.data, at)}`);
            }
            // the card objects themselves, where the printing's the same: the bulk file's are the API's, but for
            // what changes daily (prices) and what the bulk file's day missed
            const byId = new Map(o.data.map((c: any) => [c.id, c]));
            for (const c of theirs.data) {
                const mine: any = byId.get(c.id);
                if (!mine) continue;
                objectsChecked++;
                for (const k of new Set([...Object.keys(c), ...Object.keys(mine)])) {
                    if (show(c[k]) !== show(mine[k])) objectDiffs.set(k, (objectDiffs.get(k) ?? 0) + 1);
                }
            }
        }
    }
}
store.close();

const responses = all.reduce((n, c) => n + c.queries.length, 0);
const responseDiffs = diffs.filter((x) => x.pile === "response"), cardDiffs = diffs.filter((x) => x.pile === "cards");
const badResponse = new Set(responseDiffs.map((x) => x.query)), badCards = new Set(cardDiffs.map((x) => x.query));
const list = (ds: Diff[]) => {
    const by = new Map<string, string[]>();
    for (const x of ds) by.set(x.query, [...(by.get(x.query) ?? []), x.what]);
    return [...by].map(([q, whats]) => `- \`${decodeURIComponent(q.replace(/\+/g, " "))}\`\n${whats.map((w) => `  - ${w}`).join("\n")}`);
};
const pct = (n: number, of: number) => `${(100 * n / Math.max(of, 1)).toFixed(2)}%`;
const summary = [
    `# cards/search: search-api.ts against Scryfall`, ``,
    `${new Date().toISOString()} · ${all.length} cases, ${responses} responses: ${compared} compared, ${unsupported} not supported here`, ``,
    `- **Response** (status, fields, totals, paging, warnings, error text): ${compared - badResponse.size} of ${compared} match (${pct(compared - badResponse.size, compared)})`,
    `- **Cards** (which cards, printings, order; the engine's): ${compared - badCards.size} of ${compared} match; ${sameCards} of ${pagesWithData} pages of cards the same, card for card`,
    `- **Card objects**: ${objectsChecked} cards on the same printing compared field by field; fields that differed: ${[...objectDiffs].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`, ``,
    `## Response differs`, ``, ...(responseDiffs.length ? list(responseDiffs) : ["None."]), ``,
    `## Cards differ (the engine's)`, ``, ...(cardDiffs.length ? list(cardDiffs) : ["None."]), ``,
    `## Not supported here`, ``, ...(unsupportedList.length ? unsupportedList.map((l) => `- ${l}`) : ["None."]), ``,
];
writeFileSync(join(OUT, "api-summary.md"), summary.join("\n"));
console.log(summary.slice(2, 6).join("\n"));
console.log(`Summary: ${join(OUT, "api-summary.md")}`);
process.exitCode = responseDiffs.length ? 1 : 0;
