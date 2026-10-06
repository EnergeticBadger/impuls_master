// A local copy of Scryfall's card search, run over its bulk files, so the search can be tested in minutes
// without the API. Every printing is loaded (default_cards), and like Scryfall a card matches when one of its
// printings matches the whole search: `r:mythic s:m21` needs a printing that's both, not a mythic in some set
// and a printing in M21. Rules-text keys are tested once per card; printing keys once per printing.
// What it covers is listed in KEYS below; anything else throws Unsupported, so a test can skip it rather
// than get it wrong. npm run test-syntax compares it with Scryfall, search by search.
// What it can't tell you is what Scryfall itself drops, refuses or is slow on: those are Scryfall's limits,
// checked by scripts/fuzz-rules.ts.
// Like Scryfall's, a regex here never crosses a line break (see scryfallRegex).

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { join } from "node:path";

const HEADERS = { "User-Agent": "impuls_master-tests/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };

export class Unsupported extends Error {}

// one card: what every printing of it shares
export type LocalCard = {
    oracleId: string,
    name: string,
    faceNames: string[],
    // rules text as o: sees it, a face each, reminder text left out: as printed, and with the card's own name
    // as ~ for a search with ~ in it
    printed: string[],
    text: string[],
    // as fo: sees it: reminder text kept
    fullPrinted: string[],
    fullText: string[],
    // type line a face each, lower case
    faceTypes: string[],
    types: string,
    layout: string,
    // a face each: Cecil // Cecil is black then white, not multicolour
    faceColors: Set<string>[],
    identity: Set<string>,
    indicator: boolean,
    legal: Set<string>,
    banned: Set<string>,
    restricted: Set<string>,
    keywords: Set<string>,
    mv: number,
    // a face each, so m=1R finds Fire // Ice by Fire's cost
    manaCosts: string[],
    // a face each, undefined where a face has none
    power: (string | undefined)[],
    toughness: (string | undefined)[],
    loyalty: (string | undefined)[],
    produced: Set<string>,
    edhrec?: number,
    reserved: boolean,
    gameChanger: boolean,
    // a meld card's part in it: "part" (Bruna, the Fading Light) or "result" (Brisela, Voice of Nightmares)
    meld: "" | "part" | "result",
    // is:funny: see FUNNY_CARDS
    funny: boolean,
    printings: number[],
};

// one printing: what's particular to it
export type Printing = {
    card: number,
    // a reversible printing has its own name ("Birds of Paradise // Birds of Paradise") and layout
    name: string,
    layout: string,
    set: string,
    setType: string,
    block: string,
    rarity: string,
    artist: string,
    released: string,
    usd?: number,
    eur?: number,
    tix?: number,
    frame: string,
    frameEffects: Set<string>,
    border: string,
    games: Set<string>,
    cn: string,
    lang: string,
    promo: boolean,
    promoTypes: Set<string>,
    digital: boolean,
    fullArt: boolean,
    textless: boolean,
    reprint: boolean,
    spotlight: boolean,
    oversized: boolean,
    // in booster packs, and with a high-resolution scan
    booster: boolean,
    hires: boolean,
    finishes: Set<string>,
    watermark: string,
    // a face each, "" where a face has none
    flavor: string[],
    stamp: string,
    // why it isn't shown unless asked for (see revealed): "withdrawn" (the cards banned in 2020 for racist
    // content) or "extra" (tokens, art cards, playtest cards…); "" is shown
    extra: "" | "withdrawn" | "extra",
};

// printings Scryfall's search doesn't show by default (found by comparing with it, see npm run test-syntax):
// these layouts and memorabilia (but not dungeons), tokens, "Card"s, Alchemy's specialize variants (in Alchemy
// sets but legal nowhere), Astral and Sega printings, playtest cards, Heroes of the Realm and holiday promos, Gleemox ("This card is banned.") and Secret Lair's sticker sheet.
// The seven cards Wizards banned in 2020 for racist content are hidden even from a search by name
const WITHDRAWN = new Set(["Crusade", "Cleanse", "Imprison", "Invoke Prejudice", "Jihad", "Pradesh Gypsies", "Stone-Throwing Devils"]);
const HIDDEN_FUNNY = new Set(["Gleemox", "Sticker sheet"]);
// is:funny though nothing in the bulk files says so (see isFunnyPrinting)
const FUNNY_CARDS = new Set([...HIDDEN_FUNNY, "Baldur's Gate Wilderness"]);
const EXTRA_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "planar", "scheme", "vanguard"]);
const EXTRA_SETS = /^(ph\d\d|phtr|hho|h17|pcel)$/;
function extraKind(c: any): Printing["extra"] {
    const games: string[] = c.games ?? [];
    const type: string = c.type_line ?? c.card_faces?.[0]?.type_line ?? "";
    const legalNowhere = !Object.values(c.legalities ?? {}).some((v) => v === "legal" || v === "restricted");
    if (WITHDRAWN.has(c.name)) return "withdrawn";
    // dungeons are shown, even Undercity // The Initiative, a double-faced token
    const dungeon = /^dungeon\b/i.test(type);
    if ((EXTRA_LAYOUTS.has(c.layout) && !dungeon) || /^(token|card)\b/i.test(type) || (c.set_type === "memorabilia" && !dungeon)
        || (c.set_type === "alchemy" && legalNowhere) || (games.length > 0 && games.every((g) => g === "astral" || g === "sega"))) return "extra";
    if (c.promo_types?.includes("playtest") || EXTRA_SETS.test(c.set) || HIDDEN_FUNNY.has(c.name)) return "extra";
    return "";
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// ~ in a search, plain or regex, against text with the card's names as ~ (see cardText): the card by name, or
// "this" and a card type or subtype the card calls itself by, but not "this turn", "this way", "this scheme",
// "this Case" or "this Room". Oracle text now says "Destroy this enchantment" where it said "Destroy Aether
// Storm", and o:/destroy ~/ finds both
const THIS_WORDS = "creature|artifact|enchantment|land|planeswalker|battle|spell|card|permanent|token|aura|equipment|vehicle|saga|siege|class|contraption|attraction|spacecraft";
const SELF = `(?:~|this (?:${THIS_WORDS})\\b)`;

// Scryfall fails a whole group with ~ as one of its options when \b follows it: `untap (this|~)\b` matches
// nothing there, not even "untap this creature". Returns the regex with each such group made to match nothing
export function failTildeGroups(re: string): string {
    const open: number[] = [];
    for (let i = 0; i < re.length; i++) {
        if (re[i] === "\\") { i++; continue; }
        if (re[i] === "(") open.push(i);
        else if (re[i] === ")") {
            const start = open.pop() ?? 0;
            if (re.slice(start + 1, i).split("|").includes("~") && re.startsWith("\\b", i + 1)) {
                return failTildeGroups(re.slice(0, start) + "(?!)" + re.slice(i + 1));
            }
        }
    }
    return re;
}

// A Scryfall regex as JavaScript reads it. Scryfall's never cross a line break: . and [^…] don't match one,
// and ^ $ match at each line, so `choose one —[^.]*exile` misses "choose one —\n• Exile" there. ~ is SELF,
// and see failTildeGroups
export function scryfallRegex(regex: string): RegExp {
    const body = failTildeGroups(regex);
    let out = "", inClass = false;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "\\") { out += body.slice(i, i + 2); i++; continue; }
        if (inClass) { if (ch === "]") inClass = false; out += ch; continue; }
        if (ch === "[") {
            inClass = true;
            // a negated class leaves out line breaks too
            if (body[i + 1] === "^") { out += "[^\\n"; i++; continue; }
            out += ch;
            continue;
        }
        out += ch === "." ? "[^\\n]" : ch === "~" ? SELF : ch;
    }
    return new RegExp(out, "im");
}

