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
import { Unsupported, isValues, parse, searchPrintings, sortCards, type Cards, type Node } from "./local-search.ts";

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

export async function cardsSearch(data: Cards, params: SearchParams, options: ApiOptions): Promise<ApiResponse> {
    const base = options.base ?? "https://api.scryfall.com/";
    const q = (params.q ?? "").trim();
    if (!q) return badRequest(NOTHING_TO_SEARCH);
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
        if (e instanceof Unsupported && e.message === "every term is one Scryfall ignores") {
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
    if (page < pages) body.next_page = nextPage(base, { q, page: page + 1, order, unique, dir, params });
    if (warnings.length) body.warnings = warnings;
    body.data = await Promise.all(listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => options.card(p)));
    return { status: 200, body };
}

// next_page as Scryfall writes it: its parameters in alphabetical order, the search trimmed, order and unique as
// used (the search's own order: and unique: win), dir only when it's asc or desc, and format always json
function nextPage(base: string, { q, page, order, unique, dir, params }: { q: string, page: number, order: string, unique: string, dir: string, params: SearchParams }) {
    const p = new URLSearchParams();
    if (dir === "asc" || dir === "desc") p.set("dir", dir);
    p.set("format", "json");
    p.set("include_extras", String(flag(params.include_extras)));
    p.set("include_multilingual", String(flag(params.include_multilingual)));
    p.set("include_variations", String(flag(params.include_variations)));
    p.set("order", order);
    p.set("page", String(page));
    p.set("q", q);
    p.set("unique", unique);
    return `${base}cards/search?${p}`;
}

// ---- reading the search ----

type Token = { kind: "(" | ")" | "-" | "or" | "and" | "word" | "term", start: number, end: number, key?: string, op?: string, value?: string, regex?: boolean };
const OPS = ["<=", ">=", "!=", ":", "=", "<", ">"];

// the search in pieces, where each starts and ends, read the way the engine's tokenize reads it
function scan(q: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    const quotedEnd = (at: number) => { const end = q.indexOf("\"", at + 1); return end < 0 ? q.length : end + 1; };
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
        const key = /^[a-z_]+/i.exec(q.slice(i))?.[0] ?? "";
        const op = key ? OPS.find((o) => q.startsWith(o, i + key.length)) : undefined;
        if (key && op) {
            let j = i + key.length + op.length, regex = false, value: string;
            if (q[j] === "/") {
                let end = j + 1;
                while (end < q.length && q[end] !== "/") end += q[end] === "\\" ? 2 : 1;
                value = q.slice(j + 1, end);
                regex = true;
                j = Math.min(end + 1, q.length);
            } else if (q[j] === "\"") {
                const end = quotedEnd(j);
                value = q.slice(j + 1, q[end - 1] === "\"" && end - 1 > j ? end - 1 : end);
                j = end;
            } else {
                value = /^[^\s()]*/.exec(q.slice(j))![0];
                j += value.length;
            }
            out.push({ kind: "term", start: i, end: j, key: key.toLowerCase(), op, value, regex });
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
    // brackets first: an unclosed or unopened one fails the whole search, before anything else is read
    let depth = 0;
    for (const t of tokens) {
        if (t.kind === "(") depth++;
        if (t.kind === ")" && --depth < 0) return { error: UNCLOSED, warnings: [] };
    }
    if (depth) return { error: UNCLOSED, warnings: [] };
    const warnings: string[] = [], display: Display = { extras: false };
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
        if (t.kind !== "term") continue;
        const negated = tokens[n - 1]?.kind === "-" && tokens[n - 1].end === t.start;
        const start = negated ? tokens[n - 1].start : t.start;
        let verdict: Verdict;
        if (DISPLAY_KEYS.has(t.key!)) {
            // "t:sliver (order:cmc)" is a 400
            if (depth > 0) return { error: DISPLAY_IN_BRACKETS, warnings: [] };
            verdict = displayOption(t, display);
        } else verdict = judge(t, negated, q.slice(start, t.end), words);
        if (verdict.warning) warnings.push(verdict.warning);
        if (verdict.as === undefined) continue;
        out += q.slice(at, start) + verdict.as;
        at = t.end;
    }
    return { rewritten: out + q.slice(at), warnings, display };
}

// a term the engine drops (see parse), and one that matches no card
const DROPPED = "-mv>=0";
const NOTHING = "!\"\u0001\"";
const invalid = (raw: string, why: string) => `Invalid expression “${cut(raw)}” was ignored. ${why}`;
// what a warning quotes is cut short past 20 characters, "…" the 20th: “is:abcdefghijklmnopq” stays, but
// “is:abcdefghijklmnopqr” is “is:abcdefghijklmnop…”. A key is cut at 21: “abcdefghijklmnopqrst…”
const cut = (s: string, n = 20) => s.length > n ? `${s.slice(0, n - 1)}…` : s;

