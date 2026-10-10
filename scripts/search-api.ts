// A stand-in for Scryfall's GET /cards/search, on the local engine (scripts/local-search.ts): the same parameters,
// and the same response, field for field: the list object and its pages, the warnings for terms Scryfall ignores,
// and its errors, with Scryfall's own wording. npm run test-api checks it against Scryfall's raw responses.
// Everything here was found by asking Scryfall (scripts/test-api.ts keeps its answers); the comments say what it
// does and how we know.
//
// No Node-only APIs on the request path, so a Worker or a browser can run it: it takes the loaded cards (loadCards)
// and a way to get a printing's card object (the bulk file's objects are the API's), and returns status and body.
// What the engine can't answer throws Unsupported, so a caller can ask Scryfall instead.

import { MINUS_DROPPED } from "../app/Components/Searchbar/droppedTerms.ts";
import KEYWORD_WORDS from "./keyword-words.json" with { type: "json" };
import { Unsupported, isValues, parse, results, revealed, type Cards, type Node } from "./local-search.ts";

export const PAGE_SIZE = 175;

export type SearchParams = Record<string, string | undefined>;
export type ApiOptions = {
    // where next_page points: Scryfall's own is https://api.scryfall.com/
    base?: string,
    // the full card object for a printing (an index into data.prints), as the bulk file has it
    card: (print: number) => unknown | Promise<unknown>,
};
export type ApiResponse = { status: number, body: Record<string, unknown> };

// ---- Scryfall's words ----
// (its quotes are curly; "didn‘t" really has a left quote)
const NOT_FOUND = "Your query didn’t match any cards. Adjust your search terms or refer to the syntax guide at https://scryfall.com/docs/reference";
const NOTHING_TO_SEARCH = "You didn‘t enter anything to search for.";
const UNCLOSED = "Your search contains unclosed parentheses.";
const ALL_IGNORED = "All of your terms were ignored.";
const TOO_MANY_REGEXES = "Too many regular expression operators used";
const DISPLAY_IN_BRACKETS = "Display options may not be specified inside parentheses.";
const PAST_THE_END = "You have paginated beyond the end of these results, reduce your `page` parameter or refer to the syntax guide at https://scryfall.com/docs/reference";

// a 404 has no warnings field at all, even when terms were ignored ("foo:bar t:slivr"); a 400 always has one,
// null when there are none ("t:sliver (")
const notFound = (): ApiResponse => ({ status: 404, body: { object: "error", code: "not_found", status: 404, details: NOT_FOUND } });
const badRequest = (details: string, warnings: string[] = []): ApiResponse =>
    ({ status: 400, body: { object: "error", code: "bad_request", status: 400, warnings: warnings.length ? warnings : null, details } });
const pastTheEnd = (): ApiResponse => ({ status: 422, body: { object: "error", code: "validation_error", status: 422, details: PAST_THE_END } });

// ---- the parameters ----

// page as Ruby's to_i reads it: "2.5" is 2, "abc", "0" and "-1" are 1
function pageNumber(v?: string) {
    const n = Number(/^\s*[+-]?\d+/.exec(v ?? "")?.[0] ?? 0);
    return Math.max(1, n);
}
// include_extras and the like: "1", "true" and "maybe" are on; "", "0", "false" and "False" off
// (TODO: confirm the off words beyond these)
const flag = (v?: string) => v !== undefined && !/^(|0|f|false|off|no|n)$/i.test(v.trim());

// what order=, unique= and dir= take; anything else (even "CMC") is the default, without a warning
const ORDER_VALUES = new Set(["name", "set", "released", "rarity", "color", "usd", "tix", "eur", "cmc", "power", "toughness", "edhrec", "penny", "artist", "review"]);
const UNIQUE_VALUES = new Set(["cards", "art", "prints"]);
const DIR_VALUES = new Set(["auto", "asc", "desc"]);
const ORDER_NAMES: Record<string, string> = { mv: "cmc", manavalue: "cmc" };

