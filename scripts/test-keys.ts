// Checks the local search (scripts/local-search.ts) against Scryfall key by key: every is: value it knows, every
// format, keyword, set type, game, rarity, border, frame, stamp, watermark and the biggest Tagger tags, each
// searched alone: npm run test-keys -- [--out <dir>] [--only <text>] [--refresh]
// The hand-picked searches in syntax-cases.txt only cover what someone thought to try; this covers every value.
// First only the counts are compared (one request each). Where they differ, the key is split by mana value (and
// a big slice by color) and the cards of each slice that differs are fetched, to show which cards those are.
// Scryfall's answers are kept a week in <out>/scryfall-keys.json, so a run after the first is offline.
// <out>/keys-summary.md starts with what differs; exit code 1 if anything does.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGE, Answers } from "./scryfall-answers.ts";
import { Unsupported, bulkFile, isValues, loadCards, parse, search, setsFile, type Cards } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const ONLY = option("only", "");
const REFRESH = args.includes("--refresh");
// a slice is fetched whole up to this many pages
const PAGES = 5;
// keywords, watermarks and tags with fewer cards than this aren't worth a request each
const MIN_CARDS = 30;
const TAGS = 60;

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);
const answers = new Answers(join(OUT, "scryfall-keys.json"), say);

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// the values each key takes in the cards themselves, most common first; those under `min` cards are left out
function values(data: Cards, each: (card: number) => Iterable<string>, min = MIN_CARDS): string[] {
    const count = new Map<string, Set<number>>();
    for (const [i] of data.cards.entries()) for (const v of each(i)) {
        if (!v) continue;
        if (!count.has(v)) count.set(v, new Set());
        count.get(v)!.add(i);
    }
    return [...count].filter(([, cards]) => cards.size >= min).sort((a, b) => b[1].size - a[1].size).map(([v]) => v);
}
const printsOf = (i: number) => data.cards[i].printings.map((p) => data.prints[p]);
const quote = (v: string) => /[\s()"]/.test(v) ? `"${v}"` : v;
const formats = values(data, (i) => [...data.cards[i].legal, ...data.cards[i].banned], 1);

const keys: string[] = [
    ...isValues(data).map((v) => `is:${v}`),
    "has:indicator", "has:watermark",
    ...formats.map((f) => `f:${f}`),
    ...values(data, (i) => data.cards[i].banned, 1).map((f) => `banned:${f}`),
    ...values(data, (i) => data.cards[i].restricted, 1).map((f) => `restricted:${f}`),
    ...values(data, (i) => data.cards[i].keywords).map((k) => `kw:${quote(k)}`),
    ...values(data, (i) => printsOf(i).map((p) => p.setType), 1).map((v) => `st:${v}`),
    ...values(data, (i) => printsOf(i).flatMap((p) => [...p.games]), 1).map((v) => `game:${v}`),
    ...values(data, (i) => printsOf(i).map((p) => p.rarity), 1).map((v) => `r:${v}`),
    ...values(data, (i) => printsOf(i).map((p) => p.border), 1).map((v) => `border:${v}`),
    ...values(data, (i) => printsOf(i).flatMap((p) => [p.frame, ...p.frameEffects]), 1).map((v) => `frame:${v}`),
    ...values(data, (i) => printsOf(i).map((p) => p.stamp), 1).map((v) => `stamp:${v}`),
    ...values(data, (i) => printsOf(i).flatMap((p) => [...p.watermarks])).map((v) => `wm:${quote(v)}`),
    ...[...data.tags].filter(([, cards]) => cards.size >= MIN_CARDS).sort((a, b) => b[1].size - a[1].size).slice(0, TAGS).map(([t]) => `otag:${t}`),
    // the art tags, by how many pictures they have (those with the most cards would all be in the thousands)
    ...[...data.artTags].filter(([t, arts]) => arts.size >= MIN_CARDS && /^[a-z0-9-]+$/.test(t)).sort((a, b) => b[1].size - a[1].size).slice(0, TAGS).map(([t]) => `atag:${t}`),
    // every language, as lang: and in:, and the keys about printings in them
    ...(data.languages ? values(data, (i) => [...data.cards[i].printings, ...data.languages!.byCard.get(i) ?? []].map((p) => data.prints[p].lang), 1).flatMap((l) => [`lang:${l}`, `in:${l}`]) : []),
    ...(data.languages ? ["lang:any", "-lang:en", "new:language", "lang:any new:language"] : []),
    ...["art", "artist", "flavor", "frame", "rarity"].map((v) => `new:${v}`),
    "artists>1", "illustrations>1", "illustrations>=5",
    ...["arena", "grixis", "legacy", "chuck", "twisted", "april", "protour", "uncommon", "modern", "amaz", "tinkerer", "livethedream", "chromatic", "vintage", "apcube"].map((c) => `cube:${c}`),
    // set families: the biggest ones
    ...values(data, (i) => printsOf(i).map((p) => data.parents.get(p.set) ?? ""), 300).slice(0, 15).map((g) => `g:${g}`),
].filter((k) => k.includes(ONLY));

// a key split by mana value, and a big slice by color, so each part is small enough to fetch whole
const MV = ["mv=0", "mv=1", "mv=2", "mv=3", "mv=4", "mv=5", "mv=6", "mv>=7"];
const COLOR = ["c=c", "c=w", "c=u", "c=b", "c=r", "c=g", "c:m"];

type Part = { q: string, local: number, scryfall: number, onlyHere: string[], onlyThere: string[], listed: boolean, error?: string, warnings?: string[] };
type Row = { key: string, local?: number, scryfall: number, error?: string, warnings?: string[], why?: string, parts: Part[] };

const localCards = (q: string) => search(parse(q), data);

// one search, here and on Scryfall; the cards on each side too when Scryfall's answer fits in `pages` pages
async function compare(q: string, pages: number): Promise<Part> {
    const here = localCards(q);
    const theirs = await answers.ask(q, pages, REFRESH);
    const part: Part = { q, local: here.length, scryfall: theirs.total, onlyHere: [], onlyThere: [], listed: !!theirs.cards, error: theirs.error, warnings: theirs.warnings };
    if (theirs.cards) {
        const there = new Set(theirs.cards.map(([id]) => id));
        const ids = new Set(here.map((i) => data.cards[i].oracleId));
        part.onlyHere = here.filter((i) => !there.has(data.cards[i].oracleId)).map((i) => data.cards[i].name);
        part.onlyThere = theirs.cards.filter(([id]) => !ids.has(id)).map(([, name]) => name);
    }
    return part;
}
const differs = (p: Part) => p.local !== p.scryfall || p.onlyHere.length > 0 || p.onlyThere.length > 0;

// where a key's count differs, the slices whose count differs, fetched whole where they fit
async function narrow(key: string): Promise<Part[]> {
    const out: Part[] = [];
    for (const mv of MV) {
        const q = `${key} ${mv}`;
        const slice = await compare(q, 0);
        if (!differs(slice)) continue;
        if (slice.scryfall <= PAGES * PAGE) { out.push(await compare(q, PAGES)); continue; }
        for (const c of COLOR) {
            const sub = await compare(`${q} ${c}`, 0);
            if (differs(sub)) out.push(sub.scryfall <= PAGES * PAGE ? await compare(`${q} ${c}`, PAGES) : sub);
        }
    }
    return out;
}

const rows: Row[] = [];
for (const [n, key] of keys.entries()) {
    say(`${n + 1}/${keys.length} ${key}`);
    const row: Row = { key, scryfall: 0, parts: [] };
    try {
        const whole = await compare(key, 0);
        row.local = whole.local;
        row.scryfall = whole.scryfall;
        row.error = whole.error;
        row.warnings = whole.warnings;
        if (!row.error && differs(whole)) row.parts = whole.scryfall <= PAGES * PAGE ? [await compare(key, PAGES)] : await narrow(key);
    } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.why = e.message;
    }
    rows.push(row);
}
if (live) process.stdout.write("\r\x1b[2K");

