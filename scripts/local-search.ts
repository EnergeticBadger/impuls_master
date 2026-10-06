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
    // rules text as o: sees it, a face each: the card's own name as ~, reminder text left out
    text: string[],
    // as fo: sees it: reminder text kept
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
    // a face each, undefined where a face has none, so pow>tou compares a face with itself
    power: (string | undefined)[],
    toughness: (string | undefined)[],
    loyalty: (string | undefined)[],
    produced: Set<string>,
    edhrec?: number,
    reserved: boolean,
    gameChanger: boolean,
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
    finishes: Set<string>,
    watermark: string,
    flavor: string[],
    stamp: string,
    // why it isn't shown unless asked for: "extra" (tokens, art cards, memorabilia…) needs include:extras, its
    // set, its type or a name: search; "funny" (playtest cards, Heroes of the Realm…) also shows for is:funny;
    // "" is shown
    extra: "" | "extra" | "funny",
};

// printings Scryfall's search doesn't show by default (found by comparing with it, see npm run test-syntax):
// these layouts, tokens, "Card"s, memorabilia (but not dungeons), Alchemy's specialize variants (in Alchemy
// sets but legal nowhere), Astral and Sega printings; and, until is:funny asks for them, playtest cards and
// Heroes of the Realm and holiday promos
const EXTRA_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "planar", "scheme", "vanguard"]);
const EXTRA_SETS = /^(ph\d\d|phtr|hho|h17|pcel)$/;
function extraKind(c: any): Printing["extra"] {
    const games: string[] = c.games ?? [];
    const type: string = c.type_line ?? c.card_faces?.[0]?.type_line ?? "";
    const legalNowhere = !Object.values(c.legalities ?? {}).some((v) => v === "legal" || v === "restricted");
    if (EXTRA_LAYOUTS.has(c.layout) || /^(token|card)\b/i.test(type) || (c.set_type === "memorabilia" && !/\bdungeon\b/i.test(type))
        || (c.set_type === "alchemy" && legalNowhere) || (games.length > 0 && games.every((g) => g === "astral" || g === "sega"))) return "extra";
    if (c.promo_types?.includes("playtest") || EXTRA_SETS.test(c.set)) return "funny";
    return "";
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// A Scryfall regex as JavaScript reads it. Scryfall's never cross a line break: . and [^…] don't match one,
// and ^ $ match at each line, so `choose one —[^.]*exile` misses "choose one —\n• Exile" there
export function scryfallRegex(body: string): RegExp {
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
        out += ch === "." ? "[^\\n]" : ch;
    }
    return new RegExp(out, "im");
}

// a card's rules text a face each, as o: sees it (reminder text left out) and as fo: does (kept), with the
// card's own name as ~. Takes a card as Scryfall's API and bulk files give it
export function cardText(c: any): { text: string[], fullText: string[] } {
    const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
    const fullName: string = c.name;
    // the card's names, longest first, become ~: the whole name, each face's, and a legend's short name
    // ("Baxter" in "Baxter, Fly in the Ointment", "Círdan" in "Círdan the Shipwright")
    const own: string[] = [fullName, ...faces.map((f) => f.name)];
    const legend = /legendary/i.test(c.type_line ?? faces[0]?.type_line ?? "");
    const short = own.flatMap((n) => [n.split(",")[0], ...(legend ? [n.split(/ (?:the|of) /)[0]] : [])]);
    const names = [...new Set([...own, ...short])].filter((n) => n && n.length > 2).sort((a, b) => b.length - a.length);
    const self = names.length ? new RegExp(names.map(escapeRe).join("|"), "g") : null;
    const raw = faces.map((f) => (f.oracle_text ?? c.oracle_text ?? "") as string);
    const tilde = (t: string) => self ? t.replace(self, "~") : t;
    return { text: raw.map((t) => tilde(t.replace(/ ?\([^)]*\)/g, ""))), fullText: raw.map(tilde) };
}

const lower = (list?: string[]) => new Set((list ?? []).map((l) => l.toLowerCase()));
const price = (v?: string | null) => v == null ? undefined : Number(v);

