// Random searches, wide: npm run fuzz-search -- [options]
// Like fuzz-syntax, but the terms' values come from the bulk files (any type, set, artist, keyword, tag, number…,
// with any operator), and about half the searches are shown another way (an order and direction, unique:prints
// or unique:art, a prefer:), as the app asks. Each search is compared with Scryfall's answer: the count, and the
// first page entry by entry (the same printing in the same place); where the counts differ and the answer is
// short, every card.
// The searches are made once from the seed (the same seed, the same searches) and given a risk: how likely they
// are to differ, from the kinds of term in them (prices, new:, tags, a minus on a printing key, unique:art…).
// The riskiest (--risky, default 3,000) are one group, the rest another in a fixed shuffled order, so a run can
// take the risky ones first, fix what they show, run them again offline, then sample the rest:
//   --group risky|safe|all   which group (default risky)      --range a:b   only the group's searches a to b-1
//   --count <n>   how many searches in all (default 10000)   --seed <n>   (default 1)   --risky <n>
//   --offline     only searches already asked (no Scryfall)    --refresh   ask Scryfall again
//   --only <text> searches containing it                      --out <dir>  default fuzz-results/search
//   --recheck     ask Scryfall again for each search that differs (after downloading new bulk files)
// Answers are appended to <out>/answers.jsonl as they come (a stopped run picks up where it left off), with
// prices: a search that goes by prices whose answer lists a printing at another price than the bulk file's is
// counted apart ("prices moved"), as are differences that are only cards newer than the bulk file. Download the
// bulk files the same day as asking (prices change about 09:00 UTC). <out>/summary-<group>.md lists what
// differs, the riskiest kinds of term first.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGE, politeFetch, pricesMatch } from "./scryfall-answers.ts";
import { Unsupported, bulkFile, isValues, loadCards, parse, results, setsFile, type View } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results/search"));
const COUNT = Number(option("count", "10000"));
const SEED = Number(option("seed", "1"));
const RISKY = Number(option("risky", "3000"));
const GROUP = option("group", "risky");
const RANGE = option("range", "");
const ONLY = option("only", "");
const OFFLINE = args.includes("--offline");
const REFRESH = args.includes("--refresh");
const RECHECK = args.includes("--recheck");
// a short answer is listed in full (to name the cards that differ); a longer one only its first page
const PAGES = 4;

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line.slice(0, (process.stdout.columns || 120) - 1)}`) : console.log(line);

const started = Date.now();
const bulk = join(OUT, "bulk");
const data = await loadCards(await bulkFile("default_cards", bulk), await bulkFile("oracle_tags", bulk).catch(() => undefined),
    await setsFile(bulk).catch(() => undefined), await bulkFile("oracle_cards", bulk).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// ---- what the terms are made of, from the bulk files ----

const shown = data.prints.filter((p) => p.lang === "en" && !p.extra);
const count = <T>(items: Iterable<T>) => {
    const n = new Map<T, number>();
    for (const x of items) n.set(x, (n.get(x) ?? 0) + 1);
    return n;
};
// values with at least `min` cards or printings, so a term usually finds something
const common = <T>(items: Iterable<T>, min: number) => [...count(items)].filter(([v, n]) => v !== "" && v !== undefined && n >= min).map(([v]) => v).sort();
const words = (text: string) => text.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !w.includes("'"));
const VALUES = {
    types: common(data.cards.flatMap((c) => c.faceTypes.flatMap((t) => t.split(/[\s—]+/))).filter((w) => /^[a-z-]+$/.test(w)), 5),
    keywords: common(data.cards.flatMap((c) => [...c.keywords].map((k) => k.toLowerCase())), 3),
    sets: common(shown.map((p) => p.set), 10),
    setTypes: common(shown.map((p) => p.setType), 10),
    blocks: [...new Set(data.blocks.values())].sort(),
    artists: common(shown.map((p) => p.artist), 5),
    watermarks: common(shown.flatMap((p) => [...p.watermarks]), 5),
    frames: [...common(shown.map((p) => p.frame), 5), ...common(shown.flatMap((p) => [...p.frameEffects]), 5)],
    borders: common(shown.map((p) => p.border), 5),
    stamps: common(shown.map((p) => p.stamp), 5),
    formats: common(data.cards.flatMap((c) => [...c.legal, ...c.banned]), 1),
    is: isValues(data),
    tags: common([...data.tags.keys()].filter((t) => /^[a-z0-9-]+$/.test(t) && data.tags.get(t)!.size >= 3), 1),
    text: common(data.cards.flatMap((c) => words(c.text.join(" "))), 30),
    flavor: common(shown.flatMap((p) => words(p.flavor.join(" "))), 30),
    names: common(data.cards.flatMap((c) => words(c.name)), 4),
    langs: data.languages ? common(data.prints.map((p) => p.lang), 20) : ["en"],
};
const COLORS = ["w", "u", "b", "r", "g"];
const NAMED_COLORS = ["azorius", "dimir", "rakdos", "gruul", "selesnya", "orzhov", "izzet", "golgari", "boros", "simic", "esper", "grixis", "jund",
    "naya", "bant", "abzan", "jeskai", "sultai", "mardu", "temur", "colorless", "multicolor", "white", "blue", "black", "red", "green"];

// ---- making searches ----

function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const random = rng(SEED);
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const op = () => pick([":", "=", ">=", "<=", ">", "<", "!="]);
const quote = (s: string) => /[\s:]/.test(s) ? `"${s}"` : s;
const colors = () => {
    const set = COLORS.filter(() => random() < 0.35);
    return set.length ? set.join("") : pick(COLORS);
};

// a kind of term: its name (for the summary), how likely it is to differ from Scryfall (a guess, from what's
// differed before), whether it looks at printings (a minus on those is where hidden printings show), and a term
type Kind = { kind: string, risk: number, printing?: boolean, make: () => string };
const KINDS: Kind[] = [
    { kind: "type", risk: 0.03, make: () => `t:${pick(VALUES.types)}` },
    { kind: "color", risk: 0.05, make: () => `${pick(["c", "id"])}${pick([":", "=", ">=", "<=", "!="])}${random() < 0.3 ? pick(NAMED_COLORS) : colors()}` },
    { kind: "color count", risk: 0.08, make: () => `${pick(["c", "id"])}${pick(["=", ">=", "<=", ">", "<"])}${int(0, 5)}` },
    { kind: "mana value", risk: 0.04, make: () => random() < 0.15 ? `mv:${pick(["odd", "even"])}` : `mv${op()}${int(0, 12)}` },
    { kind: "power/toughness", risk: 0.08, make: () => random() < 0.2 ? `${pick(["pow>tou", "tou>pow", "pow=tou", "pt>=10"])}` : `${pick(["pow", "tou"])}${op()}${int(-1, 13)}` },
    { kind: "loyalty", risk: 0.08, make: () => `loy${op()}${int(1, 8)}` },
    { kind: "mana cost", risk: 0.15, make: () => `m${pick([":", ">=", "="])}${random() < 0.3 ? "{X}" : `${random() < 0.5 ? int(1, 4) : ""}${pick(COLORS).toUpperCase().repeat(int(1, 3))}`}` },
    { kind: "devotion", risk: 0.3, make: () => `devotion${pick([":", ">="])}${pick(COLORS).repeat(int(1, 3))}` },
    { kind: "produces", risk: 0.15, make: () => `produces${pick([":", "="])}${random() < 0.2 ? "c" : colors()}` },
    { kind: "rarity", risk: 0.05, printing: true, make: () => `r${op()}${pick(["common", "uncommon", "rare", "mythic", "special"])}` },
    { kind: "format", risk: 0.1, make: () => `${pick(["f", "f", "banned", "legal"])}:${pick(VALUES.formats)}` },
    { kind: "keyword", risk: 0.08, make: () => `kw:${quote(pick(VALUES.keywords))}` },
    { kind: "is", risk: 0.25, make: () => `${pick(["is", "is", "not"])}:${pick(VALUES.is)}` },
    { kind: "rules text", risk: 0.06, make: () => `${pick(["o", "o", "fo"])}:${random() < 0.3 ? `"${pick(VALUES.text)} ${pick(VALUES.text)}"` : pick(VALUES.text)}` },
    { kind: "rules regex", risk: 0.15, make: () => `o:/\\b${pick(VALUES.text)}${pick(["", "s?", "\\b", "[^.]*"])}/` },
    { kind: "name", risk: 0.05, make: () => random() < 0.3 ? `name:/^${pick(VALUES.names).slice(0, 3)}/` : random() < 0.5 ? `name:${pick(VALUES.names)}` : pick(VALUES.names) },
    { kind: "set", risk: 0.15, printing: true, make: () => `${pick(["s", "e", "in"])}:${pick(VALUES.sets)}` },
    { kind: "set type", risk: 0.2, printing: true, make: () => `st:${pick(VALUES.setTypes)}` },
    { kind: "block", risk: 0.15, printing: true, make: () => `b:${pick(VALUES.blocks)}` },
    { kind: "date", risk: 0.1, printing: true, make: () => random() < 0.6 ? `year${op()}${int(1993, 2026)}` : `date${pick([">=", "<", ">"])}${random() < 0.5 ? pick(VALUES.sets) : `${int(1994, 2026)}-${String(int(1, 12)).padStart(2, "0")}-01`}` },
    { kind: "game", risk: 0.2, printing: true, make: () => `game:${pick(["paper", "arena", "mtgo"])}` },
    { kind: "artist", risk: 0.15, printing: true, make: () => { const a = pick(VALUES.artists); return random() < 0.5 ? `a:${quote(a.toLowerCase())}` : `a:${a.split(" ").pop()!.toLowerCase()}`; } },
    { kind: "flavor", risk: 0.1, printing: true, make: () => `ft:${pick(VALUES.flavor)}` },
    { kind: "watermark", risk: 0.2, printing: true, make: () => random() < 0.15 ? "has:watermark" : `wm:${pick(VALUES.watermarks)}` },
    { kind: "frame/border/stamp", risk: 0.2, printing: true, make: () => pick([() => `frame:${pick(VALUES.frames)}`, () => `border:${pick(VALUES.borders)}`, () => `stamp:${pick(VALUES.stamps)}`])() },
    { kind: "collector number", risk: 0.25, printing: true, make: () => `cn${op()}${int(1, 400)}` },
    { kind: "price", risk: 0.5, printing: true, make: () => random() < 0.2 ? `cheapest:${pick(["usd", "eur", "tix"])}` : `${pick(["usd", "eur", "tix"])}${pick([">=", "<", ">", "<="])}${pick([0.1, 0.5, 1, 2, 5, 10, 20, 50])}` },
    { kind: "print count", risk: 0.25, make: () => `${pick(["prints", "sets", "papersets", "paperprints"])}${op()}${int(1, 40)}` },
    { kind: "rank", risk: 0.3, make: () => `${pick(["edhrec"])}${pick(["<=", ">", "<"])}${pick([100, 500, 1000, 5000, 10000, 20000])}` },
    { kind: "language", risk: 0.4, printing: true, make: () => `${pick(["lang", "in"])}:${pick(VALUES.langs)}` },
    { kind: "new", risk: 0.4, printing: true, make: () => `new:${pick(["art", "artist", "frame", "flavor", "rarity", "language"])}` },
    { kind: "tag", risk: 0.3, make: () => `otag:${pick(VALUES.tags)}` },
    { kind: "extras", risk: 0.4, printing: true, make: () => "include:extras" },
];

// how a search is shown, as the API's parameters (order, dir, unique) or prefer: in the search, and how risky
const ORDER_RISK: Record<string, number> = { name: 0, cmc: 0.03, power: 0.05, toughness: 0.05, color: 0.05, rarity: 0.05, edhrec: 0.1, penny: 0.1,
    set: 0.15, released: 0.15, artist: 0.15, usd: 0.4, eur: 0.4, tix: 0.4 };
const PREFERS = ["oldest", "newest", "usd-low", "usd-high", "eur-low", "eur-high", "tix-low", "tix-high", "promo", "default", "atypical", "ub", "notub"];

type Search = { q: string, options: Record<string, string>, kinds: string[], risk: number };
function makeSearch(): Search {
    const kinds = [...KINDS].sort(() => random() - 0.5).slice(0, 1 + int(1, 3));
    let risk = 1;
    const terms = kinds.map((k) => {
        const negated = random() < 0.15;
        risk *= 1 - Math.min(0.9, negated && k.printing ? k.risk * 1.5 + 0.1 : k.risk);
        const term = k.make();
        return negated && !term.startsWith("-") && !term.startsWith("include:") ? `-${term}` : term;
    });
    const names = kinds.map((k) => k.kind);
    let q: string;
    const shape = random();
    if (shape < 0.15 && terms.length >= 2) q = `${terms[0]} or ${terms.slice(1).join(" ")}`;
    else if (shape < 0.3 && terms.length >= 3) q = `(${terms[0]} or ${terms[1]}) ${terms.slice(2).join(" ")}`;
    else if (shape < 0.4 && terms.length >= 3) { q = `-(${terms[0]} or ${terms[1]}) ${terms.slice(2).join(" ")}`; risk *= 0.9; }
    else q = terms.join(" ");
    const options: Record<string, string> = {};
    if (random() < 0.5) {
        options.order = pick(Object.keys(ORDER_RISK));
        options.dir = pick(["auto", "asc", "desc"]);
        risk *= 1 - ORDER_RISK[options.order];
        const u = random();
        if (u < 0.2) { options.unique = "prints"; risk *= 0.75; names.push("unique:prints"); }
        else if (u < 0.35) { options.unique = "art"; risk *= 0.65; names.push("unique:art"); }
        if (random() < 0.2) {
            const p = pick(PREFERS);
            q += ` prefer:${p}`;
            risk *= /usd|eur|tix/.test(p) ? 0.5 : 0.7;
            names.push(`prefer:${p}`);
        }
        names.push(`order:${options.order}`);
    }
    return { q, options, kinds: names, risk: 1 - risk };
}

const all: Search[] = [];
const seen = new Set<string>();
for (let tries = 0; all.length < COUNT && tries < COUNT * 5; tries++) {
    const s = makeSearch();
    const key = `${s.q}\u0000${new URLSearchParams(s.options)}`;
    if (!seen.has(key)) { seen.add(key); all.push(s); }
}
// the riskiest first; the rest in a fixed shuffled order, so any part of it is a fair sample
const byRisk = all.map((s, i) => ({ s, i })).sort((a, b) => b.s.risk - a.s.risk || a.i - b.i).map(({ s }) => s);
const risky = byRisk.slice(0, RISKY);
const shuffle = rng(SEED + 1);
const safe = byRisk.slice(RISKY).map((s) => ({ s, r: shuffle() })).sort((a, b) => a.r - b.r).map(({ s }) => s);
let group = GROUP === "safe" ? safe : GROUP === "all" ? [...risky, ...safe] : risky;
if (RANGE) { const [a, b] = RANGE.split(":").map(Number); group = group.slice(a || 0, b || undefined); }
group = group.filter((s) => `${s.q} ${new URLSearchParams(s.options)}`.includes(ONLY));
console.log(`${all.length.toLocaleString()} searches (seed ${SEED}): ${risky.length} risky (risk ${(risky.at(-1)?.risk ?? 0).toFixed(2)} and up), ${safe.length} safe; running ${group.length} of ${GROUP}${RANGE ? ` ${RANGE}` : ""}`);

// ---- Scryfall's answers, kept a line each ----

// an entry of an answer: oracle id, name, printing id, set, collector number, prices (see Answers in scryfall-answers.ts)
type Entry = [string, string, string, string, string, string];
type Answer = { at: number, total: number, entries: Entry[], complete: boolean, error?: string };
mkdirSync(OUT, { recursive: true });
const ANSWERS = join(OUT, "answers.jsonl");
const known = new Map<string, Answer>();
if (existsSync(ANSWERS)) for (const line of readFileSync(ANSWERS, "utf8").split("\n")) {
    if (!line) continue;
    const { key, ...a } = JSON.parse(line);
    known.set(key, a);
}
const keyOf = (s: Search) => `${s.q}\u0000${new URLSearchParams(s.options)}`;
async function ask(s: Search, pages: number): Promise<Answer> {
    const entries: Entry[] = [];
    let url: string | undefined = `https://api.scryfall.com/cards/search?${new URLSearchParams({ ...s.options, q: s.q })}`;
    let total = 0;
    for (let page = 0; url && page < pages; page++) {
        const res = await politeFetch(url, { say });
        const body: any = await res.json().catch(() => ({ details: `HTTP ${res.status}` }));
        if (res.status === 404) return { at: Date.now(), total: 0, entries: [], complete: true };
        if (!body.data) return { at: Date.now(), total: 0, entries: [], complete: true, error: body.details ?? `HTTP ${res.status}` };
        total = body.total_cards;
        for (const c of body.data) entries.push([c.oracle_id ?? c.card_faces?.[0]?.oracle_id, c.name, c.id, c.set, c.collector_number,
            ["usd", "usd_foil", "usd_etched", "eur", "eur_foil", "tix"].map((k) => c.prices?.[k] ?? "").join("|")]);
        url = body.has_more ? body.next_page : undefined;
    }
    return { at: Date.now(), total, entries, complete: !url };
}
async function answer(s: Search, pages: number, refresh = REFRESH): Promise<Answer | undefined> {
    const key = keyOf(s);
    const have = known.get(key);
    if (have && !refresh && (have.complete || have.entries.length >= Math.min(have.total, pages * PAGE))) return have;
    if (OFFLINE) return have;
    const a = await ask(s, pages);
    known.set(key, a);
    appendFileSync(ANSWERS, JSON.stringify({ key, ...a }) + "\n");
    return a;
}