type Verdict = { as?: string, warning?: string };
const ignore = (raw: string, why: string): Verdict => ({ as: DROPPED, warning: invalid(raw, why) });

// the words some keys take, from the cards themselves: every keyword a card has, every format, frame, stamp…
type Words = { keywords: Set<string>, formats: Set<string>, frames: Set<string>, stamps: Set<string>, games: Set<string>, langs: Set<string>, setTypes: Set<string>, sets: Set<string>, is: Set<string> };
const vocabularies = new WeakMap<Cards, Words>();
function vocabulary(data: Cards): Words {
    let w = vocabularies.get(data);
    if (w) return w;
    w = { keywords: new Set(), formats: new Set(), frames: new Set(), stamps: new Set(), games: new Set(), langs: new Set(), setTypes: new Set(), sets: new Set(data.setDates.keys()), is: new Set([...isValues(data), ...IS_WORDS]) };
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
    const key = t.key!, value = t.value!, v = value.toLowerCase();
    // a minus before a number comparison (see MINUS_DROPPED): -mv>=3, -pow<2 and the like are dropped without a
    // word, and the engine does that. With = or : Scryfall says why: for mana value the value's wrong ("-mv=3",
    // "-mv:zzqx"), for the others the key is unknown, minus and all (“-pow”), and for cn it's kept
    if (negated && MINUS_DROPPED.has(key) && !t.regex && !/^(even|odd)$/i.test(value)) {
        if (t.op !== "=" && t.op !== ":") return {};
        if (["mv", "cmc", "manavalue"].includes(key)) return ignore(raw, "The value must be a number, or “even”/“odd”");
        if (["cn", "number"].includes(key)) return {};
        return ignore(raw, `Unknown keyword “${cut(`-${key}`, 21)}”.`);
    }
    // an unknown key with a minus is unknown with it: -foo:bar is “-foo”
    if (!KNOWN_KEYS.has(key)) return ignore(raw, `Unknown keyword “${cut(negated ? `-${key}` : key, 21)}”.`);
    // the engine reads a key as letters only, so set_type:… would be a word of a name there: it gets its other name,
    // or isn't supported
    if (key.includes("_")) {
        const alias = UNDERSCORE_KEYS[key];
        if (!alias) throw new Unsupported(`${key}:`);
        const verdict = judge({ ...t, key: alias }, negated, raw, words);
        return verdict.as !== undefined ? verdict : { as: (negated ? "-" : "") + alias + raw.slice(raw.indexOf(t.op!, negated ? 1 : 0)) };
    }
    if (t.regex) return {};
    switch (key) {
        case "c": case "color": case "colors": case "id": case "identity": case "ci": case "commander": case "produces": {
            if (/^\d+$/.test(v) || COLOR_NAMES.has(v)) return {};
            const letters = [...new Set(v)].sort();
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
            return words.is.has(v) ? {} : ignore(raw, `Checking if cards are “${cut(value)}” is not supported`);
        case "has":
            return HAS_WORDS.has(v) ? {} : ignore(raw, `Checking if cards are “${cut(value)}” is not supported`);
        case "kw": case "keyword": case "keywords":
            return words.keywords.has(v) ? {} : ignore(raw, `Unknown keyword “${cut(value)}”`);
        case "r": case "rarity":
            return RARITY_WORDS.has(v) ? {} : ignore(raw, `Unknown rarity “${cut(value)}.”`);
        case "new":
            return NEW_WORDS.has(v) ? {} : ignore(raw, `Checking if cards have a new “${cut(value)}” is not supported`);
        case "st": case "settype": case "set_type":
            return words.setTypes.has(SET_TYPE_NAMES[v.replace(/_/g, "")] ?? v) ? {} : ignore(raw, `Unknown set type “${cut(value)}”`);
        case "f": case "format": case "legal":
            return words.formats.has(v) ? {} : ignore(raw, `Unknown game format “${cut(value)}”`);
        case "banned": case "restricted":
            return words.formats.has(v) ? {} : ignore(raw, `Unknown constructed format “${cut(value)}”`);
        case "game":
            return words.games.has(v) ? {} : ignore(raw, `Unknown game \`${value}\``);
        case "lang": case "language":
            if (!words.langs.has(v) && v !== "any") return ignore(raw, `Unknown language \`${value}\``);
            // printings in other languages are in all_cards, which the engine doesn't load
            throw new Unsupported(`${key}:${value}`);
        case "frame":
            return words.frames.has(v) ? {} : ignore(raw, `Unknown frame “${cut(value)}”`);
        case "stamp":
            return words.stamps.has(v) ? {} : ignore(raw, `Unknown security stamp “${cut(value)}”`);
        case "cheapest":
            return ["usd", "eur", "tix"].includes(v) ? {} : ignore(raw, `Unknown currency “${cut(value)}”`);
        case "date":
            return /^\d{4}-\d{2}-\d{2}$/.test(v) || words.sets.has(v) ? {} : ignore(raw, `Invalid date or unknown set code “${cut(value)}”`);
        case "oracleid": case "oracle_id": case "illustrationid": case "scryfallid": case "scryfall_id":
            return UUID.test(value) ? {} : ignore(raw, "You must provide a valid v4 UUID.");
        // (sic)
        case "tcgplayerid":
            return /^\d+$/.test(value) ? {} : ignore(raw, "You must provide a vaid interger");
    }
    if (NUMBER_KEYS.has(key) && !NUMBER.test(value) && !/^(even|odd|\*)$/i.test(value) && !NUMBER_KEYS.has(v)) return { as: NOTHING };
    return {};
}

// the first mana symbol Scryfall doesn't know in m:/devotion:, as it names it (capitals), or undefined
function manaProblem(value: string): string | undefined {
    for (const m of value.matchAll(/\{([^}]*)\}|(\d+)|([^{}\d])/g)) {
        if (m[2]) continue;
        const sym = (m[1] ?? m[3]).toUpperCase();
        if (m[1] !== undefined ? sym.split("/").every((part) => /^(\d+|[WUBRGCXYZSPHE]|½|∞)$/.test(part)) : /^[WUBRGCXYZSPHE]$/.test(sym)) continue;
        return sym;
    }
    return undefined;
}

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