// a card's rules text a face each, as o: sees it (reminder text left out) and as fo: does (kept): as printed,
// and with the card's own name as ~. Scryfall matches a search without ~ against the printed text, so
// o:"fire deals" finds Banefire. Takes a card as Scryfall's API and bulk files give it
export function cardText(c: any): { printed: string[], text: string[], fullPrinted: string[], fullText: string[] } {
    const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
    const fullName: string = c.name;
    // the card's names, longest first, become ~: the whole name, each face's, and a legend's short name
    // ("Baxter" in "Baxter, Fly in the Ointment", "Círdan" in "Círdan the Shipwright")
    const own: string[] = [fullName, ...faces.map((f) => f.name)];
    const legend = /legendary/i.test(c.type_line ?? faces[0]?.type_line ?? "");
    const short = own.flatMap((n) => [n.split(",")[0], ...(legend ? [n.split(/ (?:the|of) /)[0]] : [])]);
    // ("MJ" counts; a name with a dot in it doesn't: J. Jonah Jameson stays, but Nick Fury, Agent of
    // S.H.I.E.L.D. is Nick Fury). Right for 2,087 of the 2,099 legends their text names only partly; the rest
    // are first names (Ryan, Zurgo) Scryfall seems to pick by hand
    const names = [...new Set([...own, ...short])].filter((n) => n && n.length > 1 && !n.includes(".")).sort((a, b) => b.length - a.length);
    // as whole words, so Khaaaaaaaaaaaannn!'s name, ending in "!", stays as it is
    const self = names.length ? new RegExp(`\\b(?:${names.map(escapeRe).join("|")})\\b`, "g") : null;
    const raw = faces.map((f) => (f.oracle_text ?? c.oracle_text ?? "") as string);
    const tilde = (t: string) => self ? t.replace(self, "~") : t;
    const printed = raw.map((t) => t.replace(/ ?\([^)]*\)/g, ""));
    return { printed, text: printed.map(tilde), fullPrinted: raw, fullText: raw.map(tilde) };
}

const lower = (list?: string[]) => new Set((list ?? []).map((l) => l.toLowerCase()));
const price = (v?: string | null) => v == null ? undefined : Number(v);

function toCard(c: any, faces: any[]): Omit<LocalCard, "printings" | "funny"> {
    const legal = (want: string[]) => new Set(Object.entries(c.legalities ?? {}).filter(([, v]) => want.includes(v as string)).map(([k]) => k));
    const each = (field: string) => faces.map((f) => (f[field] ?? (faces.length === 1 ? c[field] : undefined)) as string | undefined);
    return {
        oracleId: c.oracle_id ?? faces[0]?.oracle_id,
        name: c.name,
        faceNames: faces.map((f) => f.name ?? c.name),
        ...cardText(c),
        faceTypes: faces.map((f) => (f.type_line ?? c.type_line ?? "").toLowerCase()),
        types: (c.type_line ?? faces.map((f) => f.type_line).join(" // ")).toLowerCase(),
        layout: c.layout,
        faceColors: faces.map((f) => lower(f.colors ?? c.colors)),
        identity: lower(c.color_identity),
        indicator: !!(c.color_indicator ?? faces.some((f) => f.color_indicator)),
        legal: legal(["legal", "restricted"]),
        banned: legal(["banned"]),
        restricted: legal(["restricted"]),
        keywords: lower(c.keywords),
        // a reversible printing keeps these on its faces only
        mv: c.cmc ?? faces[0]?.cmc ?? 0,
        // with more than two faces (Who // What // When // Where // Why), the whole cost counts too, so m:RG finds it
        manaCosts: faces.length > 1 ? [...faces.map((f) => f.mana_cost ?? ""), ...(faces.length > 2 ? [c.mana_cost ?? ""] : [])].filter(Boolean) : [c.mana_cost ?? ""],
        power: each("power"),
        toughness: each("toughness"),
        loyalty: each("loyalty"),
        produced: lower(c.produced_mana),
        edhrec: c.edhrec_rank,
        reserved: !!c.reserved,
        gameChanger: !!c.game_changer,
        meld: c.layout !== "meld" ? "" : c.all_parts?.some((p: any) => p.component === "meld_result" && p.name === c.name) ? "result" : "part",
    };
}

