// Writes scripts/combo-cases.txt: "What it does" picked together with the panel's other filters, made with the
// panel's own code (buildToken and buildQuery in app/Components/Searchbar/filters.ts), for npm run test-combos to
// check against Scryfall card by card: npm run combo-cases -- [--seed <n>] [--out <dir>]
// Every trigger, effect, target and role once, each with a different filter beside it (type, color, identity,
// mana value, keyword, format, rarity, price, year, set, artist…), then the shapes the panel can join them in:
// a whole ability, several abilities, any/all, left out, and an OR between chips.
// Each search is narrowed with more filter chips, picked at random (--seed), until the local search finds a
// handful of cards, so Scryfall's whole answer fits in two pages and can be compared card by card. That needs
// the card data (as test-syntax: <out>/bulk or SCRYFALL_BULK_DIR); the file is committed, so the searches only
// change when it's made again.
// Runs with node --import ./scripts/app-paths.ts, since filters.ts imports the app's ~/ paths.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FILTERS, buildQuery, buildToken, emptyDraft, type Draft, type Join } from "../app/Components/Searchbar/filters.ts";
import { EFFECTS, ROLES, TARGETS, TRIGGERS, blockToken, type RuleBlock } from "../app/Components/Searchbar/rules.ts";
import { regexProblems } from "../app/Components/Searchbar/regexLimits.ts";
import { Unsupported, bulkFile, loadCards, parse, search, setsFile } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
// at most this many cards, so Scryfall's answer is two pages at most (175 a page) with room to differ
const LIMIT = 330;
// Scryfall cuts a search off somewhere past 1,000 characters ("unclosed parentheses")
const MAX_LENGTH = 900;

let state = Number(option("seed", "1")) >>> 0 || 1;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];