export async function cardsSearch(data: Cards, params: SearchParams, options: ApiOptions): Promise<ApiResponse> {
    const base = options.base ?? "https://api.scryfall.com/";
    const q = (params.q ?? "").trim();
    if (!q) return badRequest(NOTHING_TO_SEARCH);
    // format=csv answers in CSV; anything else (text, nonsense) is JSON as usual
    if (params.format === "csv") throw new Unsupported("format=csv");
    const read = readSearch(q, data);
    if ("error" in read) return badRequest(read.error, read.warnings);
    const { warnings, display } = read;
    // which printing prefer: shows is the engine's to say, when it can
    if (display.prefer) throw new Unsupported(`prefer:${display.prefer}`);
    // the search's own order:, unique: and direction: win over the parameters
    const order = display.order ?? (ORDER_VALUES.has(params.order ?? "") ? params.order! : "name");
    const unique = display.unique ?? (UNIQUE_VALUES.has(params.unique ?? "") ? params.unique! : "cards");
    const dir = display.dir ?? (DIR_VALUES.has(params.dir ?? "") ? params.dir! : "auto");
    const extras = display.extras || flag(params.include_extras);
    if (flag(params.include_multilingual)) throw new Unsupported("include_multilingual needs every language's printings");
    if (flag(params.include_variations)) throw new Unsupported("include_variations");

    let node: Node;
    try {
        node = parse(read.rewritten);
    } catch (e) {
        if (e instanceof Unsupported && ["every term is one Scryfall ignores", "empty group"].includes(e.message)) {
            // with nothing left to search, a 400, warnings or not: "()" and "-mv>=3" alone too
            return badRequest(ALL_IGNORED, warnings);
        }
        throw e;
    }
    const listed = entries(node, data, { order, dir, unique, extras });
    if (!listed.length) return notFound();
    const page = pageNumber(params.page);
    const pages = Math.ceil(listed.length / PAGE_SIZE);
    if (page > pages) return pastTheEnd();
    const body: Record<string, unknown> = { object: "list", total_cards: listed.length, has_more: page < pages };
    if (page < pages) body.next_page = nextPage(base, { q, page: page + 1, order, unique, dir, extras: extras || revealed(node) > 0, params });
    if (warnings.length) body.warnings = warnings;
    body.data = await Promise.all(listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => options.card(p)));
    return { status: 200, body };
}

// next_page as Scryfall writes it: its parameters in alphabetical order, the search trimmed, order and unique as
// used (the search's own order: and unique: win), dir only when it's asc or desc, and format always json
// include_extras is true there whenever the search itself shows extras (t:token, border:silver, is:reserved…), and
// the search is written in lower case with single spaces ("t:goblin   OR t:elf" is "t:goblin or t:elf")
function nextPage(base: string, { q, page, order, unique, dir, extras, params }: { q: string, page: number, order: string, unique: string, dir: string, extras: boolean, params: SearchParams }) {
    const p: [string, string][] = [];
    if (dir === "asc" || dir === "desc") p.push(["dir", dir]);
    p.push(["format", "json"], ["include_extras", String(extras)], ["include_multilingual", String(flag(params.include_multilingual))],
        ["include_variations", String(flag(params.include_variations))], ["order", order], ["page", String(page)],
        ["q", q.toLowerCase().replace(/\s+/g, " ")], ["unique", unique]);
    return `${base}cards/search?${p.map(([k, v]) => `${k}=${escape(v)}`).join("&")}`;
}

// a value in a URL the way Scryfall (Ruby's CGI.escape) writes it: letters, digits and _ . - ~ as they are, a space
// as +, anything else as %XX of its UTF-8 bytes. (URLSearchParams would write ~ as %7E)
const escape = (v: string) => [...new TextEncoder().encode(v)].map((b) => {
    const ch = String.fromCharCode(b);
    return /[A-Za-z0-9_.~-]/.test(ch) ? ch : ch === " " ? "+" : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
}).join("");

// ---- reading the search ----

// `quoted` for a "value", `open` for a quote or regex that isn't closed
type Token = { kind: "(" | ")" | "-" | "or" | "and" | "word" | "term", start: number, end: number, key?: string, op?: string, value?: string, regex?: boolean, quoted?: boolean, open?: boolean };
const OPS = ["<=", ">=", "!=", ":", "=", "<", ">"];

// the search in pieces, where each starts and ends, read the way the engine's tokenize reads it
function scan(q: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    // a quote that's never closed doesn't run to the end: it's a quote mark in a word, up to a space or bracket
    // (is:"digital t:dragon) has unclosed brackets, (r:/common or r:uncommon) warns about the rarity “/common”)
    const quotedEnd = (at: number) => { const end = q.indexOf("\"", at + 1); return end < 0 ? at + 1 + /^[^\s()]*/.exec(q.slice(at + 1))![0].length : end + 1; };
    while (i < q.length) {
        const ch = q[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === "(" || ch === ")") { out.push({ kind: ch, start: i, end: i + 1 }); i++; continue; }
        if (ch === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push({ kind: "-", start: i, end: i + 1 }); i++; continue; }
        if (ch === "!") {
            const end = q[i + 1] === "\"" ? quotedEnd(i + 1) : i + 1 + /^[^\s()]*/.exec(q.slice(i + 1))![0].length;
            out.push({ kind: "word", start: i, end });
            i = end;
            continue;
        }
        // a key is letters, _ and -: foo-bar:baz is the unknown key “foo-bar”, but foo1:bar a word of a name
        const key = /^[a-z_][a-z_-]*/i.exec(q.slice(i))?.[0] ?? "";
        const op = key ? OPS.find((o) => q.startsWith(o, i + key.length)) : undefined;
        if (key && op) {
            let j = i + key.length + op.length, regex = false, quoted = false, open = false, value: string;
            let end = j + 1;
            if (q[j] === "/") while (end < q.length && q[end] !== "/") end += q[end] === "\\" ? 2 : 1;
            if (q[j] === "/" && end < q.length) {
                value = q.slice(j + 1, end);
                regex = true;
                j = end + 1;
            } else if (q[j] === "\"" && q.indexOf("\"", j + 1) > 0) {
                end = q.indexOf("\"", j + 1);
                value = q.slice(j + 1, end);
                quoted = true;
                j = end + 1;
            } else if (q[j] === "/" || q[j] === "\"") {
                // never closed: the slash or quote is part of a plain value
                value = /^[^\s()]*/.exec(q.slice(j))![0];
                open = true;
                j += value.length;
            } else {
                value = /^[^\s()]*/.exec(q.slice(j))![0];
                j += value.length;
            }
            out.push({ kind: "term", start: i, end: j, key: key.toLowerCase(), op, value, regex, quoted, open });
            i = j;
            continue;
        }
        if (ch === "\"") { const end = quotedEnd(i); out.push({ kind: "word", start: i, end }); i = end; continue; }
        const word = /^[^\s()]+/.exec(q.slice(i))![0];
        out.push({ kind: /^or$/i.test(word) ? "or" : /^and$/i.test(word) ? "and" : "word", start: i, end: i + word.length });
        i += word.length;
    }
    return out;
}