// keys that say how to show the results, not which cards: not allowed in brackets
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
        case "order": case "sort": if (!ORDER_VALUES.has(v)) return unknown("order choice"); display.order = v; break;
        case "unique": if (!UNIQUE_VALUES.has(v)) return unknown("unique mode"); display.unique = v; break;
        case "direction": case "dir": if (!DIR_VALUES.has(v)) return unknown("direction choice"); display.dir = v; break;
        // (Scryfall calls a bad include: a direction too)
        case "include": if (v !== "extras") return unknown("direction choice"); display.extras = true; break;
        case "display": if (!["grid", "checklist", "text", "full"].includes(v)) return unknown("display mode"); break;
        case "prefer": if (!PREFER_VALUES.has(v)) return unknown("preference mode"); display.prefer = v; break;
    }
    return { as: DROPPED };
}
const PREFER_VALUES = new Set(["oldest", "newest", "usd-low", "usd-high", "eur-low", "eur-high", "tix-low", "tix-high", "promo", "default", "atypical", "ub", "notub"]);

// ---- the cards ----

// the printings Scryfall lists, in its order: a card each, a printing each (unique=prints) or an art each
// (unique=art). This is where the engine's choice of printing and order comes in
function entries(node: Node, data: Cards, how: { order: string, dir: string, unique: string, extras: boolean }): number[] {
    const terms: Node[] = [
        { term: { key: "order", op: ":", value: how.order } },
        { term: { key: "direction", op: ":", value: how.dir } },
        ...(how.extras ? [{ term: { key: "include", op: ":", value: "extras" } }] : []),
    ];
    const full: Node = { and: [...terms, node] };
    const prints = searchPrintings(full, data);
    const byCard = new Map<number, number[]>();
    for (const p of prints) {
        const c = data.prints[p].card;
        byCard.set(c, [...(byCard.get(c) ?? []), p]);
    }
    const cards = sortCards(full, data, [...byCard.keys()]);
    return cards.flatMap((c) => pick(byCard.get(c)!, data, how.unique));
}

// which of a card's matching printings are listed. A stand-in until the engine has its own: newest first, a
// card's special printings (promos, Secret Lair, The List…) after the rest
const SPECIAL_SETS = new Set(["box", "premium_deck", "alchemy", "from_the_vault", "masterpiece", "spellbook"]);
function pick(prints: number[], data: Cards, unique: string): number[] {
    const special = (i: number) => { const p = data.prints[i]; return p.promo || SPECIAL_SETS.has(p.setType) || p.set === "plst" || [...p.games].every((g) => g === "arena"); };
    const cn = (i: number) => Number(data.prints[i].cn.replace(/\D/g, "")) || 0;
    const sorted = [...prints].sort((a, b) => Number(special(a)) - Number(special(b)) || data.prints[b].released.localeCompare(data.prints[a].released) || cn(a) - cn(b));
    if (unique === "prints") return sorted;
    if (unique === "art") {
        const seen = new Set<string>();
        return sorted.filter((i) => { const art = data.prints[i].art || String(i); return !seen.has(art) && !!seen.add(art); });
    }
    return sorted.slice(0, 1);
}
