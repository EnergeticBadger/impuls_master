// Checks the local search (scripts/local-search.ts) against Scryfall, search by search: npm run test-syntax
// The searches are scripts/syntax-cases.txt and scripts/panel-cases.txt (what the filter panel writes), or with
// --cases combo, scripts/combo-cases.txt ("What it does" with the other filters: npm run test-combos). Each is
// run on Scryfall once and remembered in <out>/scryfall-syntax.json, or scryfall-<names>.json (a week, or until
// --refresh), so a run after the first is offline and quick.
// Where Scryfall's whole answer fits in a few pages the two are compared card by card, and the cards only one
// side found are listed, which usually says exactly what's different.
//   --out <dir>   default fuzz-results      --refresh   ask Scryfall again      --only <text>   cases containing it
//   --cases <names>   which <name>-cases.txt files, default syntax,panel
//   --delay <ms>   wait after each Scryfall request, default 1200
//   --stop-on-429   stop when Scryfall asks to slow down, rather than wait and go on: for sharing Scryfall with
//                   another run (a long fuzz-rules). What was asked is kept, so running again carries on
// <out>/syntax-summary.md (or <names>-summary.md) starts with what differs; exit code 1 if anything does.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Answers, SlowDown } from "./scryfall-answers.ts";
import { Unsupported, bulkFile, listed, loadCards, parse, search, setsFile, sortCards } from "./local-search.ts";

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

// the hand-written cases, then the ones the filter panel writes (npm run panel-cases), unless --cases says
const SETS = option("cases", "syntax,panel").split(",");
// each set of cases has its own answers and summary, so two of these can run at once without losing answers
const NAME = SETS.join() === "syntax,panel" ? "syntax" : SETS.join("-");
const SUMMARY = `${NAME}-summary.md`;
const cases = [...new Set(SETS.flatMap((set) => readFileSync(new URL(`./${set}-cases.txt`, import.meta.url), "utf8").split("\n"))
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes(ONLY)))];

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);
const answers = new Answers(join(OUT, `scryfall-${NAME}.json`), say, { delay: Number(option("delay", "1200")), stopOnLimit: args.includes("--stop-on-429") });

// Scryfall's answers first, so the comparison below runs in one go
const missing = cases.filter((q) => REFRESH || !answers.known(q, PAGES));
for (const [n, q] of missing.entries()) {
    say(`asking Scryfall ${n + 1}/${missing.length}: ${q}`);
    try {
        await answers.ask(q, PAGES, REFRESH);
    } catch (e) {
        if (!(e instanceof SlowDown)) throw e;
        say(`Scryfall asked to slow down after ${n} of ${missing.length} searches; stopped. They're kept: run again later to carry on.\n`);
        process.exit(2);
    }
}
if (missing.length) say(`asked Scryfall ${missing.length} searches\n`);

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// `order` is where the two lists first part, when they hold the same cards: Scryfall's card and ours there
type Row = { q: string, local?: number, scryfall: number, onlyHere: string[], onlyThere: string[], newer?: number, why?: string, error?: string, warnings?: string[], order?: { at: number, theirs: string, ours: string } };
const rows: Row[] = [];
// every card in the bulk file: a card Scryfall lists that isn't is newer than the file (a preview added since it
// was built), so it's timing, not a difference in the search
const known = new Set(data.cards.map((c) => c.oracleId));
for (const q of cases) {
    const theirs = (await answers.ask(q, PAGES))!;
    const row: Row = { q, scryfall: theirs.total, onlyHere: [], onlyThere: [], error: theirs.error, warnings: theirs.warnings };
    try {
        const node = parse(q);
        const found = search(node, data);
        // a card each, or a printing or an art each for unique:prints and unique:art
        const entries = listed(node, data);
        row.local = entries.length;
        const byCard = entries.length === found.length;
        if (theirs.cards && !byCard) {
            // printings: the cards whose number of entries differs
            const count = (ids: string[]) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>());
            const here = count(entries), there = count(theirs.cards.map(([id]) => id));
            const name = new Map([...theirs.cards.map(([id, n]) => [id, n] as const), ...found.map((i) => [data.cards[i].oracleId, data.cards[i].name] as const)]);
            row.onlyHere = [...here].filter(([id, n]) => n > (there.get(id) ?? 0)).map(([id]) => name.get(id)!);
            row.onlyThere = [...there].filter(([id, n]) => n > (here.get(id) ?? 0)).map(([id]) => name.get(id)!);
        } else if (theirs.cards) {
            const there = new Set(theirs.cards.map(([id]) => id));
            const here = new Set(found.map((i) => data.cards[i].oracleId));
            row.onlyHere = found.filter((i) => !there.has(data.cards[i].oracleId)).map((i) => data.cards[i].name);
            row.onlyThere = theirs.cards.filter(([id]) => !here.has(id)).map(([, name]) => name);
            row.newer = theirs.cards.filter(([id]) => !known.has(id)).length;
            if (!row.onlyHere.length && !row.onlyThere.length) {
                const ours = sortCards(node, data, found);
                const at = theirs.cards.findIndex(([id], i) => data.cards[ours[i]].oracleId !== id);
                if (at >= 0) row.order = { at, theirs: theirs.cards[at][1], ours: data.cards[ours[at]].name };
            }
        }
    } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.why = e.message;
    }
    rows.push(row);
}