function toPrinting(c: any, faces: any[], card: number): Printing {
    return {
        card,
        name: c.name,
        layout: c.layout,
        set: c.set,
        setType: c.set_type,
        block: c.block_code ?? "",
        rarity: c.rarity,
        artist: c.artist ?? "",
        released: c.released_at ?? "",
        // the regular price, or the foil one when there's none
        usd: price(c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched),
        eur: price(c.prices?.eur ?? c.prices?.eur_foil),
        tix: price(c.prices?.tix),
        frame: c.frame ?? "",
        frameEffects: lower(c.frame_effects),
        border: c.border_color ?? "",
        games: lower(c.games),
        cn: c.collector_number ?? "",
        lang: c.lang ?? "en",
        promo: !!c.promo,
        promoTypes: lower(c.promo_types),
        digital: !!c.digital,
        fullArt: !!c.full_art,
        textless: !!c.textless,
        reprint: !!c.reprint,
        spotlight: !!c.story_spotlight,
        oversized: !!c.oversized,
        booster: !!c.booster,
        hires: !!c.highres_image,
        finishes: lower(c.finishes),
        watermark: (c.watermark ?? faces.find((f) => f.watermark)?.watermark ?? "").toLowerCase(),
        flavor: faces.map((f) => f.flavor_text ?? c.flavor_text ?? ""),
        stamp: c.security_stamp ?? "",
        extra: extraKind(c),
    };
}

// is:funny is a card's, not a printing's: a card legal nowhere with a printing in an Un-set (not the holiday
// promos), acorn-stamped, a playtest card or silver-bordered (not counting the tokens in tust and the like, so
// the Goblin token isn't funny but the Dragon from the h17 promo is, in every printing), plus FUNNY_CARDS.
// Steamflogger Boss's Unstable printing doesn't make it funny: it's legal. Checked against all 1,476 of
// Scryfall's
function isFunnyPrinting(c: any): boolean {
    return (c.set_type === "funny" && c.set !== "hho") || c.security_stamp === "acorn" || !!c.promo_types?.includes("playtest")
        || (c.border_color === "silver" && c.set_type !== "token");
}

async function* jsonLines(path: string) {
    const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) yield JSON.parse(line);
}

export type BulkType = "default_cards" | "oracle_tags";

// the bulk file of this type: from SCRYFALL_BULK_DIR (as <type>.jsonl.gz, like scripts/card-data.ts), or
// downloaded into `cache` and kept a day, since Scryfall rebuilds them daily
export async function bulkFile(type: BulkType, cache: string): Promise<string> {
    const local = process.env.SCRYFALL_BULK_DIR;
    if (local) return join(local, `${type}.jsonl.gz`);
    const path = join(cache, `${type}.jsonl.gz`);
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < 24 * 3600_000) return path;
    mkdirSync(cache, { recursive: true });
    const list = await (await fetch("https://api.scryfall.com/bulk-data", { headers: HEADERS })).json() as { data: { type: string, jsonl_download_uri?: string }[] };
    const url = list.data.find((f) => f.type === type)?.jsonl_download_uri;
    if (!url) throw new Error(`Scryfall has no ${type} bulk file`);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
}

export type Cards = {
    cards: LocalCard[],
    prints: Printing[],
    tags: Map<string, Set<string>>,
    // each set's first release date, for date>set
    setDates: Map<string, string>,
    // each set's block, for b: (from Scryfall's list of sets; empty without it)
    blocks: Map<string, string>,
    // every promo type there is, for is:prerelease and the like
    promoTypes: Set<string>,
};

// Scryfall's list of sets, for b: (blocks aren't in the bulk files): SCRYFALL_BULK_DIR/sets.json like
// scripts/card-data.ts, or fetched into `cache` and kept a day
export async function setsFile(cache: string): Promise<string> {
    const local = process.env.SCRYFALL_BULK_DIR;
    if (local) return join(local, "sets.json");
    const path = join(cache, "sets.json");
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < 24 * 3600_000) return path;
    mkdirSync(cache, { recursive: true });
    const res = await fetch("https://api.scryfall.com/sets", { headers: HEADERS });
    if (!res.ok) throw new Error(`sets: ${res.status}`);
    writeFileSync(path, await res.text());
    return path;
}

// every card and printing (default_cards), each Tagger tag's cards (a tag's cards include its child tags', as
// on Scryfall), and the sets' blocks
export async function loadCards(printsPath: string, tagsPath?: string, setsPath?: string): Promise<Cards> {
    const cards: LocalCard[] = [], prints: Printing[] = [];
    const byOracle = new Map<string, number>();
    const funnyPrinting = new Set<number>();
    const setDates = new Map<string, string>();
    for await (const c of jsonLines(printsPath)) {
        const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
        const oracleId: string = c.oracle_id ?? faces[0]?.oracle_id;
        if (!oracleId) continue;
        let card = byOracle.get(oracleId);
        if (card === undefined) {
            card = cards.push({ ...toCard(c, faces), funny: false, printings: [] }) - 1;
            byOracle.set(oracleId, card);
        } else if (cards[card].layout === "reversible_card" && c.layout !== "reversible_card") {
            // a reversible printing is the card twice over; its ordinary printing says what the card is
            cards[card] = { ...toCard(c, faces), funny: false, printings: cards[card].printings };
        }
        if (isFunnyPrinting(c)) funnyPrinting.add(card);
        cards[card].printings.push(prints.push(toPrinting(c, faces, card)) - 1);
        const first = setDates.get(c.set);
        if (c.released_at && (!first || c.released_at < first)) setDates.set(c.set, c.released_at);
    }
    for (const [i, c] of cards.entries()) c.funny = FUNNY_CARDS.has(c.name) || (funnyPrinting.has(i) && !c.legal.size && !c.banned.size);
    const tags = new Map<string, Set<string>>();
    if (tagsPath && existsSync(tagsPath)) {
        const byId = new Map<string, { slug: string, children: string[], cards: string[] }>();
        for await (const t of jsonLines(tagsPath)) {
            byId.set(t.id, { slug: t.slug, children: t.child_ids ?? [], cards: (t.taggings ?? []).map((g: any) => g.oracle_id) });
        }
        const gather = (id: string, into: Set<string>, seen: Set<string>) => {
            if (seen.has(id)) return;
            seen.add(id);
            const t = byId.get(id);
            if (!t) return;
            for (const o of t.cards) into.add(o);
            for (const child of t.children) gather(child, into, seen);
        };
        for (const [id, t] of byId) {
            const into = new Set<string>();
            gather(id, into, new Set());
            tags.set(t.slug, into);
        }
    }
    const blocks = new Map<string, string>();
    if (setsPath && existsSync(setsPath)) {
        for (const s of JSON.parse(readFileSync(setsPath, "utf8")).data ?? []) if (s.block_code) blocks.set(s.code, s.block_code);
    }
    const promoTypes = new Set(prints.flatMap((p) => [...p.promoTypes]));
    return { cards, prints, tags, setDates, blocks, promoTypes };
}