const exact = rows.filter((r) => r.local !== undefined && !r.error && r.local === r.scryfall && !r.parts.some(differs));
const differ = rows.filter((r) => r.local !== undefined && !r.error && !exact.includes(r))
    .sort((a, b) => Math.abs(b.local! - b.scryfall) - Math.abs(a.local! - a.scryfall));
const errors = rows.filter((r) => r.error);
const unsupported = rows.filter((r) => r.why !== undefined);
const names = (list: string[]) => list.slice(0, 8).join(", ") + (list.length > 8 ? ` +${list.length - 8} more` : "");
// agreement = 1 - |here - Scryfall| / Scryfall: a key off by a few cards of thousands is most likely data timing
// (Scryfall's live data against the bulk file), so keys under AGREE are the ones worth a look
const AGREE = 0.999;
const agreement = (r: Row) => r.scryfall ? 1 - Math.abs(r.local! - r.scryfall) / r.scryfall : (r.local === 0 ? 1 : 0);
const close = differ.filter((r) => agreement(r) >= AGREE), far = differ.filter((r) => agreement(r) < AGREE);
const headline = `${rows.length} keys: ${exact.length} exact, ${differ.length} differ, ${errors.length} Scryfall errors, ${unsupported.length} not supported here; ${exact.length + close.length} agree at least ${AGREE * 100}%`;

const lines = [
    `# Keys against Scryfall`, ``, `${new Date().toISOString()} · ${headline}`, ``,
    `Each key searched alone; where the counts differ, the slices (by mana value, then color) whose counts differ.`, ``,
    `## Under ${AGREE * 100}% agreement (${far.length})`, ``,
    ...(far.length ? far.map((r) => `- \`${r.key}\`: ${(agreement(r) * 100).toFixed(2)}% (here ${r.local}, Scryfall ${r.scryfall})`) : ["none"]), ``,
    `## Differ`, ``,
    ...(differ.length ? differ.flatMap((r) => [
        `- \`${r.key}\`: here ${r.local}, Scryfall ${r.scryfall}`,
        ...r.parts.filter(differs).flatMap((p) => [
            ...(p.q !== r.key ? [`  - \`${p.q}\`: here ${p.local}, Scryfall ${p.scryfall}${p.listed ? "" : " (too many to list)"}`] : []),
            ...(p.onlyHere.length ? [`    only here: ${names(p.onlyHere)}`] : []),
            ...(p.onlyThere.length ? [`    only Scryfall: ${names(p.onlyThere)}`] : []),
        ]),
    ]) : ["None."]), ``,
    ...(errors.length ? [`## Scryfall errors`, ``, ...errors.map((r) => `- \`${r.key}\`: ${r.error}`), ``] : []),
    ...(unsupported.length ? [`## Not supported here`, ``, ...unsupported.map((r) => `- \`${r.key}\`: ${r.why}`), ``] : []),
    `## Exact`, ``, exact.map((r) => `\`${r.key}\` (${r.scryfall})`).join(" · "), ``,
];
writeFileSync(join(OUT, "keys-summary.md"), lines.join("\n"));
console.log(headline);
console.log(`Summary: ${join(OUT, "keys-summary.md")}`);
process.exitCode = differ.length ? 1 : 0;