// ---- comparing ----

const oracleIds = new Set(data.cards.map((c) => c.oracleId));
const byId = new Map(data.prints.map((p, i) => [p.id, i]));
const describe = (i: number | undefined) => i === undefined ? "nothing" : `${data.cards[data.prints[i].card].name} (${data.prints[i].set}/${data.prints[i].cn})`;
const byPrice = (s: Search) => /^(usd|eur|tix)$/.test(s.options.order ?? "") || /\b(usd|eur|tix|cheapest)\b/.test(s.q);

// exact: the same count and the same first page, printing by printing; printing: the same cards there, another
// printing; order: the same count, the first page in another order; cards: another count or other cards;
// newer: only cards newer than the bulk file differ; moved: by prices, and they moved since the bulk file
type Outcome = "exact" | "printing" | "order" | "cards" | "newer" | "moved" | "unsupported" | "error" | "not asked";
// `listed`/`same`: of a search with the same count, the first page's entries, and those the same printing in the same place
type Row = Search & { outcome: Outcome, here?: number, there?: number, note?: string, listed?: number, same?: number };
// how one search compares; `refresh` asks Scryfall again
async function judge(s: Search, refresh: boolean): Promise<Row> {
    const row: Row = { ...s, outcome: "not asked" };
    let ours: number[];
    try { ours = results(parse(s.q), data, s.options as View); } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.outcome = "unsupported";
        row.note = e.message;
        return row;
    }
    row.here = ours.length;
    let theirs = await answer(s, 1, refresh);
    if (!theirs) return row;
    if (theirs.error) { row.outcome = "error"; row.note = theirs.error; return row; }
    row.there = theirs.total;
    if (theirs.total !== ours.length && theirs.total <= PAGES * PAGE && !theirs.complete) theirs = (await answer(s, PAGES, false)) ?? theirs;
    const page = theirs.entries;
    const moved = byPrice(s) && page.find(([, , id, , , prices]) => byId.has(id) && !pricesMatch(data.prints[byId.get(id)!], prices));
    const oursOracle = (i: number) => data.cards[data.prints[i].card].oracleId;
    if (theirs.total !== ours.length) {
        // which cards differ, where the whole answer is here
        if (theirs.complete) {
            const there = new Set(page.map(([o]) => o)), here = new Set(ours.map(oursOracle));
            const onlyThere = [...there].filter((o) => !here.has(o)), onlyHere = [...here].filter((o) => !there.has(o));
            const name = (o: string) => page.find(([x]) => x === o)?.[1] ?? data.cards.find((c) => c.oracleId === o)?.name;
            row.note = [onlyHere.length ? `only here: ${onlyHere.slice(0, 6).map(name).join(", ")}${onlyHere.length > 6 ? ` +${onlyHere.length - 6}` : ""}` : "",
                onlyThere.length ? `only Scryfall: ${onlyThere.slice(0, 6).map(name).join(", ")}${onlyThere.length > 6 ? ` +${onlyThere.length - 6}` : ""}` : ""].filter(Boolean).join("; ");
            if (!onlyHere.length && onlyThere.length && onlyThere.every((o) => !oracleIds.has(o))) { row.outcome = "newer"; return row; }
        }
        row.outcome = moved ? "moved" : "cards";
        return row;
    }
    row.listed = page.length;
    row.same = page.filter(([, , id], i) => ours[i] !== undefined && data.prints[ours[i]].id === id).length;
    const first = page.findIndex(([, , id], i) => ours[i] === undefined || data.prints[ours[i]].id !== id);
    if (first < 0) { row.outcome = "exact"; return row; }
    const there = byId.get(page[first][2]);
    row.note = `#${first + 1}: Scryfall ${there === undefined ? `${page[first][1]} (${page[first][3]}/${page[first][4]}, not in the bulk file)` : describe(there)}, here ${describe(ours[first])}`;
    if (page.some(([o]) => !oracleIds.has(o))) { row.outcome = "newer"; return row; }
    if (moved) { row.outcome = "moved"; return row; }
    row.outcome = page.every(([o], i) => ours[i] !== undefined && oursOracle(ours[i]) === o) ? "printing" : "order";
    return row;
}
const rows: Row[] = [];
for (const [n, s] of group.entries()) {
    say(`${n + 1}/${group.length} ${s.q} ${new URLSearchParams(s.options)}`);
    let row = await judge(s, REFRESH);
    // asked again now, a search that differed: was it the day between the bulk file and the answer?
    if (RECHECK && !OFFLINE && ["cards", "order", "printing", "moved", "newer"].includes(row.outcome)) row = await judge(s, true);
    rows.push(row);
}
if (live) process.stdout.write("\r\x1b[2K");