function toCard(c: any, faces: any[]): Omit<LocalCard, "printings"> {
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
        manaCosts: faces.length > 1 ? faces.map((f) => f.mana_cost ?? "").filter(Boolean) : [c.mana_cost ?? ""],
        power: each("power"),
        toughness: each("toughness"),
        loyalty: each("loyalty"),
        produced: lower(c.produced_mana),
        edhrec: c.edhrec_rank,
        reserved: !!c.reserved,
        gameChanger: !!c.game_changer,
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
        finishes: lower(c.finishes),
        watermark: (c.watermark ?? faces.find((f) => f.watermark)?.watermark ?? "").toLowerCase(),
        flavor: faces.map((f) => f.flavor_text ?? c.flavor_text).filter(Boolean),
        stamp: c.security_stamp ?? "",
        extra: extraKind(c),
    };
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
    const setDates = new Map<string, string>();
    for await (const c of jsonLines(printsPath)) {
        const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
        const oracleId: string = c.oracle_id ?? faces[0]?.oracle_id;
        if (!oracleId) continue;
        let card = byOracle.get(oracleId);
        if (card === undefined) {
            card = cards.push({ ...toCard(c, faces), printings: [] }) - 1;
            byOracle.set(oracleId, card);
        } else if (cards[card].layout === "reversible_card" && c.layout !== "reversible_card") {
            // a reversible printing is the card twice over; its ordinary printing says what the card is
            cards[card] = { ...toCard(c, faces), printings: cards[card].printings };
        }
        cards[card].printings.push(prints.push(toPrinting(c, faces, card)) - 1);
        const first = setDates.get(c.set);
        if (c.released_at && (!first || c.released_at < first)) setDates.set(c.set, c.released_at);
    }
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
    return { cards, prints, tags, setDates, blocks };
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
    frenchvanilla: (c) => isCreature(c) && c.text.some((t) => t.trim()) && c.text.every((t) => t.split("\n").every((line) => !line.trim() || line.split(/, ?/).every((part) => [...c.keywords].some((k) => part.toLowerCase().startsWith(k))))),
    bear: (c) => c.mv === 2 && c.faceTypes.some((t, i) => /\bcreature\b/.test(t) && c.power[i] === "2" && c.toughness[i] === "2"),
    // "Choose one —" and the like, and keywords that work the same way
    modal: (c) => c.text.some((t) => /choose (one|two|three|four|five|any number|one or more|one or both|up to \w+)\b[^\n]*(—|\n•)/i.test(t)) || ["spree", "tiered", "escalate", "entwine"].some((k) => c.keywords.has(k)),
    hybrid: (c) => c.manaCosts.some((cost) => [...manaSymbols(cost).keys()].some((s) => s.split("/").filter((p) => p !== "P").length >= 2)),
    phyrexian: (c) => symbolsOf(c).some((s) => s.split("/").includes("P")),
    reserved: (c) => c.reserved,
    gamechanger: (c) => c.gameChanger,
    // the ways two commanders pair up, and both halves of the pairs (Backgrounds, Doctors); "Partner with" a
    // named card isn't one of them
    partner: (c) => /\blegendary\b/.test(c.faceTypes[0]) && (["partner", "partner with", "friends forever", "choose a background", "doctor's companion"].some((k) => c.keywords.has(k))
        || c.text.some((t) => /^partner—/im.test(t)) || anyFace(c, /\bbackground\b/) || anyFace(c, /\btime lord doctor\b/)),
    companion: (c) => c.keywords.has("companion"),
    // printed in one set only (two printings in one set still count)
    unique: (c, data) => new Set(c.printings.filter((p) => !data.prints[p].extra).map((p) => data.prints[p].set)).size === 1,
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
    dfc: (p) => ["transform", "modal_dfc", "meld", "reversible_card"].includes(p.layout),
    reprint: (p) => p.reprint,
    promo: (p) => p.promo,
    digital: (p) => p.digital,
    // Un-sets, and acorn-stamped cards wherever they're printed
    funny: (p) => p.setType === "funny" || p.stamp === "acorn",
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
};

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
        // in plain text ~ is the card itself, by name or as "this land", "this creature"…
        if (v.includes("~")) {
            const re = new RegExp(v.split("~").map(escapeRe).join("(?:~|this [a-z]+)"), "i");
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
        case "o": case "oracle": { const m = plainOrRegex(t.op); return card((c) => m(c.text)); }
        case "fo": case "fulloracle": { const m = plainOrRegex(t.op); return card((c) => m(c.fullText)); }
        case "t": case "type": { const m = plainOrRegex(t.op); return card((c) => m(c.faceTypes)); }
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
            // pow>tou compares two of a face's own stats
            if (/^(pow|power|tou|toughness|loy|loyalty|pt|powtou|mv|cmc)$/.test(v)) return card((c) => {
                const other = stat(c, v);
                return stat(c, t.key).some((a, i) => a !== undefined && other[i] !== undefined && compare(t.op, a, other[i]!));
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
        case "ft": case "flavor": { const m = plainOrRegex(t.op); return print((p) => m(p.flavor)); }
        case "wm": case "watermark": return print((p) => p.watermark === v);
        case "frame": return print((p) => p.frame === v || p.frameEffects.has(v));
        case "border": return print((p) => p.border === v);
        case "stamp": return print((p) => p.stamp === v);
        case "game": return print((p) => p.games.has(v));
        case "cn": case "number":
            if (/^\d+$/.test(v)) { const n = Number(v); return print((p) => /^\d+$/.test(p.cn) && compare(t.op, Number(p.cn), n)); }
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
        // ever printed in a set, set type, game or rarity
        case "in": {
            const st = setType(v), r = rarityOf(v);
            return card((c) => c.printings.some((i) => {
                const p = data.prints[i];
                return p.set === v || p.setType === st || p.games.has(v) || (r >= 0 && p.setType !== "masterpiece" && p.setType !== "box" && rarityOf(p.rarity) === r) || p.lang === v;
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

// which printings Scryfall hides by default the search asks for: all of them for include:extras, naming their
// set or type, or a name: search (not plain words); the "funny" ones for is:funny; otherwise none
function revealed(node: Node, negated = false): "all" | "funny" | "" {
    if ("term" in node) {
        const { key, value } = node.term;
        if (key === "include" && value.toLowerCase() === "extras") return "all";
        if (["s", "e", "set", "edition"].includes(key)) return "all";
        // -name:dragon doesn't
        if (key === "name" && !negated) return "all";
        if ((key === "t" || key === "type") && /^(token|emblem|plane|phenomenon|scheme|vanguard|card)$/i.test(value)) return "all";
        if (key === "is" && value.toLowerCase() === "funny") return "funny";
        return "";
    }
    if ("not" in node) return revealed(node.not, !negated);
    const each = ("and" in node ? node.and : node.or).map((part) => revealed(part, negated));
    return each.includes("all") ? "all" : each.includes("funny") ? "funny" : "";
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
    const visible = (kind: Printing["extra"]) => !kind || shown === "all" || (kind === "funny" && shown === "funny");
    const prints: number[] = [];
    for (const c of among ?? data.cards.keys()) for (const p of data.cards[c].printings) if (visible(data.prints[p].extra)) prints.push(p);
    const seen = new Set<number>(), out: number[] = [];
    for (const p of evaluate(node, data, prints)) {
        const c = data.prints[p].card;
        if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
}