const started = Date.now();
const data = await loadCards(await bulkFile("default_cards", join(OUT, "bulk")), await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined), await setsFile(join(OUT, "bulk")).catch(() => undefined));
console.log(`${data.cards.length.toLocaleString()} cards loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// ---- chips, as the panel makes them ----

type Spec = { id: string, d: Partial<Draft> };
type Chip = { token: string, join: Join };
const byId = (id: string) => FILTERS.find((f) => f.id === id)!;
const chip = (s: Spec, join: Join = "and"): Chip => {
    const f = byId(s.id);
    return { token: buildToken(f, { ...emptyDraft(f), ...s.d }), join };
};

// every other filter, a few ways each: what goes beside "What it does"
const OTHERS: Spec[] = [
    ...["creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "equipment", "aura", "vehicle"].map((v) => ({ id: "type", d: { values: [v] } })),
    { id: "type", d: { values: ["instant", "sorcery"], match: "any" } },
    { id: "type", d: { values: ["artifact", "creature"], match: "all" } },
    { id: "type", d: { values: ["creature"], exclude: true } },
    ...["elf", "goblin", "zombie", "human", "dragon", "wizard", "soldier", "spirit"].map((v) => ({ id: "creature", d: { values: [v] } })),
    { id: "creature", d: { values: ["elf", "goblin"], match: "any" } },
    { id: "creature", d: { values: ["human"], exclude: true } },
    { id: "legendary", d: { values: ["legendary"] } },
    { id: "legendary", d: { values: ["legendary creature"] } },
    { id: "legendary", d: { values: ["commander"] } },
    { id: "legendary", d: { values: ["legendary"], exclude: true } },
    ...["w", "u", "b", "r", "g"].map((c) => ({ id: "color", d: { values: [c] } })),
    { id: "color", d: { values: ["r", "g"], compare: "=" } },
    { id: "color", d: { values: ["u", "b"], compare: "<=" } },
    { id: "color", d: { values: ["c"] } },
    { id: "color", d: { colorBy: "count", compare: ">=", text: "2" } },
    { id: "color", d: { values: ["g"], exclude: true } },
    ...["w", "u", "b", "r", "g"].map((c) => ({ id: "identity", d: { values: [c], compare: "=" } })),
    { id: "identity", d: { values: ["b", "g"] } },
    { id: "identity", d: { values: ["w", "u", "r"] } },
    { id: "identity", d: { values: ["c"], compare: "=" } },
    { id: "identity", d: { colorBy: "count", compare: "=", text: "3" } },
    ...["flying", "trample", "haste", "flash", "lifelink", "deathtouch", "cycling", "flashback", "landfall", "ward"].map((v) => ({ id: "keyword", d: { values: [v] } })),
    { id: "keyword", d: { values: ["flying", "vigilance"], match: "all" } },
    { id: "keyword", d: { values: ["flying"], exclude: true } },
    ...["0", "1", "2", "3", "4", "6"].map((v) => ({ id: "mv", d: { compare: "=", text: v } })),
    { id: "mv", d: { compare: "<=", text: "2" } },
    { id: "mv", d: { compare: ">=", text: "5" } },
    { id: "mv", d: { compare: ">=", text: "4", exclude: true } },
    { id: "power", d: { compare: ">=", text: "4" } },
    { id: "power", d: { compare: "<=", text: "1" } },
    { id: "power", d: { compare: "=", text: "2" } },
    { id: "toughness", d: { compare: ">=", text: "5" } },
    { id: "toughness", d: { compare: "<", text: "2" } },
    { id: "loyalty", d: { compare: "<=", text: "4" } },
    ...["common", "uncommon", "rare", "mythic"].map((v) => ({ id: "rarity", d: { values: [v] } })),
    { id: "rarity", d: { values: ["rare", "mythic"], match: "any" } },
    { id: "rarity", d: { values: ["common"], exclude: true } },
    ...["commander", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "brawl", "historic", "timeless"].map((v) => ({ id: "format", d: { values: [v] } })),
    { id: "format", d: { values: ["modern"], exclude: true } },
    { id: "price", d: { compare: "<", text: "1" } },
    { id: "price", d: { compare: ">=", text: "10" } },
    { id: "year", d: { compare: ">=", text: "2022" } },
    { id: "year", d: { compare: "<=", text: "2003" } },
    { id: "year", d: { compare: "=", text: "2015" } },
    { id: "year", d: { compare: ">=", text: "2010", exclude: true } },
    ...["neo", "mh3", "dmu", "m21", "eld", "c20", "lea", "cmr"].map((v) => ({ id: "set", d: { text: v } })),
    ...["john avon", "rebecca guay", "seb mckinnon", "guay"].map((v) => ({ id: "artist", d: { text: v } })),
    ...["dragon", "of the", "angel"].map((v) => ({ id: "name", d: { text: v } })),
    { id: "name", d: { text: "the", exclude: true } },
];

const rules = (d: Partial<Draft>): Spec => ({ id: "oracle", d: { blocks: [], ...d } });
const block = (b: Partial<RuleBlock>): RuleBlock => ({ trigger: "", effect: "", words: "", ...b });

// ---- narrowing ----

const count = (q: string) => search(parse(q), data).length;
const usable = (q: string) => q.length <= MAX_LENGTH && !regexProblems(q).length;

type Shape = { lead?: Spec[], tail?: Chip[], rulesLast?: boolean, most?: number, limit?: number };
// the rules chip with `first` beside it, and more filters added (or swapped) until the local search finds
// 1–LIMIT cards; null when no mix of them gets there
function narrowed(r: Spec, first: Spec, shape: Shape = {}): string | null {
    const most = shape.most ?? 4, limit = shape.limit ?? LIMIT;
    let picked = [first];
    for (let tries = 0; tries < 40; tries++) {
        const filters = picked.map((s) => chip(s));
        const middle = shape.rulesLast ? [...filters, chip(r)] : [chip(r), ...filters];
        const q = buildQuery([...(shape.lead ?? []).map((s) => chip(s)), ...middle, ...(shape.tail ?? [])]);
        if (!usable(q)) return null;
        let n: number;
        try { n = count(q); } catch (e) { if (e instanceof Unsupported) return null; throw e; }
        if (n >= 1 && n <= limit) return q;
        if (n === 0 && picked.length === 1) return null;
        const others = OTHERS.filter((s) => !picked.some((p) => p.id === s.id));
        // too many: one more filter; none, or still too many with no room left: swap the last one added
        if (n > limit && picked.length < most) picked = [...picked, pick(others)];
        else picked = [...picked.slice(0, -1), pick(others)];
    }
    return null;
}

// a case for each rules chip, the filters beside it taken in turn so every one is used with many of them
let turn = 0;
function one(r: Spec, shape: Shape = {}): string | null {
    for (let tries = 0; tries < 20; tries++) {
        const first = OTHERS[turn++ % OTHERS.length];
        const q = narrowed(r, first, { rulesLast: turn % 2 === 0, ...shape });
        if (q) return q;
    }
    return null;
}

const lines: string[] = [];
const missed: string[] = [];
const seen = new Set<string>();
function group(title: string, list: { about: string, q: string | null }[]) {
    // an empty title carries on the group before
    if (title) lines.push("", `# ${title}`);
    for (const { about, q } of list) {
        if (!q) missed.push(`${title}: ${about}`);
        else if (!seen.has(q)) { seen.add(q); lines.push(q); }
    }
}