// ---- the query language ----

type Term = { key: string, op: string, value: string, regex?: RegExp };
export type Node = { and: Node[] } | { or: Node[] } | { not: Node } | { term: Term };

const OPS = ["<=", ">=", "!=", ":", "=", "<", ">"];

function tokenize(q: string): (string | Term)[] {
    const out: (string | Term)[] = [];
    let i = 0;
    // a quoted value, from the quote at `at`; returns it and where it ends
    const quoted = (at: number): [string, number] => {
        const end = q.indexOf("\"", at + 1);
        return [q.slice(at + 1, end < 0 ? q.length : end), end < 0 ? q.length : end + 1];
    };
    while (i < q.length) {
        const ch = q[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === "(" || ch === ")") { out.push(ch); i++; continue; }
        if (ch === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push("-"); i++; continue; }
        // !"Exact Name" or !name
        if (ch === "!") {
            const [value, end] = q[i + 1] === "\"" ? quoted(i + 1) : [/^[^\s()]*/.exec(q.slice(i + 1))![0], i + 1 + /^[^\s()]*/.exec(q.slice(i + 1))![0].length];
            out.push({ key: "!", op: ":", value });
            i = end;
            continue;
        }
        const key = /^[a-z]+/i.exec(q.slice(i))?.[0] ?? "";
        const op = key ? OPS.find((o) => q.startsWith(o, i + key.length)) : undefined;
        if (key && op) {
            let j = i + key.length + op.length;
            let value = "", regex: RegExp | undefined;
            if (q[j] === "/") {
                let end = j + 1;
                while (end < q.length && q[end] !== "/") end += q[end] === "\\" ? 2 : 1;
                const body = q.slice(j + 1, end);
                try { regex = scryfallRegex(body); } catch (e) { throw new Unsupported(`regex doesn't compile here: ${(e as Error).message}`); }
                value = body;
                j = end + 1;
            } else if (q[j] === "\"") {
                [value, j] = quoted(j);
            } else {
                const m = /^[^\s()]*/.exec(q.slice(j))![0];
                value = m;
                j += m.length;
            }
            out.push({ key: key.toLowerCase(), op, value, regex });
            i = j;
            continue;
        }
        // a bare word: `or`, or part of the name
        if (ch === "\"") {
            const [value, end] = quoted(i);
            out.push({ key: "word", op: ":", value });
            i = end;
            continue;
        }
        const word = /^[^\s()]+/.exec(q.slice(i))![0];
        out.push(/^or$/i.test(word) ? "or" : /^and$/i.test(word) ? "and" : { key: "word", op: ":", value: word });
        i += word.length;
    }
    return out;
}

export function parse(q: string): Node {
    const tokens = tokenize(q);
    let at = 0;
    const expr = (): Node => {
        const any: Node[] = [all()];
        while (tokens[at] === "or") { at++; any.push(all()); }
        return any.length === 1 ? any[0] : { or: any };
    };
    const all = (): Node => {
        const parts: Node[] = [];
        while (at < tokens.length && tokens[at] !== ")" && tokens[at] !== "or") {
            if (tokens[at] === "and") { at++; continue; }
            parts.push(one());
        }
        if (!parts.length) throw new Unsupported("empty group");
        return parts.length === 1 ? parts[0] : { and: parts };
    };
    const one = (): Node => {
        const t = tokens[at++];
        if (t === "-") return { not: one() };
        if (t === "(") {
            const inner = expr();
            if (tokens[at++] !== ")") throw new Unsupported("a bracket isn't closed");
            return inner;
        }
        if (typeof t === "string") throw new Unsupported(`unexpected ${t}`);
        return { term: t };
    };
    const node = expr();
    if (at < tokens.length) throw new Unsupported(`unexpected ${String(tokens[at])}`);
    return node;
}

// ---- comparing ----

function compare(op: string, a: number, b: number) {
    switch (op) {
        case ":": case "=": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
    }
    return false;
}

// colours by name: guilds, shards, wedges, colleges and the four-colour names
const COLOR_NAMES: Record<string, string> = {
    white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c",
    azorius: "wu", dimir: "ub", rakdos: "br", gruul: "rg", selesnya: "gw", orzhov: "wb", izzet: "ur", golgari: "bg", boros: "rw", simic: "gu",
    bant: "gwu", esper: "wub", grixis: "ubr", jund: "brg", naya: "rgw",
    abzan: "wbg", jeskai: "urw", sultai: "bgu", mardu: "rwb", temur: "gur",
    silverquill: "wb", prismari: "ur", witherbloom: "bg", lorehold: "rw", quandrix: "gu",
    chaos: "ubrg", aggression: "brgw", altruism: "rgwu", growth: "gwub", artifice: "wubr",
};

