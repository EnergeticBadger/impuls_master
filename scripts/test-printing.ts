// Checks which printing the local search (scripts/local-search.ts) shows each card with, and the order it lists
// them in, against Scryfall: npm run test-printing
// The searches are scripts/printing-cases.txt: searches that pick printings (a set, a frame, a finish, promos,
// prices, artists…) and a sample of the other cases. Each runs as it is (a card each, by name), and again with
// options picked for it from its own text, so the same line always gets the same ones: an order: and direction
// (asc, desc or auto), sometimes unique:prints or unique:art, sometimes a prefer:. order, dir and unique go as the
// API's parameters, as the app sends them; prefer: in the search, as Scryfall's syntax guide writes it.
// A line with a tab after the search gives its own options instead (`t:sliver<TAB>order=set&dir=desc`).
// Scryfall's answers are kept in <out>/scryfall-printing.json (a week, or until --refresh), so a run after the
// first is offline. Each entry of Scryfall's list is compared with ours at the same position: the same printing
// (Scryfall's id) is exact. <out>/printing-summary.md lists what differs, first difference of each search first.
//   --out <dir>   default fuzz-results      --refresh   ask Scryfall again      --only <text>   lines containing it
//   --pages <n>   compare searches whose whole answer fits in n pages (175 entries each), default 4

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Answers, PAGE } from "./scryfall-answers.ts";
import { Unsupported, bulkFile, loadCards, parse, results, setsFile, type View } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const ONLY = option("only", "");
const REFRESH = args.includes("--refresh");
const PAGES = Number(option("pages", "4"));

// the options a line can get
const ORDERS = ["name", "set", "released", "rarity", "color", "usd", "tix", "eur", "cmc", "power", "toughness", "edhrec", "penny", "artist"];
const DIRS = ["auto", "asc", "desc"];
const PREFERS = ["oldest", "newest", "usd-low", "usd-high", "eur-low", "eur-high", "tix-low", "tix-high", "promo", "default", "atypical", "ub", "notub"];

// a seeded generator (mulberry32) seeded by the line's text, so a line's options don't change when others are added
function rng(text: string) {
    let a = [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Case = { q: string, options: Record<string, string> };
const lines = [...new Set(readFileSync(new URL("./printing-cases.txt", import.meta.url), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))];
const cases: Case[] = lines.flatMap((line): Case[] => {
    const [q, own] = line.split("\t");
    if (own !== undefined) return [{ q, options: Object.fromEntries(new URLSearchParams(own)) }];
    const random = rng(q), pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
    const options: Record<string, string> = { order: pick(ORDERS), dir: pick(DIRS) };
    const u = random();
    if (u < 0.2) options.unique = "prints";
    else if (u < 0.35) options.unique = "art";
    const prefer = random() < 0.25 ? ` prefer:${pick(PREFERS)}` : "";
    return [{ q, options: {} }, { q: q + prefer, options }];
}).filter((c) => `${c.q} ${new URLSearchParams(c.options)}`.includes(ONLY));

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);
const answers = new Answers(join(OUT, "scryfall-printing.json"), say);
const missing = cases.filter((c) => REFRESH || !answers.known(c.q, PAGES, c.options));
for (const [n, c] of missing.entries()) {
    say(`asking Scryfall ${n + 1}/${missing.length}: ${c.q} ${new URLSearchParams(c.options)}`);
    await answers.ask(c.q, PAGES, REFRESH, c.options);
}
if (missing.length) say(`asked Scryfall ${missing.length} searches\n`);

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined),
    await setsFile(join(OUT, "bulk")).catch(() => undefined), await bulkFile("oracle_cards", join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
const byId = new Map(data.prints.map((p, i) => [p.id, i]));
const describe = (i: number | undefined) => i === undefined ? "nothing" : `${data.cards[data.prints[i].card].name} (${data.prints[i].set}/${data.prints[i].cn})`;

// `kind`: where the first difference is: another printing of the same card, another card, or not the same cards
type Row = { label: string, entries: number, exact: number, sameCard: number, kind?: "printing" | "order" | "cards", first?: string, why?: string, error?: string };
const rows: Row[] = [];
for (const c of cases) {
    const label = `${c.q}${Object.keys(c.options).length ? `  [${new URLSearchParams(c.options)}]` : ""}`;
    const theirs = (await answers.ask(c.q, PAGES, false, c.options))!;
    const row: Row = { label, entries: theirs.total, exact: 0, sameCard: 0, error: theirs.error };
    rows.push(row);
    if (theirs.error || !theirs.cards) { row.why ??= theirs.error ? undefined : `${theirs.total} entries: more than ${PAGES} pages`; continue; }
    try {
        const ours = results(parse(c.q), data, c.options as View);
        const there = theirs.cards;
        for (const [i, [oracle, , id]] of there.entries()) {
            const p = ours[i];
            if (p !== undefined && data.cards[data.prints[p].card].oracleId === oracle) row.sameCard++;
            if (p !== undefined && data.prints[p].id === id) row.exact++;
            else if (!row.first) {
                const theirsAt = byId.get(id!);
                row.first = `#${i + 1}: Scryfall ${theirsAt === undefined ? `${there[i][1]} (${there[i][3]}/${there[i][4]}, not in the bulk file)` : describe(theirsAt)}, here ${describe(p)}`;
            }
        }
        if (ours.length !== there.length && !row.first) row.first = `Scryfall lists ${there.length}, here ${ours.length}: first extra here ${describe(ours[there.length])}`;
        if (row.first) {
            const sameSet = new Set(there.map(([o]) => o)).size === new Set(ours.map((p) => data.cards[data.prints[p].card].oracleId)).size
                && ours.every((p) => there.some(([o]) => o === data.cards[data.prints[p].card].oracleId));
            row.kind = !sameSet || ours.length !== there.length ? "cards" : row.sameCard === there.length ? "printing" : "order";
        }
    } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.why = e.message;
    }
}