// ---- the summary ----

const counted = rows.filter((r) => ["exact", "printing", "order", "cards"].includes(r.outcome));
const tally = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
const pct = (a: number, b: number) => `${(100 * a / (b || 1)).toFixed(2)}%`;
const exact = tally("exact");
const listed = counted.reduce((n, r) => n + (r.listed ?? 0), 0), same = counted.reduce((n, r) => n + (r.same ?? 0), 0);
const headline = `${rows.length} searches (${GROUP}${RANGE ? ` ${RANGE}` : ""}, seed ${SEED}): ${exact} of ${counted.length} compared exact (${pct(exact, counted.length)}); `
    + `where the count matches, ${pct(same, listed)} of first-page entries the same printing in the same place; `
    + `${tally("cards")} other cards, ${tally("order")} another order, ${tally("printing")} another printing; `
    + `not counted: ${tally("newer")} newer cards, ${tally("moved")} prices moved, ${tally("unsupported")} unsupported here, ${tally("error")} Scryfall errors, ${tally("not asked")} not asked`;
// each kind of term: how often a search with it differs, to say where to look first
const kinds = [...new Set(counted.flatMap((r) => r.kinds.map((k) => k.replace(/^prefer:.*/, "prefer:"))))].map((k) => {
    const list = counted.filter((r) => r.kinds.some((x) => x.replace(/^prefer:.*/, "prefer:") === k));
    const bad = list.filter((r) => r.outcome !== "exact");
    return { k, n: list.length, bad: bad.length, cards: bad.filter((r) => r.outcome === "cards").length };
}).sort((a, b) => b.bad / b.n - a.bad / a.n);
const list = (o: Outcome, title: string) => {
    const these = rows.filter((r) => r.outcome === o);
    return these.length ? [`## ${title} (${these.length})`, ``, ...these.map((r) => `- \`${r.q}\`${Object.keys(r.options).length ? `  [${new URLSearchParams(r.options)}]` : ""}: here ${r.here ?? "-"}, Scryfall ${r.there ?? "-"}${r.note ? `; ${r.note}` : ""}`), ``] : [];
};
const lines = [
    `# Wide random searches against Scryfall`, ``, `${new Date().toISOString()} · ${headline}`, ``,
    `| Kind of term | Searches | Differ | Other cards | |`, `|---|---|---|---|---|`,
    ...kinds.map(({ k, n, bad, cards }) => `| ${k} | ${n} | ${bad} | ${cards} | ${pct(n - bad, n)} exact |`), ``,
    ...list("cards", "Other cards"), ...list("order", "Same count, another order"), ...list("printing", "Same cards, another printing"),
    ...list("newer", "Only cards newer than the bulk file"), ...list("moved", "Prices moved since the bulk file"),
    ...list("unsupported", "Not supported here"), ...list("error", "Scryfall errors"),
];
writeFileSync(join(OUT, `summary-${GROUP}${RANGE ? `-${RANGE.replace(":", "-")}` : ""}.md`), lines.join("\n"));
console.log(headline);
console.log(`Summary: ${join(OUT, `summary-${GROUP}${RANGE ? `-${RANGE.replace(":", "-")}` : ""}.md`)}`);
process.exitCode = counted.length === exact ? 0 : 1;