// a card's colours against the asked ones; `colon` is what a bare `:` means for this key. For produces:, c is
// colourless mana like any other letter; for colours it means none at all, so c:c is exactly colourless
function colorTest(op: string, value: string, colon: string, cIsLetter = false): (have: Set<string>) => boolean {
    const v = value.toLowerCase();
    if (/^\d+$/.test(v)) return (have) => compare(op === ":" ? "=" : op, have.size, Number(v));
    if (v === "m" || v === "multicolor") return (have) => have.size >= 2;
    const letters = COLOR_NAMES[v] ?? v;
    if (!/^[wubrgc]+$/.test(letters)) throw new Unsupported(`colour ${value}`);
    if (letters === "c" && !cIsLetter && op === ":") op = "=";
    const want = new Set(cIsLetter ? [...letters] : [...letters].filter((l) => l !== "c"));
    return (have) => {
        const sub = [...have].every((c) => want.has(c));
        const sup = [...want].every((c) => have.has(c));
        switch (op === ":" ? colon : op) {
            case "=": return sub && sup;
            case "<=": return sub;
            case ">=": return sup;
            case "<": return sub && !sup;
            case ">": return sup && !sub;
            case "!=": return !(sub && sup);
        }
        return false;
    };
}

// a stat like "3", "*", "1+*" or "∞" as a number; * counts as 0, like on Scryfall
const statNumber = (s: string) => s === "∞" ? Infinity : parseFloat(s.replace(/\*/g, "0").replace(/\+0$/, "")) || 0;

// mana symbols as counts: "{2}{W}{W}" or "2WW" -> generic 2, W 2
function manaSymbols(cost: string): Map<string, number> {
    const out = new Map<string, number>();
    const add = (s: string, n = 1) => out.set(s, (out.get(s) ?? 0) + n);
    const re = /\{([^}]+)\}|(\d+)|([a-z])/gi;
    for (const m of cost.matchAll(re)) {
        const sym = (m[1] ?? m[2] ?? m[3]).toUpperCase();
        if (/^\d+$/.test(sym)) add("#", Number(sym));
        else add(sym);
    }
    return out;
}

function manaTest(op: string, value: string): (cost: string) => boolean {
    const want = manaSymbols(value);
    const covers = (a: Map<string, number>, b: Map<string, number>) => [...b].every(([s, n]) => (a.get(s) ?? 0) >= n);
    return (cost) => {
        const have = manaSymbols(cost);
        const sup = covers(have, want), sub = covers(want, have);
        switch (op) {
            case ":": case ">=": return sup;
            case "=": return sup && sub;
            case ">": return sup && !sub;
            case "<=": return sub;
            case "<": return sub && !sup;
            case "!=": return !(sup && sub);
        }
        return false;
    };
}

const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const rarityOf = (r: string) => RARITIES.indexOf({ c: "common", u: "uncommon", r: "rare", m: "mythic", s: "special", b: "bonus" }[r] ?? r);

// set types as people type them
const SET_TYPES: Record<string, string> = { draftinnovation: "draft_innovation", duel: "duel_deck", duels: "duel_deck", fromthevault: "from_the_vault", ftv: "from_the_vault", premium: "premium_deck", treasure: "treasure_chest" };
const setType = (v: string) => SET_TYPES[v.replace(/_/g, "")] ?? v;

const anyFace = (c: LocalCard, re: RegExp) => c.faceTypes.some((t) => re.test(t));
const isCreature = (c: LocalCard) => anyFace(c, /\bcreature\b/);
// mana symbols anywhere on the card: its costs, and in its rules text ({W/P} in an ability)
const symbolsOf = (c: LocalCard) => [...c.manaCosts, ...c.text].flatMap((t) => [...t.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase()));
// changelings are every creature type
const hasType = (c: LocalCard, re: RegExp) => anyFace(c, re) || c.keywords.has("changeling");


