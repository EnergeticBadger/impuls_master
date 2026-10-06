// Random searches, local against Scryfall: npm run fuzz-syntax -- [--count 200] [--seed 1] [--out <dir>] [--refresh]
// Each joins 2 to 4 terms from every family of keys (types, colors, stats, rarity, formats, keywords, is:, text,
// sets…) with AND, OR, a minus or brackets, which is where the keys meet: hidden printings under a minus,
// printing keys next to card keys, an OR inside a negation. The same seed makes the same searches, so a run is
// repeatable, and Scryfall's answers are kept a week in <out>/scryfall-fuzz.json.
// The counts are compared; where they differ and Scryfall's answer fits in a few pages, so are the cards.
// <out>/fuzz-syntax-summary.md starts with what differs.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGE, Answers } from "./scryfall-answers.ts";
import { Unsupported, bulkFile, loadCards, parse, search, setsFile } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const COUNT = Number(option("count", "200"));
const SEED = Number(option("seed", "1"));
const REFRESH = args.includes("--refresh");
const PAGES = 5;

// the terms searches are made of, a family each so a search mixes different kinds of key
const FAMILIES: string[][] = [
    ["t:creature", "t:instant", "t:sorcery", "t:artifact", "t:enchantment", "t:land", "t:planeswalker", "t:legendary", "t:goblin", "t:elf", "t:dragon", "t:zombie", "t:equipment", "t:aura", "t:saga", "t:token", "-t:basic"],
    ["c:w", "c:u", "c:b", "c:r", "c:g", "c=c", "c:m", "c>=ub", "c<=rg", "c=2", "id<=wu", "id:esper", "id=g", "id>=3", "c!=r"],
    ["mv=0", "mv=1", "mv=2", "mv<=2", "mv>=5", "mv>6", "mv:odd", "pow>=4", "pow=0", "tou>=5", "pow>tou", "tou>pow", "loy>=4", "m:{X}", "m:RR", "m>=2WW", "pt>=8"],
    ["r:common", "r:uncommon", "r:rare", "r:mythic", "r>=rare", "r<rare", "r:special"],
    ["f:standard", "f:pioneer", "f:modern", "f:legacy", "f:commander", "f:pauper", "banned:legacy", "f:brawl", "-f:vintage"],
    ["kw:flying", "kw:trample", "kw:haste", "kw:deathtouch", "kw:flash", "kw:ward", "kw:cycling", "kw:landfall", "kw:equip", "kw:changeling", "kw:\"first strike\""],
    ["is:commander", "is:spell", "is:permanent", "is:historic", "is:vanilla", "is:frenchvanilla", "is:bear", "is:modal", "is:dfc", "is:mdfc", "is:split", "is:adventure", "is:reserved", "is:reprint", "is:promo", "is:digital", "is:funny", "is:full", "is:foil", "is:etched", "is:unique", "is:hybrid", "is:phyrexian", "is:party", "is:outlaw", "is:shockland", "is:gainland"],
    ["o:draw", "o:\"draw a card\"", "o:destroy", "o:exile", "o:sacrifice", "o:~", "o:\"~ deals\"", "o:token", "o:\"enters tapped\"", "o:counter", "fo:flying", "o:/^when ~ enters/", "o:/\\bscry \\d/", "o:\"you gain\"", "o:graveyard"],
    ["s:neo", "s:m21", "s:dmu", "e:lea", "st:masters", "st:commander", "b:ktk", "in:lea", "in:mythic", "game:arena", "-game:paper", "is:alchemy", "year>=2023", "year<=1997", "date>=2020-01-01"],
    ["a:avon", "a:\"rebecca guay\"", "ft:the", "ft:/\\bdeath\\b/", "wm:phyrexian", "has:watermark", "frame:1997", "frame:showcase", "frame:extendedart", "border:borderless", "border:white", "stamp:acorn", "usd>=10", "usd<1", "tix>=5"],
    ["name:dragon", "name:/^a/", "bolt", "\"of the\"", "-name:goblin", "!\"Lightning Bolt\"", "otag:removal", "otag:ramp", "otag:card-advantage", "prints>=20", "sets=1", "edhrec<=500", "lang:en", "include:extras"],
];

// a small seeded generator (mulberry32), so a seed always makes the same searches
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