const compared = rows.filter((r) => !r.error && !r.why);
const entries = compared.reduce((n, r) => n + r.entries, 0), exact = compared.reduce((n, r) => n + r.exact, 0);
const sameCard = compared.reduce((n, r) => n + r.sameCard, 0);
const whole = compared.filter((r) => !r.first);
const pct = (a: number, b: number) => `${(100 * a / (b || 1)).toFixed(2)}%`;
const differ = (kind: Row["kind"]) => compared.filter((r) => r.kind === kind).sort((a, b) => (a.exact / a.entries) - (b.exact / b.entries));
// what this test is for: the searches that find the same cards here and on Scryfall (which cards match is
// test-syntax's business), and how many of their entries have the same printing in the same place
const same = compared.filter((r) => r.kind !== "cards");
const sameEntries = same.reduce((n, r) => n + r.entries, 0), sameExact = same.reduce((n, r) => n + r.exact, 0);
const headline = `${same.length} searches find the same cards: ${sameExact.toLocaleString()} of ${sameEntries.toLocaleString()} entries (${pct(sameExact, sameEntries)}) the same printing in the same place, ${same.filter((r) => !r.first).length} searches exact`
    + `. All ${compared.length} searches compared: ${exact.toLocaleString()} of ${entries.toLocaleString()} (${pct(exact, entries)}), ${pct(sameCard, entries)} the same card`;
const section = (title: string, list: Row[]) => [`## ${title} (${list.length})`, ``, ...(list.length ? list.map((r) => `- \`${r.label}\`: ${r.exact}/${r.entries} exact; ${r.first}`) : ["None."]), ``];
const lines2 = [
    `# Printings and order against Scryfall`, ``, `${new Date().toISOString()} · ${headline}`, ``,
    ...section("Not the same cards (see test-syntax)", differ("cards")),
    ...section("Same cards, another order", differ("order")),
    ...section("Same cards in the same order, another printing", differ("printing")),
    `## Not compared`, ``, ...rows.filter((r) => r.error || r.why).map((r) => `- \`${r.label}\`: ${r.error ?? r.why}`), ``,
    `## Exact`, ``, whole.map((r) => `\`${r.label}\` (${r.entries})`).join(" · "), ``,
];
writeFileSync(join(OUT, "printing-summary.md"), lines2.join("\n"));
console.log(headline);
console.log(`Summary: ${join(OUT, "printing-summary.md")}`);
process.exitCode = sameExact === sameEntries ? 0 : 1;