// the is: shortcuts, by what they look at
const IS_CARD: Record<string, (c: LocalCard, data: Cards) => boolean> = {
    // the front face is a legendary creature or a Background, or the card says so
    commander: (c) => /\blegendary\b/.test(c.faceTypes[0]) && /\b(creature|background)\b/.test(c.faceTypes[0]) || c.text.some((t) => /can be your commander/i.test(t)),
    spell: (c) => !/\bland\b/.test(c.faceTypes[0]),
    permanent: (c) => anyFace(c, /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/),
    historic: (c) => anyFace(c, /\b(legendary|artifact|saga)\b/),
    party: (c) => isCreature(c) && hasType(c, /\b(cleric|rogue|warrior|wizard)\b/),
    outlaw: (c) => hasType(c, /\b(assassin|mercenary|pirate|rogue|warlock)\b/),
    // the front face is a creature with no rules text at all
    vanilla: (c) => /\bcreature\b/.test(c.faceTypes[0]) && !c.text[0]?.trim(),
    // every line starts with one of its keywords, then ends, or goes on with ", " (anything after it), a cost
    // ("Prototype {2}{R} — 3/2" and "Swampcycling {2}, …" too, but not an activated one, "Waterbend {3}: …"),
    // "—" or reminder text: "Protection from red", "Bushido 1", "Revolt — …", "Flying; banding" and a line of
    // reminder text alone don't count, but "First strike, protection from white" does
    frenchvanilla: (c) => {
        if (!isCreature(c) || !c.keywords.size || !c.fullText.some((t) => t.trim())) return false;
        const line = new RegExp(`^(?:${[...c.keywords].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})(?:$|, | (?:\\{[^}]+\\})+(?:$|, | — | \\()|—| \\()`, "i");
        return c.fullText.every((t) => t.split("\n").every((l) => line.test(l)));
    },
    // the front face: Scorned Villager // Moonscarred Werewolf isn't one by its 2/2 back
    bear: (c) => c.mv === 2 && /\bcreature\b/.test(c.faceTypes[0]) && c.power[0] === "2" && c.toughness[0] === "2",
    // "Choose one —" and the like, and keywords that work the same way
    modal: (c) => c.text.some((t) => /choose (one|two|three|four|five|any number|one or more|one or both|up to \w+)\b[^\n]*(—|\n•)/i.test(t)) || ["spree", "tiered", "escalate", "entwine"].some((k) => c.keywords.has(k)),
    // the front face's cost: Hallway Heckler // Vicious Verse isn't, by {B/R} on its prepared spell
    hybrid: (c) => [...manaSymbols(c.manaCosts[0] ?? "").keys()].some((s) => s.split("/").filter((p) => p !== "P").length >= 2),
    phyrexian: (c) => symbolsOf(c).some((s) => s.split("/").includes("P")),
    reserved: (c) => c.reserved,
    gamechanger: (c) => c.gameChanger,
    // the ways two commanders pair up, and both halves of the pairs (Backgrounds, Doctors); "Partner with" a
    // named card isn't one of them
    partner: (c) => /\blegendary\b/.test(c.faceTypes[0]) && (["partner", "partner with", "friends forever", "choose a background", "doctor's companion"].some((k) => c.keywords.has(k))
        || c.text.some((t) => /^partner—/im.test(t)) || anyFace(c, /\bbackground\b/) || anyFace(c, /\btime lord doctor\b/)),
    companion: (c) => c.keywords.has("companion"),
    meldpart: (c) => c.meld === "part",
    meldresult: (c) => c.meld === "result",
    funny: (c) => c.funny,
    // printed in one set only (two printings in one set still count; an oversized one, like Gavi's in oc20,
    // is another)
    unique: (c, data) => new Set(c.printings.map((p) => data.prints[p].set)).size === 1,
};
// a reversible printing is double-faced even when the card isn't, so layouts are per printing
const IS_PRINT: Record<string, (p: Printing) => boolean> = {
    split: (p) => p.layout === "split",
    flip: (p) => p.layout === "flip",
    transform: (p) => p.layout === "transform",
    tdfc: (p) => p.layout === "transform",
    meld: (p) => p.layout === "meld",
    leveler: (p) => p.layout === "leveler",
    adventure: (p) => p.layout === "adventure",
    mdfc: (p) => p.layout === "modal_dfc",
    // two faces with a picture each: double-faced tokens and art cards too, but not meld cards
    dfc: (p) => ["transform", "modal_dfc", "reversible_card", "double_faced_token", "art_series"].includes(p.layout),
    reprint: (p) => p.reprint,
    promo: (p) => p.promo,
    digital: (p) => p.digital,
    full: (p) => p.fullArt,
    textless: (p) => p.textless,
    spotlight: (p) => p.spotlight,
    oversized: (p) => p.oversized,
    foil: (p) => p.finishes.has("foil"),
    nonfoil: (p) => p.finishes.has("nonfoil"),
    etched: (p) => p.finishes.has("etched"),
    glossy: (p) => p.finishes.has("glossy"),
    alchemy: (p) => p.setType === "alchemy" || p.promoTypes.has("rebalanced"),
    rebalanced: (p) => p.promoTypes.has("rebalanced"),
    universesbeyond: (p) => p.stamp === "triangle" || p.promoTypes.has("universesbeyond"),
    ub: (p) => p.stamp === "triangle" || p.promoTypes.has("universesbeyond"),
    booster: (p) => p.booster,
    hires: (p) => p.hires,
    masterpiece: (p) => p.setType === "masterpiece",
    colorshifted: (p) => p.frameEffects.has("colorshifted"),
};

// Scryfall's is: names for promo types that differ from the bulk files' own. Not is:intro, is:media or
// is:brawler: those are wider than the intropack, mediainsert and brawldeck promo types
const PROMO_NAMES: Record<string, string> = { judge: "judgegift" };

// the land groups (is:fetchland, is:shockland…): Scryfall keeps them by hand, so they're its own lists, kept in
// land-cycles.json by npm run land-cycles. is:manland is is:creatureland
const LAND_CYCLES: Record<string, Set<string>> = Object.fromEntries(Object.entries(
    JSON.parse(readFileSync(new URL("./land-cycles.json", import.meta.url), "utf8")) as Record<string, string[]>,
).map(([cycle, names]) => [cycle, new Set(names)]));
LAND_CYCLES.manland = LAND_CYCLES.creatureland;

// keys that change how results are shown, not which cards match
const DISPLAY = new Set(["unique", "order", "direction", "display", "prefer", "include", "lang", "sort"]);

type Test = { level: "card", fn: (c: LocalCard) => boolean } | { level: "print", fn: (p: Printing, c: LocalCard) => boolean };
const card = (fn: (c: LocalCard) => boolean): Test => ({ level: "card", fn });
const print = (fn: (p: Printing, c: LocalCard) => boolean): Test => ({ level: "print", fn });

