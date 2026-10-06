// Checks the local search (scripts/local-search.ts) against Scryfall, search by search: npm run test-syntax
// The searches are scripts/syntax-cases.txt. Each is run on Scryfall once and remembered in
// <out>/scryfall-syntax.json (a week, or until --refresh), so a run after the first is offline and quick.
// Where Scryfall's whole answer fits in a few pages the two are compared card by card, and the cards only one
// side found are listed, which usually says exactly what's different.
//   --out <dir>   default fuzz-results      --refresh   ask Scryfall again      --only <text>   cases containing it
// <out>/syntax-summary.md starts with what differs; exit code 1 if anything does.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Unsupported, bulkFile, loadCards, parse, search, setsFile } from "./local-search.ts";

const HEADERS = { "User-Agent": "impuls_master-tests/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const ONLY = option("only", "");
const REFRESH = args.includes("--refresh");
// Scryfall's answer is kept whole up to this many pages (175 cards each); past it, only the count
const PAGES = 5;
const WEEK = 7 * 24 * 3600_000;

const cases = readFileSync(new URL("./syntax-cases.txt", import.meta.url), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes(ONLY));

type Answer = { at: number, total: number, cards?: [string, string][], error?: string };
mkdirSync(OUT, { recursive: true });
const cacheFile = join(OUT, "scryfall-syntax.json");
const cache: Record<string, Answer> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);

async function scryfall(q: string): Promise<Answer> {
    const cards: [string, string][] = [];
    let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`;
    let total = 0;
    for (let page = 0; url && page < PAGES; page++) {
        const r = await fetch(url, { headers: HEADERS });
        if (r.status === 429) { say("Scryfall asked to slow down; waiting 90s"); await sleep(90_000); page--; continue; }
        const j: any = await r.json().catch(() => ({ details: `HTTP ${r.status}` }));
        if (r.status === 404) return { at: Date.now(), total: 0, cards: [] };
        if (!j.data) return { at: Date.now(), total: 0, error: j.details ?? `HTTP ${r.status}` };
        total = j.total_cards;
        for (const c of j.data) cards.push([c.oracle_id ?? c.card_faces?.[0]?.oracle_id, c.name]);
        url = j.has_more ? j.next_page : undefined;
        await sleep(1500);
    }
    return { at: Date.now(), total, cards: cards.length === total ? cards : undefined };
}

// Scryfall's answers first, so the comparison below runs in one go
const missing = cases.filter((q) => REFRESH || !cache[q] || Date.now() - cache[q].at > WEEK);
for (const [n, q] of missing.entries()) {
    say(`asking Scryfall ${n + 1}/${missing.length}: ${q}`);
    cache[q] = await scryfall(q);
    writeFileSync(cacheFile, JSON.stringify(cache));
}
if (missing.length) say(`asked Scryfall ${missing.length} searches\n`);

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

type Row = { q: string, local?: number, scryfall: number, onlyHere: string[], onlyThere: string[], why?: string, error?: string };
const rows: Row[] = [];
for (const q of cases) {
    const theirs = cache[q];
    const row: Row = { q, scryfall: theirs.total, onlyHere: [], onlyThere: [], error: theirs.error };
    try {
        const found = search(parse(q), data);
        row.local = found.length;
        if (theirs.cards) {
            const there = new Set(theirs.cards.map(([id]) => id));
            const here = new Set(found.map((i) => data.cards[i].oracleId));
            row.onlyHere = found.filter((i) => !there.has(data.cards[i].oracleId)).map((i) => data.cards[i].name);
            row.onlyThere = theirs.cards.filter(([id]) => !here.has(id)).map(([, name]) => name);
        }
    } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.why = e.message;
    }
    rows.push(row);
}

const exact = rows.filter((r) => !r.error && r.local !== undefined && r.local === r.scryfall && !r.onlyHere.length && !r.onlyThere.length);
const differ = rows.filter((r) => !r.error && r.local !== undefined && !exact.includes(r))
    .sort((a, b) => Math.abs(b.local! - b.scryfall) - Math.abs(a.local! - a.scryfall));
const unsupported = rows.filter((r) => r.why !== undefined);
const errors = rows.filter((r) => r.error);
const names = (list: string[]) => list.slice(0, 6).join(", ") + (list.length > 6 ? ` +${list.length - 6} more` : "");

const lines = [
    `# Search syntax against Scryfall`, ``,
    `${new Date().toISOString()} · ${rows.length} searches: ${exact.length} exact, ${differ.length} differ, ${unsupported.length} not supported here, ${errors.length} Scryfall errors`, ``,
    `## Differ`, ``,
    ...(differ.length ? differ.flatMap((r) => [
        `- \`${r.q}\`: here ${r.local}, Scryfall ${r.scryfall}${r.onlyHere.length + r.onlyThere.length ? "" : " (counts only: too many to list)"}`,
        ...(r.onlyHere.length ? [`  only here: ${names(r.onlyHere)}`] : []),
        ...(r.onlyThere.length ? [`  only Scryfall: ${names(r.onlyThere)}`] : []),
    ]) : ["None."]), ``,
    `## Not supported here yet`, ``,
    ...(unsupported.length ? unsupported.map((r) => `- \`${r.q}\`: ${r.why}`) : ["None."]), ``,
    ...(errors.length ? [`## Scryfall errors`, ``, ...errors.map((r) => `- \`${r.q}\`: ${r.error}`), ``] : []),
    `## Exact`, ``, exact.map((r) => `\`${r.q}\` (${r.scryfall})`).join(" · "), ``,
];
writeFileSync(join(OUT, "syntax-summary.md"), lines.join("\n"));
console.log(`${rows.length} searches: ${exact.length} exact, ${differ.length} differ, ${unsupported.length} not supported here, ${errors.length} Scryfall errors`);
console.log(`Summary: ${join(OUT, "syntax-summary.md")}`);
process.exitCode = differ.length || unsupported.length ? 1 : 0;