const exact = rows.filter((r) => !r.error && r.local !== undefined && r.local === r.scryfall && !r.onlyHere.length && !r.onlyThere.length);
// the same but for cards newer than the bulk file
const newerOnly = rows.filter((r) => !exact.includes(r) && r.newer && !r.onlyHere.length && r.onlyThere.length === r.newer && r.local! + r.newer === r.scryfall);
const differ = rows.filter((r) => !r.error && r.local !== undefined && !exact.includes(r) && !newerOnly.includes(r))
    .sort((a, b) => Math.abs(b.local! - b.scryfall) - Math.abs(a.local! - a.scryfall));
const unsupported = rows.filter((r) => r.why !== undefined);
const errors = rows.filter((r) => r.error);
const inOrder = exact.filter((r) => !r.order);
const names = (list: string[]) => list.slice(0, 6).join(", ") + (list.length > 6 ? ` +${list.length - 6} more` : "");

const lines = [
    `# Search syntax against Scryfall`, ``,
    `${new Date().toISOString()} · ${rows.length} searches: ${exact.length} exact, ${newerOnly.length} exact but for cards newer than the bulk file, ${differ.length} differ, ${unsupported.length} not supported here, ${errors.length} Scryfall errors`, ``,
    `## Differ`, ``,
    ...(differ.length ? differ.flatMap((r) => [
        `- \`${r.q}\`: here ${r.local}, Scryfall ${r.scryfall}${r.onlyHere.length + r.onlyThere.length ? "" : " (counts only: too many to list)"}`,
        ...(r.onlyHere.length ? [`  only here: ${names(r.onlyHere)}`] : []),
        ...(r.onlyThere.length ? [`  only Scryfall: ${names(r.onlyThere)}`] : []),
    ]) : ["None."]), ``,
    // the same cards in a different order: sorting, by name unless the search says otherwise
    `## Same cards, different order (${inOrder.length} of ${exact.length} exact searches in Scryfall's order)`, ``,
    ...(exact.length > inOrder.length ? exact.filter((r) => r.order).map((r) => `- \`${r.q}\`: from card ${r.order!.at + 1}, Scryfall has ${r.order!.theirs}, here ${r.order!.ours}`) : ["None."]), ``,
    `## Not supported here yet`, ``,
    ...(unsupported.length ? unsupported.map((r) => `- \`${r.q}\`: ${r.why}`) : ["None."]), ``,
    ...(errors.length ? [`## Scryfall errors`, ``, ...errors.map((r) => `- \`${r.q}\`: ${r.error}`), ``] : []),
    // Scryfall answers with the rest of the search when it ignores a term, where the local search refuses it
    ...(rows.some((r) => r.warnings) ? [`## Scryfall ignored part of the search`, ``, ...rows.filter((r) => r.warnings).map((r) => `- \`${r.q}\`: ${r.warnings!.join(" ")}`), ``] : []),
    `## Exact`, ``, exact.map((r) => `\`${r.q}\` (${r.scryfall})`).join(" · "), ``,
];
writeFileSync(join(OUT, SUMMARY), lines.join("\n"));
console.log(`${rows.length} searches: ${exact.length} exact, ${newerOnly.length} exact but for newer cards, ${differ.length} differ, ${unsupported.length} not supported here, ${errors.length} Scryfall errors`);
console.log(`Summary: ${join(OUT, SUMMARY)}`);
process.exitCode = differ.length || unsupported.length ? 1 : 0;