function compile(t: Term, data: Cards): Test {
    const plainOrRegex = (op: string) => {
        if (op !== ":" && op !== "=") throw new Unsupported(`${t.key}${t.op}`);
        if (t.regex) { const re = t.regex; return (list: string[]) => list.some((s) => re.test(s)); }
        const v = t.value.toLowerCase();
        // in plain text too ~ is the card itself, by name or as "this creature", "this Aura"…
        if (v.includes("~")) {
            const re = new RegExp(v.split("~").map(escapeRe).join(SELF), "i");
            return (list: string[]) => list.some((s) => re.test(s));
        }
        return (list: string[]) => list.some((s) => s.toLowerCase().includes(v));
    };
    const number = () => {
        const n = Number(t.value);
        if (Number.isNaN(n)) throw new Unsupported(`${t.key} ${t.value}`);
        return n;
    };
    const v = t.value.toLowerCase();
    switch (t.key) {
        // the text with the card's name as ~ only for a search with ~ in it (see cardText)
        case "o": case "oracle": { const m = plainOrRegex(t.op), self = t.value.includes("~"); return card((c) => m(self ? c.text : c.printed)); }
        case "fo": case "fulloracle": { const m = plainOrRegex(t.op), self = t.value.includes("~"); return card((c) => m(self ? c.fullText : c.fullPrinted)); }
        // a regex reads the whole type line, "Front // Back", so t:/^land/ is a land in front only
        case "t": case "type": { const m = plainOrRegex(t.op); return card((c) => m(t.regex ? [c.types] : c.faceTypes)); }
        // the whole name, and a reversible printing's own ("Bolt // Bolt"); a face's name alone doesn't count
        case "name": case "word": { const m = plainOrRegex(t.op); return print((p, c) => m([c.name, p.name])); }
        case "!": return card((c) => c.name.toLowerCase() === v || c.faceNames.some((n) => n.toLowerCase() === v));
        case "c": case "color": { const m = colorTest(t.op, t.value, ">="); return card((c) => c.faceColors.some(m)); }
        case "id": case "identity": case "ci": case "commander": { const m = colorTest(t.op, t.value, "<="); return card((c) => m(c.identity)); }
        case "produces": { const m = colorTest(t.op, t.value, ">=", true); return card((c) => m(c.produced)); }
        case "has":
            if (v === "indicator") return card((c) => c.indicator);
            if (v === "watermark") return print((p) => !!p.watermark);
            throw new Unsupported(`has:${v}`);
        case "f": case "format": case "legal": return card((c) => c.legal.has(v));
        case "banned": return card((c) => c.banned.has(v));
        case "restricted": return card((c) => c.restricted.has(v));
        case "mv": case "cmc": case "manavalue":
            if (v === "even" || v === "odd") return card((c) => Number.isInteger(c.mv) && (c.mv % 2 === 0) === (v === "even"));
            { const n = number(); return card((c) => compare(t.op, c.mv, n)); }
        case "m": case "mana": { const m = manaTest(t.op, t.value); return card((c) => c.manaCosts.some(m)); }
        case "pow": case "power": case "tou": case "toughness": case "loy": case "loyalty": case "pt": case "powtou": {
            const raw = (c: LocalCard, key: string) => /^(pow|power)$/.test(key) ? c.power : /^(tou|toughness)$/.test(key) ? c.toughness : c.loyalty;
            // a face each, undefined where that face has no such stat
            const stat = (c: LocalCard, key: string): (number | undefined)[] => {
                // the front face's total only: Hanweir Watchkeep isn't pt=10 by its back face
                if (/^(pt|powtou)$/.test(key)) return c.power.slice(0, 1).map((p) => p === undefined || c.toughness[0] === undefined ? undefined : statNumber(p) + statNumber(c.toughness[0]!));
                if (/^(mv|cmc)$/.test(key)) return c.power.map(() => c.mv);
                return raw(c, key).map((s) => s === undefined ? undefined : statNumber(s));
            };
            // * counts as 0, so pow:* is pow=0
            if (v === "*") return card((c) => stat(c, t.key).some((a) => a !== undefined && compare(t.op, a, 0)));
            // pow>tou compares any face's stat with any face's: Dion // Bahamut is tou>pow, its back's 5
            // toughness against its front's 3 power, though each face is square
            if (/^(pow|power|tou|toughness|loy|loyalty|pt|powtou|mv|cmc)$/.test(v)) return card((c) => {
                const other = stat(c, v).filter((b) => b !== undefined);
                return stat(c, t.key).some((a) => a !== undefined && other.some((b) => compare(t.op, a, b!)));
            });
            const n = number();
            return card((c) => stat(c, t.key).some((a) => a !== undefined && compare(t.op, a, n)));
        }
        case "kw": case "keyword": return card((c) => c.keywords.has(v));
        case "edhrec": case "edhrecrank": { const n = number(); return card((c) => c.edhrec !== undefined && compare(t.op, c.edhrec, n)); }
        case "otag": case "oracletag": case "function": {
            if (!data.tags.size) throw new Unsupported("otag without the tags file");
            const cards = data.tags.get(v);
            return card((c) => !!cards?.has(c.oracleId));
        }
        case "is": case "not": {
            const negate = t.key === "not";
            const onCard = IS_CARD[v], onPrint = IS_PRINT[v];
            if (onCard) return card((c) => onCard(c, data) !== negate);
            if (onPrint) return print((p) => onPrint(p) !== negate);
            const lands = LAND_CYCLES[v];
            if (lands) return card((c) => lands.has(c.name) !== negate);
            // the kinds of promo, as the printings' promo types name them (is:prerelease, is:fnm…)
            const promo = PROMO_NAMES[v] ?? v;
            if (data.promoTypes.has(promo)) return print((p) => p.promoTypes.has(promo) !== negate);
            throw new Unsupported(`is:${v}`);
        }
        // the printing's own facts
        case "s": case "e": case "set": case "edition": return print((p) => p.set === v);
        case "st": case "settype": { const want = setType(v); return print((p) => p.setType === want); }
        // a block by any of its sets' codes: b:ktk is Khans, Fate Reforged and Dragons of Tarkir
        case "b": case "block": {
            if (!data.blocks.size) throw new Unsupported("b: without Scryfall's list of sets");
            const block = data.blocks.get(v) ?? v;
            return print((p) => data.blocks.get(p.set) === block);
        }
        case "r": case "rarity": {
            const want = rarityOf(v);
            if (want < 0) throw new Unsupported(`rarity ${v}`);
            return print((p) => compare(t.op === ":" ? "=" : t.op, rarityOf(p.rarity), want));
        }
        case "a": case "artist": { const m = plainOrRegex(t.op); return print((p) => m([p.artist])); }
        // a regex reads the front face's only: Invasion of Dominaria's back face mentions Yawgmoth, but
        // ft:/yawgmoth/ doesn't find it, where ft:yawgmoth does
        case "ft": case "flavor": { const m = plainOrRegex(t.op); return print((p) => m(t.regex ? p.flavor.slice(0, 1) : p.flavor)); }
        case "wm": case "watermark": return print((p) => p.watermark === v);
        case "frame": return print((p) => p.frame === v || p.frameEffects.has(v));
        case "border": return print((p) => p.border === v);
        case "stamp": return print((p) => p.stamp === v);
        case "game": return print((p) => p.games.has(v));
        case "cn": case "number":
            // by the number in it: cn:1 finds Combat Medic's 1a and Eager Cadet's S1
            if (/^\d+$/.test(v)) { const n = Number(v); return print((p) => /\d/.test(p.cn) && compare(t.op, Number(p.cn.replace(/\D/g, "")), n)); }
            return print((p) => p.cn.toLowerCase() === v);
        case "year": { const n = number(); return print((p) => !!p.released && compare(t.op, Number(p.released.slice(0, 4)), n)); }
        case "date": {
            const day = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : data.setDates.get(v);
            if (!day) throw new Unsupported(`date ${v}`);
            return print((p) => !!p.released && compare(t.op, p.released < day ? -1 : p.released > day ? 1 : 0, 0));
        }
        case "usd": case "eur": case "tix": {
            const n = number(), key = t.key as "usd" | "eur" | "tix";
            return print((p) => p[key] !== undefined && compare(t.op, p[key]!, n));
        }
        // ever printed in a set, set type, game or rarity (not counting masterpieces, Secret Lair and the like, or
        // From the Vault, all mythic: in:mythic isn't Swords to Plowshares)
        case "in": {
            const st = setType(v), r = rarityOf(v);
            return card((c) => c.printings.some((i) => {
                const p = data.prints[i];
                return p.set === v || p.setType === st || p.games.has(v) || (r >= 0 && !["masterpiece", "box", "from_the_vault"].includes(p.setType) && rarityOf(p.rarity) === r) || p.lang === v;
            }));
        }
        case "prints": case "sets": case "paperprints": case "papersets": {
            const n = number();
            return card((c) => {
                const list = c.printings.map((i) => data.prints[i]).filter((p) => !t.key.startsWith("paper") || p.games.has("paper"));
                return compare(t.op, t.key.endsWith("sets") ? new Set(list.map((p) => p.set)).size : list.length, n);
            });
        }
    }
    if (DISPLAY.has(t.key)) return card(() => true);
    throw new Unsupported(`${t.key}${t.op}`);
}