// ---- each piece once ----

group("Does (each effect, the broad ones first)", EFFECTS.map((p) => ({ about: p.value, q: one(rules({ blocks: [block({ effect: p.value })] })) })));
group("When (each trigger)", TRIGGERS.map((p) => ({ about: p.value, q: one(rules({ blocks: [block({ trigger: p.value })] })) })));
group("To who or what (each target)", TARGETS.map((p) => ({ about: p.value, q: one(rules({ blocks: [block({ words: p.value })] })) })));
group("What it's for (each role)", ROLES.map((p) => ({ about: p.value, q: one(rules({ values: [p.value] })) })));
group("Exact words", ["draw a card", "enters tapped", "flying", "+1/+1 counter", "sacrifice", "{T}: add"].map((t) => ({ about: t, q: one(rules({ text: t })) })));

// ---- the shapes the panel joins them in ----

// a rules chip made by `make` that finds at least a few cards on its own, so the filters beside it have
// something to narrow; random picks of two things a card does all at once often find nothing
function finding(make: () => Spec, least = 5): Spec {
    for (let tries = 0; ; tries++) {
        const s = make();
        if (tries > 200) return s;
        try { if (count(chip(s).token) >= least) return s; } catch (e) { if (!(e instanceof Unsupported)) throw e; }
    }
}
const effect = () => block({ effect: pick(EFFECTS).value });
const roles = (n: number) => [...new Set(Array.from({ length: n * 3 }, () => pick(ROLES).value))].slice(0, n);
const about = (b: RuleBlock) => `${b.trigger || "-"} / ${b.effect || "-"} / ${b.words || "-"}`;
const say = (s: Spec) => [...(s.d.values ?? []), ...(s.d.blocks ?? []).map(about), ...(s.d.text ? [`"${s.d.text}"`] : [])].join(s.d.match === "any" ? " | " : " + ") + (s.d.exclude ? " (left out)" : "");
const shapes = (title: string, n: number, make: (i: number) => Spec, shape: Shape = {}) =>
    group(title, Array.from({ length: n }, (_, i) => { const s = finding(() => make(i)); return { about: say(s), q: one(s, shape) }; }));

// a whole ability, when + does (+ to who)
const whole = () => block({ trigger: pick(TRIGGERS).value, effect: pick(EFFECTS).value, words: random() < 0.6 ? pick(TARGETS).value : "" });
shapes("A whole ability (when, does, to who)", 24, () => rules({ blocks: [whole()] }));
shapes("Two abilities, both", 10, () => rules({ blocks: [effect(), effect()], match: "all" }));
shapes("Two abilities, either", 10, () => rules({ blocks: [effect(), effect()], match: "any" }));
shapes("A role and an ability, either or both", 12, (i) => rules({ values: roles(1), blocks: [i % 3 ? effect() : whole()], match: i % 2 ? "any" : "all" }));
shapes("Roles, words and an ability together", 6, (i) => rules({ values: roles(2), blocks: [effect()], text: pick(["draw", "token", "exile", "counter"]), match: i % 2 ? "any" : "all" }));
// left out: everything but what it does, so it takes more filters to narrow
shapes("What it does, left out", 14, (i) => rules({ ...(i % 3 === 0 ? { values: roles(1) } : { blocks: [i % 3 === 1 ? effect() : whole()] }), exclude: true }), { most: 5 });
// an OR between chips: what's before it, or one small filter (buildQuery brackets the left side)
const small = OTHERS.filter((s) => { const n = count(chip(s).token); return n > 0 && n <= 250; });
for (let i = 0; i < 12; i++) {
    const s = pick(small);
    shapes(i ? "" : "Or another filter", 1, () => i % 2 ? rules({ values: roles(1) }) : rules({ blocks: [effect()] }), { tail: [chip(s, "or")], limit: 600 });
}
// filters before and after "what it does": the local search narrows an AND as it goes
for (let i = 0; i < 10; i++) shapes(i ? "" : "Filters on both sides", 1, () => rules({ blocks: [effect()] }), { lead: [pick(OTHERS)] });

const out = [
    "# Generated by npm run combo-cases from the filter panel's own code (scripts/combo-cases.ts); don't edit by hand.",
    "# npm run test-combos checks these against Scryfall card by card.",
    ...lines,
].join("\n") + "\n";
writeFileSync(new URL("./combo-cases.txt", import.meta.url), out);
console.log(`${seen.size} searches written to scripts/combo-cases.txt in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (missed.length) console.log(`${missed.length} couldn't be narrowed to 1–${LIMIT} cards within Scryfall's limits:\n${missed.map((m) => `  ${m}`).join("\n")}`);