type Display = { order?: string, unique?: string, dir?: string, extras: boolean, prefer?: string };
type Read = { error: string, warnings: string[] } | { rewritten: string, warnings: string[], display: Display };

// what Scryfall makes of each term (see judge), and the search rewritten for the engine: a term Scryfall ignores
// becomes one the engine drops the same way (-mv>=0, see MINUS_DROPPED), one that can match nothing one that
// matches nothing, and the display options (order:, unique:…) are taken out and read here
function readSearch(q: string, data: Cards): Read {
    const tokens = scan(q);
    // brackets first, left to right: a ")" with no "(" or a display option in brackets ("t:sliver (order:cmc)", or
    // after a bracket never closed), whichever comes first, then a bracket never closed, fail the whole search
    // before anything else is read: "(t:sliver c:rgm)) (order:cmc)" is unclosed, "(t:/wall order:name))" display
    let depth = 0;
    for (const t of tokens) {
        if (t.kind === "(") depth++;
        if (t.kind === ")" && --depth < 0) return { error: UNCLOSED, warnings: [] };
        if (t.kind === "term" && isDisplay(t) && depth > 0) return { error: DISPLAY_IN_BRACKETS, warnings: [] };
    }
    if (depth) return { error: UNCLOSED, warnings: [] };
    const warnings: string[] = [], displayWarnings: string[] = [], display: Display = { extras: false };
    let regexes = 0;
    const words = vocabulary(data);
    let out = "", at = 0;
    for (const [n, t] of tokens.entries()) {
        if (t.kind === "(") depth++;
        if (t.kind === ")") depth--;
        // an empty pair of brackets is nothing at all: "t:sliver ()" is every sliver, "()" alone ignored
        if (t.kind === "(" && tokens[n + 1]?.kind === ")") {
            out += q.slice(at, t.start) + `(${DROPPED})`;
            at = tokens[n + 1].end;
        }
        const swap = (start: number, as: string) => { out += `${q.slice(at, start)}${as} `; at = t.end; };
        // an "or" with nothing on one side is left out: "t:sliver or", "or t:sliver", "t:sliver or or t:elf"
        if (t.kind === "or" && (!tokens[n - 1] || ["(", "-"].includes(tokens[n - 1].kind) || !tokens[n + 1] || ["or", ")"].includes(tokens[n + 1].kind))) {
            swap(t.start, "");
            continue;
        }
        if (t.kind === "word") {
            const word = q.slice(t.start, t.end);
            // a minus on its own finds nothing ("t:sliver -" is a 404); "!", "!\"" and ":" on their own are every card
            if (word === "-") swap(t.start, NOTHING);
            else if (/^!"?$/.test(word)) swap(t.start, EVERYTHING);
            else if (/[:=<>"]/.test(word) && !/^!?"[^"]*"$/.test(word)) swap(t.start, nameWords(word));
            continue;
        }
        if (t.kind !== "term") continue;
        const negated = tokens[n - 1]?.kind === "-" && tokens[n - 1].end === t.start;
        const start = negated ? tokens[n - 1].start : t.start;
        // at most six regexes in a search: "Too many regular expression operators used"
        if (t.regex && ++regexes > 6) return { error: TOO_MANY_REGEXES, warnings: [] };
        let verdict: Verdict;
        if (isDisplay(t)) verdict = displayOption(t, display);
        // (the warning quotes it in lower case: A:/X/ is “a:/x/”, r:FOO “r:foo” and “foo.”)
        else verdict = judge(t, negated, q.slice(start, t.end).toLowerCase(), words);
        if (verdict.warning) (isDisplay(t) ? displayWarnings : warnings).push(verdict.warning);
        if (verdict.as === undefined) continue;
        // (with a space after, so "http://x" doesn't run the x into it)
        out += `${q.slice(at, start)}${verdict.as} `;
        at = t.end;
    }
    // a bad display option's warning comes before the others, wherever it is: "foo:bar t:sliver order:zzqx"
    return { rewritten: out + q.slice(at), warnings: [...displayWarnings, ...warnings], display };
}

// a word of a name as Scryfall reads one with : < > = or a stray quote in it: its letters and digits, the rest as
// spaces ("t:sliver is 13 cards, ones with "t sliver" in their names, like t>sliver); nothing left is every card (":")
function nameWords(word: string) {
    const words = word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return words ? `"${words}"` : EVERYTHING;
}

// a term the engine drops (see parse), and one that matches no card
const DROPPED = "-mv>=0";
const NOTHING = "!\"\u0001\"";
const EVERYTHING = `-${NOTHING}`;
const invalid = (raw: string, why: string) => `Invalid expression “${cut(raw)}” was ignored. ${why}`;
// what a warning quotes is cut short past 20 characters, "…" the 20th: “is:abcdefghijklmnopq” stays, but
// “is:abcdefghijklmnopqr” is “is:abcdefghijklmnop…”. A key is cut at 21: “abcdefghijklmnopqrst…”
const cut = (s: string, n = 20) => s.length > n ? `${s.slice(0, n - 1)}…` : s;

type Verdict = { as?: string, warning?: string };
const ignore = (raw: string, why: string): Verdict => ({ as: DROPPED, warning: invalid(raw, why) });

// the words some keys take, from the cards themselves: every keyword a card has (and Scryfall's catalogs of them,
// keyword-words.json), every format, frame, stamp…
type Words = { keywords: Set<string>, formats: Set<string>, frames: Set<string>, stamps: Set<string>, games: Set<string>, langs: Set<string>, setTypes: Set<string>, sets: Set<string>, is: Set<string> };
const vocabularies = new WeakMap<Cards, Words>();
function vocabulary(data: Cards): Words {
    let w = vocabularies.get(data);
    if (w) return w;
    w = { keywords: new Set(KEYWORD_WORDS), formats: new Set(), frames: new Set(), stamps: new Set(), games: new Set(), langs: new Set(), setTypes: new Set(), sets: new Set(data.setDates.keys()), is: new Set([...isValues(data), ...IS_WORDS]) };
    for (const c of data.cards) {
        for (const k of c.keywords) w.keywords.add(k);
        for (const f of [...c.legal, ...c.banned, ...c.restricted]) w.formats.add(f);
    }
    for (const p of data.prints) {
        w.frames.add(p.frame);
        for (const f of p.frameEffects) w.frames.add(f);
        if (p.stamp) w.stamps.add(p.stamp);
        for (const g of p.games) w.games.add(g);
        w.langs.add(p.lang);
        w.setTypes.add(p.setType);
    }
    vocabularies.set(data, w);
    return w;
}

// colours by name, as the engine reads them
const COLOR_NAMES = new Set(["white", "blue", "black", "red", "green", "colorless", "multicolor", "m",
    "azorius", "dimir", "rakdos", "gruul", "selesnya", "orzhov", "izzet", "golgari", "boros", "simic",
    "bant", "esper", "grixis", "jund", "naya", "abzan", "jeskai", "sultai", "mardu", "temur",
    "silverquill", "prismari", "witherbloom", "lorehold", "quandrix", "chaos", "aggression", "altruism", "growth", "artifice"]);
const RARITY_WORDS = new Set(["common", "uncommon", "rare", "mythic", "special", "bonus", "c", "u", "r", "m", "s", "b"]);
const NEW_WORDS = new Set(["rarity", "art", "artist", "flavor", "frame", "language"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;
// keys compared as numbers: a value that isn't one finds nothing, without a warning (t:sliver mv:zzqx is a 404)
const NUMBER_KEYS = new Set(["mv", "cmc", "manavalue", "pow", "power", "tou", "toughness", "loy", "loyalty", "pt", "powtou", "usd", "eur", "tix",
    "year", "edhrec", "edhrecrank", "prints", "sets", "paperprints", "papersets"]);

// what Scryfall does with one term: keeps it, ignores it (and warns), or finds nothing for it. `raw` is the term as
// typed, with its minus, which the warning quotes
function judge(t: Token, negated: boolean, raw: string, words: Words): Verdict {
    const verdict = judgeValue(t, negated, raw, words);
    // a quote or slash never closed is part of the value: checked like any other (r:/common warns), then it finds
    // nothing (t:sliver o:"draw is a 404)
    return t.open && verdict.as === undefined ? { as: NOTHING } : verdict;
}
function judgeValue(t: Token, negated: boolean, raw: string, words: Words): Verdict {
    const key = t.key!, value = t.value!, v = value.toLowerCase();
    // order>cmc and the like: a word of a name
    if (DISPLAY_KEYS.has(key)) return { as: t.op!.length === 1 ? nameWords(raw) : NOTHING };
    // a minus before a number comparison (see MINUS_DROPPED): -mv>=3, -pow<2 and the like are dropped without a
    // word, and the engine does that. With = or : Scryfall says why: for mana value the value's wrong ("-mv=3",
    // "-mv:zzqx"), for the others the key is unknown, minus and all (“-pow”), and for cn it's kept
    if (negated && MINUS_DROPPED.has(key) && !t.regex && !/^(even|odd)$/i.test(value)) {
        // not dropped but true for every card: -mv>=3 alone is all 33,650 cards, and (-mv<3 or t:sliver) too
        if (t.op !== "=" && t.op !== ":") return { as: EVERYTHING };
        if (["mv", "cmc", "manavalue"].includes(key)) return ignore(raw, "The value must be a number, or “even”/“odd”");
        // -cn=3 is read as meant (t:goblin -cn=3 has more goblins than t:goblin), where the engine would drop it
        if (["cn", "number"].includes(key)) return { as: `-(${raw.slice(1)})` };
        return ignore(raw, `Unknown keyword “${cut(`-${key}`, 21)}”.`);
    }
    // an unknown key with a minus is unknown with it: -foo:bar is “-foo”. With a regex (and an empty regex on any
    // key: o://) it's an unknown "regular expression keyword": http://x is “http://”, then the word x
    const named = cut(negated ? `-${key}` : key, 21);
    if (t.regex && KNOWN_KEYS.has(key) && !REGEX_KEYS.has(key) && !NO_REGEX_KEYS.has(key)) throw new Unsupported(`${key}:/regex/`);
    if (t.regex && (!REGEX_KEYS.has(key) || (value === "" && !t.open))) return ignore(raw, `Unknown regular expression keyword “${named}”.`);
    // FOO>bar is a word of a name, like t>sliver (see below)
    if (!KNOWN_KEYS.has(key) && t.op !== ":" && t.op !== "=") return { as: t.op!.length === 1 ? nameWords(raw) : NOTHING };
    if (!KNOWN_KEYS.has(key)) return ignore(raw, `Unknown keyword “${named}”.`);
    // is: (not:, has:) takes a word: is:/fetch and is:"spotlight are an unknown keyword “is”
    if (["is", "not", "has"].includes(key) && !/^[\p{L}\p{N}_-]*$/u.test(value)) return ignore(raw, `Unknown keyword “${named}”.`);
    // o:"" is an unknown keyword too
    if (t.quoted && value === "" && !t.open) return ignore(raw, `Unknown keyword “${named}”.`);
    // with no value at all the key is a word of a name: t:sliver c: is the slivers with a c in their name
    if (!t.quoted && !t.regex && value === "") return { as: (negated ? "-" : "") + key };
    if (t.regex) {
        const why = regexProblem(value);
        if (why) return ignore(raw, `Invalid regular expression: ${why}.`);
    }
    // < > and != only compare what can be compared. On another key, t>=sliver and t!=sliver find nothing, and
    // t>sliver is a word of a name ("t sliver": 13 cards), so t:sliver t>goblin finds nothing either
    if (!["=", ":"].includes(t.op!) && !COMPARE_KEYS.has(key) && !(t.op === "!=" && NOT_EQUAL_KEYS.has(key))) return { as: t.op!.length === 1 ? nameWords(raw) : NOTHING };
    // the engine reads a key as letters only, so set_type:… would be a word of a name there: it gets its other name,
    // or isn't supported
    if (key.includes("_")) {
        const alias = UNDERSCORE_KEYS[key];
        if (!alias) throw new Unsupported(`${key}:`);
        const verdict = judgeValue({ ...t, key: alias }, negated, raw, words);
        return verdict.as !== undefined ? verdict : { as: (negated ? "-" : "") + alias + raw.slice(raw.indexOf(t.op!, negated ? 1 : 0)) };
    }
    if (t.regex) return {};
    switch (key) {
        case "c": case "color": case "colors": case "id": case "identity": case "ci": case "commander": case "produces": {
            if (/^\d+$/.test(v) || COLOR_NAMES.has(v)) return {};
            const letters = [...new Set(v)].sort();
            // m and other letters: c:mub is “Using “m” with other colors is no longer supported. Use c>bu instead.”
            // (the others sorted, at most five: c:abcdefg…z says c>abcde)
            if (letters.includes("m")) return ignore(raw, `Using “m” with other colors is no longer supported. Use ${key}>${letters.filter((l) => l !== "m").join("").slice(0, 5)} instead.`);
            // c:abc: the colourless c with colours is checked before the letters are
            if (key !== "produces" && letters.includes("c") && letters.some((l) => "wubrg".includes(l))) return ignore(raw, "A card cannot be both colored and colorless.");
            // the first unknown letter in alphabetical order: c:zzqx is "q", c:purple "e"
            const bad = letters.find((l) => !"wubrgc".includes(l));
            return bad ? ignore(raw, `Unknown color “${bad}”`) : {};
        }
        case "m": case "mana": case "devotion": {
            const bad = manaProblem(value);
            return bad ? ignore(raw, `Unknown mana symbols “${bad}”.`) : {};
        }
        case "is": case "not":
            return words.is.has(v) ? {} : ignore(raw, `Checking if cards are “${cut(v)}” is not supported`);
        case "has":
            return HAS_WORDS.has(v) ? {} : ignore(raw, `Checking if cards are “${cut(v)}” is not supported`);
        // (keywords: takes anything)
        case "kw": case "keyword":
            if (!words.keywords.has(v)) return ignore(raw, `Unknown keyword “${cut(v)}”`);
            // known whatever the case, but kw:Flying finds nothing where kw:flying finds every flier
            return value === v ? {} : { as: NOTHING };
        case "r": case "rarity":
            return RARITY_WORDS.has(v) ? {} : ignore(raw, `Unknown rarity “${cut(v)}.”`);
        case "new":
            return NEW_WORDS.has(v) ? {} : ignore(raw, `Checking if cards have a new “${cut(v)}” is not supported`);
        case "st": case "settype": case "set_type":
            return words.setTypes.has(SET_TYPE_NAMES[v.replace(/_/g, "")] ?? v) ? {} : ignore(raw, `Unknown set type “${cut(v)}”`);
        case "f": case "format": case "legal":
            if (FORMAT_NAMES[v]) return { as: raw.replace(/:.*$|=.*$/, "") + t.op + FORMAT_NAMES[v] };
            return words.formats.has(v) ? {} : ignore(raw, `Unknown game format “${cut(v)}”`);
        case "banned": case "restricted":
            return words.formats.has(v) ? {} : ignore(raw, `Unknown constructed format “${cut(v)}”`);
        case "game":
            if (v === "mtga") return { as: (negated ? "-" : "") + "game:arena" };
            return words.games.has(v) ? {} : ignore(raw, `Unknown game \`${cut(v)}\``);
        case "lang": case "language":
            if (!words.langs.has(v) && v !== "any" && !LANGUAGE_NAMES.has(v)) return ignore(raw, `Unknown language \`${cut(v)}\``);
            // printings in other languages are in all_cards, which the engine doesn't load
            throw new Unsupported(`${key}:${value}`);
        case "frame":
            if (FRAME_WORDS.has(v)) throw new Unsupported(`frame:${v}`);
            return words.frames.has(v) ? {} : ignore(raw, `Unknown frame “${cut(v)}”`);
        case "stamp":
            return words.stamps.has(v) ? {} : ignore(raw, `Unknown security stamp “${cut(v)}”`);
        case "cheapest":
            return ["usd", "eur", "tix"].includes(v) ? {} : ignore(raw, `Unknown currency “${cut(v)}”`);
        case "date":
            if (words.sets.has(v)) return {};
            // date>=2020 is known; the engine takes whole dates only
            if (/^\d{4}(-\d{2})?$/.test(v)) throw new Unsupported(`date ${v}`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return ignore(raw, `Invalid date or unknown set code “${cut(v)}”`);
            // a date that doesn't exist: date>2020-13-45
            const day = new Date(`${v}T00:00:00Z`);
            return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(v) ? {} : ignore(raw, `Invalid date “${cut(v)}”`);
        case "oracleid": case "oracle_id": case "illustrationid": case "scryfallid": case "scryfall_id":
            return UUID.test(value) ? {} : ignore(raw, "You must provide a valid v4 UUID.");
        // (sic)
        case "tcgplayerid":
            return /^\d+$/.test(value) ? {} : ignore(raw, "You must provide a vaid interger");
    }
    if (NUMBER_KEYS.has(key) && !NUMBER.test(value) && !/^(even|odd|\*)$/i.test(value) && !NUMBER_KEYS.has(v)) return { as: NOTHING };
    return {};
}

// the mana symbols Scryfall doesn't know in m:/devotion:, run together as it names them (m:qk is “QK”), or undefined
function manaProblem(value: string): string | undefined {
    let bad = "";
    for (const m of value.matchAll(/\{([^}]*)\}|(\d+)|([^{}\d])/g)) {
        if (m[2]) continue;
        const sym = (m[1] ?? m[3]).toUpperCase();
        if (m[1] !== undefined ? sym.split("/").every((part) => /^(\d+|[WUBRGCXYZSPHE]|½|∞)$/.test(part)) : /^[WUBRGCXYZSPHE]$/.test(sym)) continue;
        // with its braces when it had them: m:{q}{k} is “{Q}{K}”
        bad += m[1] !== undefined ? `{${sym}}` : sym;
    }
    return bad || undefined;
}

// frame: and lang: words Scryfall knows beyond the bulk file's (found by asking it)
const FRAME_WORDS = new Set(["old", "new", "modern"]);
const LANGUAGE_NAMES = new Set(["english", "spanish", "french", "german", "italian", "portuguese", "japanese", "korean", "russian", "chinese"]);

// keys that take a regex
const REGEX_KEYS = new Set(["o", "oracle", "fo", "fulloracle", "t", "type", "name", "ft", "flavor", "flavortext"]);
// keys that don't: kw:/fly/, s:/tsp/ and a:/miracola/ are an "Unknown regular expression keyword". What the rest
// make of one (t:sliver c:/w/ finds 35) isn't known, so they're left to Scryfall
const NO_REGEX_KEYS = new Set(["kw", "keyword", "s", "e", "set", "edition", "a", "artist"]);
// keys that compare with < > <= >= (and !=)
const COMPARE_KEYS = new Set([...NUMBER_KEYS, "cn", "number", "c", "color", "colors", "id", "identity", "ci", "commander", "produces", "r", "rarity",
    "m", "mana", "devotion", "date"]);
const NOT_EQUAL_KEYS = new Set<string>([]);

// why Postgres (Scryfall's database) refuses a regex, in its words, by what JavaScript makes of it
function regexProblem(body: string): string | undefined {
    try { new RegExp(body); return undefined; } catch (e) {
        const m = (e as Error).message;
        if (/Unterminated group|Unmatched '\)'/.test(m)) return "parentheses () not balanced";
        if (/Unterminated character class/.test(m)) return "brackets [] not balanced";
        if (/Nothing to repeat/.test(m)) return "quantifier operand invalid";
        throw new Unsupported(`regex ${body}: ${m}`);
    }
}

// formats by their other names: f:edh is Commander
const FORMAT_NAMES: Record<string, string> = { edh: "commander", pdh: "paupercommander", duelcommander: "duel" };

// set types as people type them, as the engine reads them
const SET_TYPE_NAMES: Record<string, string> = { draftinnovation: "draft_innovation", duel: "duel_deck", duels: "duel_deck", fromthevault: "from_the_vault", ftv: "from_the_vault", premium: "premium_deck", treasure: "treasure_chest" };

// is: values Scryfall knows besides those the engine does (isValues): an unknown one warns "Checking if cards are …
// is not supported". Found by asking Scryfall about each
const IS_WORDS = new Set<string>([
    "adventure", "alchemy", "arenaleague", "art_series", "atypical", "augment", "battlebondland", "battleland",
    "bbdland", "bear", "beginnerbox", "bicycleland", "bikeland", "bondland", "booster", "boosterfun", "borderless",
    "bounceland", "boxtopper", "brawldeck", "brawler", "bringafriend", "bundle", "buyabox", "canland", "canopyland",
    "checkland", "chocobotrackfoil", "class", "colorshifted", "commander", "commanderparty", "commanderpromo",
    "companion", "concept", "confettifoil", "convention", "cosmicfoil", "creatureland", "crowdland", "cycleland",
    "datestamped", "dazzlefoil", "default", "dfc", "digital", "dossier", "double_faced", "doubleexposure",
    "doublefaced", "doublerainbow", "draculaseries", "draftweekend", "dragonscalefoil", "dual", "duels", "embossed",
    "etched", "event", "extended", "extendedart", "facetfoil", "fastland", "fetchland", "ffi", "ffii", "ffiii",
    "ffiv", "ffix", "ffv", "ffvi", "ffvii", "ffviii", "ffx", "ffxi", "ffxii", "ffxiii", "ffxiv", "ffxv", "ffxvi",
    "filterland", "firstplacefoil", "firstprint", "firstprinting", "flip", "fnm", "foil", "fracturefoil",
    "frenchvanilla", "front_card", "full", "fullart", "funny", "future", "gainland", "galaxyfoil", "gamechanger",
    "gameday", "giftbox", "gilded", "gleaminggold", "glossy", "godzillaseries", "halofoil", "headliner", "hires",
    "historic", "horizonland", "host", "hybrid", "imagine", "instore", "intro", "intropack", "invisibleink",
    "japanshowcase", "jpwalker", "judge", "judgegift", "karoo", "league", "leveler", "magnified", "manafoil",
    "manland", "masterpiece", "mdfc", "mediainsert", "meld", "meldpart", "meldresult", "metal", "modal", "modal_dfc",
    "modern", "moonlitland", "neonink", "new", "nonfoil", "normal", "oilslick", "old", "openhouse", "outlaw",
    "oversized", "painland", "partner", "party", "pathway", "permanent", "phyrexian", "planar", "planeswalkerdeck",
    "plastic", "playerrewards", "playpromo", "playtest", "portrait", "poster", "premiereshop", "prepare",
    "prerelease", "promo", "promopack", "pwdeck", "rainbowfoil", "raisedfoil", "ravnicacity", "rebalanced",
    "release", "reprint", "resale", "reserved", "reversible", "ripplefoil", "schinesealtart", "scroll",
    "scryfallpreview", "scryland", "serialized", "setextension", "setpromo", "shadowland", "shockland", "showcase",
    "silverfoil", "silverscroll", "singularityfoil", "sldbonus", "slowland", "snarl", "sourcematerial", "spell",
    "spellbook", "split", "spotlight", "stamped", "standardshowdown", "startercollection", "starterdeck",
    "stepandcompleat", "storageland", "storechampionship", "surgefoil", "surveilland", "tangoland", "tdfc",
    "textless", "textured", "themepack", "thick", "token", "tombstone", "tourney", "transform", "tricycleland",
    "trikeland", "triland", "triome", "ub", "unique", "universesbeyond", "upsidedown", "upsidedownback", "vanguard",
    "vanilla", "vault", "wizardsplaynetwork"
]);
// (has: warns in the same words as is:)
const HAS_WORDS = new Set([
    "artist", "etched", "flavor", "flavor_name", "flavorname", "foil", "hires", "illustration", "image", "indicator",
    "nonfoil", "promo", "reprint", "securitystamp", "stamp", "watermark"
]);

const UNDERSCORE_KEYS: Record<string, string> = { set_type: "settype", flavor_text: "flavor", oracle_tag: "oracletag", art_tag: "arttag" };

// keys that say how to show the results, not which cards: not allowed in brackets. Only with : or = ("order>cmc"
// is a word of a name)
const isDisplay = (t: Token) => DISPLAY_KEYS.has(t.key!) && (t.op === ":" || t.op === "=");
// keys that say how to show the results
const DISPLAY_KEYS = new Set(["unique", "order", "sort", "direction", "dir", "display", "prefer", "include"]);
// every key Scryfall knows, found by asking it about each: an unknown one warns "Unknown keyword"
const KNOWN_KEYS = new Set(["c", "color", "colors", "id", "identity", "ci", "commander", "t", "type", "o", "oracle", "fo", "fulloracle",
    "m", "mana", "mv", "cmc", "manavalue", "devotion", "produces", "pow", "power", "tou", "toughness", "pt", "powtou", "loy", "loyalty",
    "is", "not", "has", "kw", "keyword", "keywords", "r", "rarity", "new", "in", "s", "e", "set", "edition", "cn", "number", "collector",
    "collectornumber", "b", "block", "st", "settype", "set_type", "f", "format", "legal", "banned", "restricted", "game", "year", "date",
    "usd", "eur", "tix", "cheapest", "a", "artist", "artists", "ft", "flavor", "flavortext", "flavor_text", "wm", "watermark", "border",
    "frame", "stamp", "lang", "language", "prints", "sets", "paperprints", "papersets", "otag", "oracletag", "oracle_tag", "function",
    "atag", "arttag", "art_tag", "art", "name", "edhrec", "edhrecrank", "cube", "spellbook", "illustrations", "oracleid", "oracle_id",
    "illustrationid", "scryfallid", "scryfall_id", "layout", "mtgoid", "mtgo_id", "multiverseid", "arenaid", "tcgplayerid", "lore"]);

// a display option in the search (order:, unique:, direction:, include:, display:, prefer:), kept in `display`; a
// value Scryfall doesn't know is ignored with a warning of its own, not "Invalid expression"
function displayOption(t: Token, display: Display): Verdict {
    const v = t.value!.toLowerCase();
    const unknown = (what: string): Verdict => ({ as: DROPPED, warning: `Unknown ${what} “${cut(t.value!)}” was ignored` });
    switch (t.key) {
        // (order:mv is order:cmc)
        case "order": case "sort": if (!ORDER_VALUES.has(ORDER_NAMES[v] ?? v)) return unknown("order choice"); display.order = ORDER_NAMES[v] ?? v; break;
        // unique:arts is unique:art (unique:print isn't prints)
        case "unique": { const u = v === "arts" ? "art" : v; if (!UNIQUE_VALUES.has(u)) return unknown("unique mode"); display.unique = u; break; }
        // direction:up and down are asc and desc (next_page says dir=desc)
        case "direction": case "dir": { const d = { up: "asc", down: "desc" }[v] ?? v; if (!DIR_VALUES.has(d)) return unknown("direction choice"); display.dir = d; break; }
        // (Scryfall calls a bad include: a direction too)
        // include:all is include:extras
        case "include": if (v !== "extras" && v !== "all") return unknown("direction choice"); display.extras = true; break;
        case "display": if (!["grid", "checklist", "text", "full"].includes(v)) return unknown("display mode"); break;
        case "prefer": if (!PREFER_VALUES.has(v)) return unknown("preference mode"); display.prefer = v; break;
    }
    return { as: DROPPED };
}
const PREFER_VALUES = new Set(["oldest", "newest", "usd-low", "usd-high", "eur-low", "eur-high", "tix-low", "tix-high", "promo", "default", "atypical", "ub", "notub"]);

// ---- the cards ----

// the printings Scryfall lists, in its order: a card each, a printing each (unique=prints) or an art each
// (unique=art), with the printing each card is shown with, all from the engine (see results in local-search.ts)
function entries(node: Node, data: Cards, how: { order: string, dir: string, unique: string, extras: boolean }): number[] {
    const full: Node = how.extras ? { and: [{ term: { key: "include", op: ":", value: "extras" } }, node] } : node;
    return results(full, data, { order: how.order, dir: how.dir, unique: how.unique });
}