// how much of what Scryfall hides by default the search asks for, as a level a hidden printing needs (NEEDS):
// include:extras or naming a set shows everything; naming a hidden type, a name: search (not plain words), an
// artist, a watermark, is:dfc or is:funny shows all but the withdrawn cards
const NEEDS: Record<Printing["extra"], number> = { "": 0, extra: 1, withdrawn: 2 };
function revealed(node: Node, negated = false): number {
    if ("term" in node) {
        const { key, value } = node.term;
        if (key === "include" && value.toLowerCase() === "extras") return 2;
        if (["s", "e", "set", "edition"].includes(key)) return 2;
        // -name:dragon doesn't
        if (key === "name" && !negated) return 1;
        if ((key === "t" || key === "type") && /^(token|emblem|plane|phenomenon|scheme|vanguard|card)$/i.test(value)) return 1;
        // is:dfc shows double-faced tokens, art cards and playtest cards; is:transform doesn't
        if (key === "is" && value.toLowerCase() === "dfc" && !negated) return 1;
        // so do artists and watermarks: a:proce finds his Elemental token, wm:izzet the Weird // Goblin one
        if (["a", "artist", "wm", "watermark"].includes(key) && !negated) return 1;
        if (key === "has" && value.toLowerCase() === "watermark" && !negated) return 1;
        // is:funny shows funny tokens too, like the Dragon
        if (key === "is" && value.toLowerCase() === "funny" && !negated) return 1;
        return 0;
    }
    if ("not" in node) return revealed(node.not, !negated);
    return Math.max(...("and" in node ? node.and : node.or).map((part) => revealed(part, negated)));
}

// the printings among `prints` that match
function evaluate(node: Node, data: Cards, prints: number[]): number[] {
    if ("term" in node) {
        const test = compile(node.term, data);
        if (test.level === "print") return prints.filter((i) => test.fn(data.prints[i], data.cards[data.prints[i].card]));
        // a card's facts are the same for each of its printings, so each card is tested once
        const known = new Map<number, boolean>();
        return prints.filter((i) => {
            const c = data.prints[i].card;
            let hit = known.get(c);
            if (hit === undefined) known.set(c, hit = test.fn(data.cards[c]));
            return hit;
        });
    }
    // an AND only tests what's left after the parts before it, so a narrow part first saves the rest work
    if ("and" in node) return node.and.reduce((left, part) => left.length ? evaluate(part, data, left) : left, prints);
    if ("or" in node) {
        const hit = new Set<number>();
        for (const part of node.or) for (const i of evaluate(part, data, prints)) hit.add(i);
        return prints.filter((i) => hit.has(i));
    }
    const out = new Set(evaluate(node.not, data, prints));
    return prints.filter((i) => !out.has(i));
}

// the cards (as indexes into `cards`) among `among` with a printing that matches the whole search
export function search(node: Node, data: Cards, among?: number[]): number[] {
    const shown = revealed(node);
    const visible = (kind: Printing["extra"]) => NEEDS[kind] <= shown;
    const prints: number[] = [];
    for (const c of among ?? data.cards.keys()) for (const p of data.cards[c].printings) if (visible(data.prints[p].extra)) prints.push(p);
    const seen = new Set<number>(), out: number[] = [];
    for (const p of evaluate(node, data, prints)) {
        const c = data.prints[p].card;
        if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
}