// 2 to 4 terms from different families, joined by AND mostly; sometimes OR, a minus, or an OR in brackets
function makeSearch(): string {
    const families = [...FAMILIES].sort(() => random() - 0.5).slice(0, 2 + Math.floor(random() * 3));
    const terms = families.map((f) => {
        const term = pick(f);
        return random() < 0.15 && !term.startsWith("-") ? `-${term}` : term;
    });
    const shape = random();
    if (shape < 0.15 && terms.length >= 2) return `${terms[0]} or ${terms.slice(1).join(" ")}`;
    if (shape < 0.3 && terms.length >= 3) return `(${terms[0]} or ${terms[1]}) ${terms.slice(2).join(" ")}`;
    if (shape < 0.4 && terms.length >= 3) return `-(${terms[0]} or ${terms[1]}) ${terms.slice(2).join(" ")}`;
    return terms.join(" ");
}

const live = !!process.stdout.isTTY;
const say = (line: string) => live ? process.stdout.write(`\r\x1b[2K${line}`) : console.log(line);
const answers = new Answers(join(OUT, "scryfall-fuzz.json"), say);

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

type Row = { q: string, local?: number, scryfall: number, onlyHere: string[], onlyThere: string[], listed: boolean, why?: string, error?: string };
const searches = [...new Set(Array.from({ length: COUNT }, makeSearch))];
const rows: Row[] = [];
for (const [n, q] of searches.entries()) {
    say(`${n + 1}/${searches.length} ${q}`);
    const row: Row = { q, scryfall: 0, onlyHere: [], onlyThere: [], listed: false };
    let here: number[] | undefined;
    try { here = search(parse(q), data); row.local = here.length; } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        row.why = e.message;
    }
    let theirs = await answers.ask(q, 0, REFRESH);
    row.scryfall = theirs.total;
    row.error = theirs.error;
    if (here && !theirs.error && here.length !== theirs.total && theirs.total <= PAGES * PAGE) theirs = await answers.ask(q, PAGES, REFRESH);
    if (here && theirs.cards) {
        const there = new Set(theirs.cards.map(([id]) => id));
        const ids = new Set(here.map((i) => data.cards[i].oracleId));
        row.listed = true;
        row.onlyHere = here.filter((i) => !there.has(data.cards[i].oracleId)).map((i) => data.cards[i].name);
        row.onlyThere = theirs.cards.filter(([id]) => !ids.has(id)).map(([, name]) => name);
    }
    rows.push(row);
}
if (live) process.stdout.write("\r\x1b[2K");

const compared = rows.filter((r) => r.local !== undefined && !r.error);
const exact = compared.filter((r) => r.local === r.scryfall && !r.onlyHere.length && !r.onlyThere.length);
const differ = compared.filter((r) => !exact.includes(r)).sort((a, b) => Math.abs(b.local! - b.scryfall) - Math.abs(a.local! - a.scryfall));
const names = (list: string[]) => list.slice(0, 8).join(", ") + (list.length > 8 ? ` +${list.length - 8} more` : "");
const share = compared.length ? (exact.length / compared.length * 100).toFixed(1) : "0";
const headline = `${searches.length} random searches (seed ${SEED}): ${exact.length} of ${compared.length} compared exact (${share}%), ${rows.filter((r) => r.why).length} not supported here, ${rows.filter((r) => r.error).length} Scryfall errors`;

const lines = [
    `# Random searches against Scryfall`, ``, `${new Date().toISOString()} · ${headline}`, ``,
    `## Differ`, ``,
    ...(differ.length ? differ.flatMap((r) => [
        `- \`${r.q}\`: here ${r.local}, Scryfall ${r.scryfall}${r.listed ? "" : " (too many to list)"}`,
        ...(r.onlyHere.length ? [`  only here: ${names(r.onlyHere)}`] : []),
        ...(r.onlyThere.length ? [`  only Scryfall: ${names(r.onlyThere)}`] : []),
    ]) : ["None."]), ``,
    ...(rows.some((r) => r.error) ? [`## Scryfall errors`, ``, ...rows.filter((r) => r.error).map((r) => `- \`${r.q}\`: ${r.error}`), ``] : []),
    ...(rows.some((r) => r.why) ? [`## Not supported here`, ``, ...rows.filter((r) => r.why).map((r) => `- \`${r.q}\`: ${r.why}`), ``] : []),
];
writeFileSync(join(OUT, "fuzz-syntax-summary.md"), lines.join("\n"));
console.log(headline);
console.log(`Summary: ${join(OUT, "fuzz-syntax-summary.md")}`);
process.exitCode = differ.length ? 1 : 0;
