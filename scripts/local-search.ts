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
import { dirname, join } from "node:path";
import { MINUS_DROPPED } from "../app/Components/Searchbar/droppedTerms.ts";
import { politeFetch } from "./scryfall-answers.ts";

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
    penny?: number,
    reserved: boolean,
    gameChanger: boolean,
    // a meld card's part in it: "part" (Bruna, the Fading Light) or "result" (Brisela, Voice of Nightmares)
    meld: "" | "part" | "result",
    // is:funny: see FUNNY_CARDS
    funny: boolean,
    printings: number[],
    // the printing Scryfall shows the card with when the search doesn't say otherwise (see byPreference)
    shown?: number,
};

// one printing: what's particular to it
export type Printing = {
    // Scryfall's id for it
    id: string,
    card: number,
    // a reversible printing has its own name ("Birds of Paradise // Birds of Paradise") and layout
    name: string,
    // a Universes Beyond printing's other name: Homeward Path is "Green Dragon Inn" in The Lord of the Rings
    flavorName: string,
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
    // a face each where they differ: Breaking // Entering is Dimir and Rakdos
    watermarks: Set<string>,
    // a face each, "" where a face has none
    flavor: string[],
    stamp: string,
    // the art, for new:art
    art: string,
    // why it isn't shown unless asked for (see revealed): "setOnly" (only include:extras or its set shows it)
    // or "extra" (tokens, art cards, playtest cards…); "" is shown
    extra: "" | "setOnly" | "extra",
};

// printings Scryfall's search doesn't show by default (found by comparing with it, see npm run test-syntax):
// these layouts and memorabilia (but not dungeons), tokens, "Card"s, Alchemy's specialize variants (in Alchemy
// sets but legal nowhere), Astral and Sega printings, playtest cards, Heroes of the Realm and holiday promos,
// silver-bordered promos, Gleemox ("This card is banned.") and Secret Lair's sticker sheet. Only
// include:extras or naming the set shows the seven cards Wizards banned in 2020 for racist content, and the
// gold-bordered World Championship decks (border:gold finds nothing) and the Sega Dreamcast cards
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
    if (WITHDRAWN.has(c.name) || (c.border_color === "gold" && c.set_type === "memorabilia")
        || (games.length > 0 && games.every((g) => g === "sega"))) return "setOnly";
    // dungeons are shown, even Undercity // The Initiative, a double-faced token
    const dungeon = /^dungeon\b/i.test(type);
    if ((EXTRA_LAYOUTS.has(c.layout) && !dungeon) || /^(token|card)\b/i.test(type) || (c.set_type === "memorabilia" && !dungeon)
        || (c.set_type === "alchemy" && legalNowhere) || (games.length > 0 && games.every((g) => g === "astral"))) return "extra";
    // silver-bordered promos too: Goblin Mime's Arena League one shows for e:pal04, not for r:rare (Secret
    // Lair's silver-bordered ponies are shown)
    if (c.promo_types?.includes("playtest") || EXTRA_SETS.test(c.set) || HIDDEN_FUNNY.has(c.name)
        || (c.border_color === "silver" && c.set_type === "promo")) return "extra";
    return "";
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// what becomes ~ in a card's text besides its names (see cardText): "this" and a card type or subtype the card
// calls itself by, but not "this turn", "this way", "this scheme", "this Case", "this Room" or "this
// planeswalker" (Sanctum Lurker's "This planeswalker deals" is another card). Oracle text now says "Destroy
// this enchantment" where it said "Destroy Aether Storm", and o:/destroy ~/ finds both
const THIS_WORDS = "creature|artifact|enchantment|land|battle|spell|card|permanent|token|aura|equipment|vehicle|saga|siege|class|contraption|attraction|spacecraft";
const THIS = new RegExp(`\\bthis (?:${THIS_WORDS})\\b`, "gi");

// text with its accents off and Æ as Ae, as Scryfall compares it: o:Æther, o:aether and o:/æther/ are the same
export const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/æ/g, "ae").replace(/Æ/g, "Ae");

// A Scryfall regex as JavaScript reads it. Scryfall's never cross a line break: . and [^…] don't match one,
// and ^ $ match at each line, so `choose one —[^.]*exile` misses "choose one —\n• Exile" there. A ~ is a ~,
// against text with the card's names and "this creature" and the like as ~ (see cardText)
export function scryfallRegex(regex: string): RegExp {
    const body = fold(regex);
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

// the legends whose short names Scryfall picks differently from cardText's rule, kept by npm run short-names
const SHORT_NAMES: Record<string, string[]> = JSON.parse(readFileSync(new URL("./short-names.json", import.meta.url), "utf8"));
// every type word, lower case, from Scryfall's catalogs (types.json, by npm run types)
const TYPES = new Set<string>(JSON.parse(readFileSync(new URL("./types.json", import.meta.url), "utf8")));

// a card's rules text a face each, as o: sees it (reminder text left out) and as fo: does (kept): as printed,
// and with the card itself as ~, by its names and as "this creature", "this Aura"…. Scryfall matches a search
// without ~ against the printed text, so o:"fire deals" finds Banefire and o:/untap this\b/ "untap this
// creature"; one with ~ against the other, so `untap (this|~)\b` finds nothing at all: "this creature" is ~
// there, and no \b follows a ~. Accents are off (see fold). Takes a card as Scryfall's API and bulk files give it
export function cardText(c: any, shortNames = SHORT_NAMES): { printed: string[], text: string[], fullPrinted: string[], fullText: string[] } {
    const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
    const fullName: string = c.name;
    // the card's names, longest first, become ~: the whole name, each face's, and each one's short name, the part
    // before the first ",", " of " or " the ". Every card's, not only a legend's: "Baxter" in "Baxter, Fly in the
    // Ointment", "Staff" in "Staff of Eden, Vault's Key" (its "When Staff of Eden enters" is "When ~ of Eden
    // enters"), "Case" in "Case of the Gorgon's Kiss" ("When this ~ enters"), "Turn" in "Turn the Tide"
    const own: string[] = [fullName, ...faces.map((f) => f.name)];
    // ("X" counts; a name with a dot in it doesn't: J. Jonah Jameson stays, but Nick Fury, Agent of
    // S.H.I.E.L.D. is Nick Fury). For the few Scryfall seems to pick by hand (Ryan Sinclair is "Ryan"), its own
    // choice is in shortNames
    const short = shortNames[fullName] ?? own.map((n) => n.split(/,| (?:the|of) /)[0]);
    // as whole words, so Khaaaaaaaaaaaannn!'s name, ending in "!", stays as it is. A whole name only as it's
    // written ("has lifelink" stays on Lifelink, "lose 1 life" on Life // Death), a short name in any case
    // ("until end of turn" is "until end of ~" on Turn the Tide)
    const words = (list: string[], flags: string) => {
        const kept = [...new Set(list)].filter((n) => n && !n.includes(".")).sort((a, b) => b.length - a.length);
        return kept.length ? new RegExp(`\\b(?:${kept.map((n) => escapeRe(fold(n))).join("|")})\\b`, flags) : null;
    };
    const whole = words(own, "g"), part = words(short.filter((n) => !own.includes(n)), "gi");
    // a card with more than two faces has no text Scryfall searches: o: and fo: never find Who // What // When //
    // Where // Why, Smelt // Herd // Saw or There // They're // Their, whatever the words
    // a cleave card's text is found with its words in square brackets and without the brackets: "Destroy target
    // [attacking] creature." by o:"[attacking]" and by o:"destroy target attacking creature" (not Elspeth's
    // Talent's "[+1]:", which isn't cleave). So each line with brackets comes again after the text without them
    const cleave = (t: string) => c.keywords?.includes("Cleave") && t.includes("[")
        ? `${t}\n${t.split("\n").filter((l) => l.includes("[")).map((l) => l.replace(/[[\]]/g, "")).join("\n")}` : t;
    const raw = faces.length > 2 ? [] : faces.map((f) => cleave(fold((f.oracle_text ?? c.oracle_text ?? "") as string)));
    const tilde = (t: string) => [whole, part].reduce((s, re) => re ? s.replace(re, "~") : s, t).replace(THIS, "~");
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
        penny: c.penny_rank,
        reserved: !!c.reserved,
        gameChanger: !!c.game_changer,
        meld: c.layout !== "meld" ? "" : c.all_parts?.some((p: any) => p.component === "meld_result" && p.name === c.name) ? "result" : "part",
    };
}

function toPrinting(c: any, faces: any[], card: number): Printing {
    return {
        id: c.id,
        card,
        name: c.name,
        flavorName: c.flavor_name ?? faces.map((f) => f.flavor_name).filter(Boolean).join(" // "),
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
        watermarks: lower([c.watermark, ...faces.map((f) => f.watermark)].filter(Boolean)),
        flavor: faces.map((f) => f.flavor_text ?? c.flavor_text ?? ""),
        stamp: c.security_stamp ?? "",
        art: c.illustration_id ?? c.card_faces?.[0]?.illustration_id ?? "",
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

export type BulkType = "default_cards" | "oracle_tags" | "oracle_cards";

// the bulk file of this type: from SCRYFALL_BULK_DIR (as <type>.jsonl.gz, like scripts/card-data.ts), or
// downloaded into `cache` and kept a day, since Scryfall rebuilds them daily
export async function bulkFile(type: BulkType, cache: string): Promise<string> {
    const local = process.env.SCRYFALL_BULK_DIR;
    if (local) return join(local, `${type}.jsonl.gz`);
    const path = join(cache, `${type}.jsonl.gz`);
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < 24 * 3600_000) return path;
    mkdirSync(cache, { recursive: true });
    // through the shared queue for Scryfall's API (see scripts/scryfall-answers.ts); the file itself isn't on the API
    const list = await (await politeFetch("https://api.scryfall.com/bulk-data")).json() as { data: { type: string, jsonl_download_uri?: string }[] };
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
    // each set's parent set (tdc's is tdm), for order:released (also from the list of sets)
    parents: Map<string, string>,
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
    const res = await politeFetch("https://api.scryfall.com/sets");
    if (!res.ok) throw new Error(`sets: ${res.status}`);
    writeFileSync(path, await res.text());
    return path;
}

// a Tagger tag's name with only its letters and digits, as Scryfall matches a tag's aliases
const tagKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// where Scryfall's search is behind Tagger's tree in the bulk file: a tag new to the tree finds nothing there yet
// (otag:protects-self), and the tags moved under it still count under their old parent (otag:protection finds
// gains-hexproof's cards). Found by asking Scryfall, 7 Oct 2026; drop an entry once Scryfall has caught up
const TAG_LAG = {
    unknown: ["protects-self"],
    parents: { "gains-hexproof": "protection", "gains-shroud": "protection", "gains-protection": "protection" } as Record<string, string>,
};

// every card and printing (default_cards), each Tagger tag's cards (a tag's cards include its child tags', as
// on Scryfall), the sets' blocks, and the printing Scryfall shows each card with (oracle_cards, by default the one
// next to default_cards; see byPreference)
export async function loadCards(printsPath: string, tagsPath?: string, setsPath?: string, shownPath = join(dirname(printsPath), "oracle_cards.jsonl.gz")): Promise<Cards> {
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
        // legal in a format if any printing is: Ancestral Recall's Alpha one is restricted in Old School, its
        // 30th Anniversary one not legal
        for (const [format, status] of Object.entries(c.legalities ?? {})) {
            if (status === "legal" || status === "restricted") cards[card].legal.add(format);
            if (status === "restricted") cards[card].restricted.add(format);
            if (status === "banned") cards[card].banned.add(format);
        }
        const first = setDates.get(c.set);
        if (c.released_at && (!first || c.released_at < first)) setDates.set(c.set, c.released_at);
    }
    for (const [i, c] of cards.entries()) c.funny = FUNNY_CARDS.has(c.name) || (funnyPrinting.has(i) && !c.legal.size && !c.banned.size);
    const tags = new Map<string, Set<string>>();
    if (tagsPath && existsSync(tagsPath)) {
        const byId = new Map<string, { slug: string, aliases: string[], children: string[], cards: string[] }>();
        for await (const t of jsonLines(tagsPath)) {
            byId.set(t.id, { slug: t.slug, aliases: t.aliases ?? [], children: t.child_ids ?? [], cards: (t.taggings ?? []).map((g: any) => g.oracle_id) });
        }
        const idOf = new Map([...byId].map(([id, t]) => [t.slug, id]));
        for (const [child, parent] of Object.entries(TAG_LAG.parents)) {
            const c = idOf.get(child), p = byId.get(idOf.get(parent) ?? "");
            if (c && p && !p.children.includes(c)) p.children.push(c);
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
            if (!TAG_LAG.unknown.includes(t.slug)) gather(id, into, new Set());
            tags.set(t.slug, into);
            // and by its aliases, punctuation aside: otag:board-wipe is sweeper, by its alias "boardwipe"
            for (const name of [t.slug, ...t.aliases]) if (!tags.has(tagKey(name))) tags.set(tagKey(name), into);
        }
    }
    const blocks = new Map<string, string>(), parents = new Map<string, string>();
    if (setsPath && existsSync(setsPath)) {
        for (const s of JSON.parse(readFileSync(setsPath, "utf8")).data ?? []) {
            if (s.block_code) blocks.set(s.code, s.block_code);
            if (s.parent_set_code) parents.set(s.code, s.parent_set_code);
        }
    }
    // Scryfall's oracle_cards file holds a printing for each card, "the most up-to-date recognizable version": the
    // one its search shows, every card of 1,925 checked against a search for every card (mv>=0, 9 Oct 2026)
    if (shownPath && existsSync(shownPath)) {
        const byId = new Map(prints.map((p, i) => [p.id, i]));
        const lines = createInterface({ input: createReadStream(shownPath).pipe(createGunzip()), crlfDelay: Infinity });
        // a card's own id is the first in its line; parsing each whole would take seconds
        for await (const line of lines) {
            const p = byId.get(/"id":"([^"]+)"/.exec(line)?.[1] ?? "");
            if (p !== undefined) cards[prints[p].card].shown = p;
        }
    }
    const promoTypes = new Set(prints.flatMap((p) => [...p.promoTypes]));
    return { cards, prints, tags, setDates, blocks, parents, promoTypes };
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

// Scryfall reads the minus in -mv=2 as part of the key, an unknown one, and drops the whole term (it warns
// "Invalid expression"): so -mv=2 t:sliver is every sliver, and -mv=2 or t:goblin only goblins. It does so for
// the number keys in MINUS_DROPPED (shared with the search box, which warns about them); -mv:even, -(mv=2),
// mv!=2, -c=2 and -r>=rare are read as meant. And it keeps the term but drops the minus for date:
// -date>=2020-01-01 is date>=2020-01-01

export function parse(q: string): Node {
    const tokens = tokenize(q);
    let at = 0;
    // each returns null for a part that's all dropped terms, which is then left out
    const expr = (): Node | null => {
        const any = [all()];
        while (tokens[at] === "or") { at++; any.push(all()); }
        const kept = any.filter((n): n is Node => n !== null);
        return kept.length > 1 ? { or: kept } : kept[0] ?? null;
    };
    const all = (): Node | null => {
        const parts: (Node | null)[] = [];
        while (at < tokens.length && tokens[at] !== ")" && tokens[at] !== "or") {
            if (tokens[at] === "and") { at++; continue; }
            parts.push(one());
        }
        if (!parts.length) throw new Unsupported("empty group");
        const kept = parts.filter((n): n is Node => n !== null);
        return kept.length > 1 ? { and: kept } : kept[0] ?? null;
    };
    const one = (): Node | null => {
        const t = tokens[at++];
        if (t === "-") {
            const next = tokens[at];
            if (typeof next === "object" && MINUS_DROPPED.has(next.key) && !next.regex && !/^(even|odd)$/i.test(next.value)) { at++; return null; }
            if (typeof next === "object" && next.key === "date") return one();
            // which cards have printings in other languages needs every language's (the all_cards bulk file)
            if (typeof next === "object" && (next.key === "lang" || next.key === "language")) throw new Unsupported("-lang: needs every language's printings");
            const inner = one();
            return inner && { not: inner };
        }
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
    if (!node) throw new Unsupported("every term is one Scryfall ignores");
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
// and so are the types a card's text gives it: "Burakos is also a Cleric, Rogue, Warrior, and Wizard"
const hasType = (c: LocalCard, re: RegExp) => anyFace(c, re) || c.keywords.has("changeling")
    || c.text.some((t) => [...t.matchAll(/\bis also an? ([^.]*)/gi)].some((m) => re.test(m[1].toLowerCase())));


// a commander by its type or text, whatever the ban list says (see is:commander)
const canLead = (c: LocalCard) => c.meld !== "result" && (
    /\blegendary\b/.test(c.faceTypes[0]) && (/\b(creature|background)\b/.test(c.faceTypes[0]) || (/\b(vehicle|spacecraft)\b/.test(c.faceTypes[0]) && c.power[0] !== undefined))
    || c.text.some((t) => /can be your commander|isn't on the battlefield, it's a [^.]*\bcreature\b/i.test(t)));

// the is: shortcuts, by what they look at
const IS_CARD: Record<string, (c: LocalCard, data: Cards) => boolean> = {
    // the front face is a legendary creature or a Background, or the card says so
    // the front face is a legendary creature or Background, or a legendary Vehicle or Spacecraft with power and
    // toughness (The Falcon, Airship Restored), or the card says so ("can be your commander", Grist's "it's a 1/1
    // Insect creature" off the battlefield); but not a card banned in Commander (Leovold) or a meld card's back
    commander: (c) => !c.banned.has("commander") && canLead(c),
    // can be your Brawl commander: one that could lead a Commander deck (Leovold too: it's banned only there) or
    // a legendary planeswalker, legal in Brawl
    brawler: (c) => c.legal.has("brawl") && (canLead(c) || /\blegendary\b.*\bplaneswalker\b/.test(c.faceTypes[0])),
    // a face that can be cast and isn't a land: Ishgard, the Holy See // Faith & Grief is one by its back, but
    // not Westvale Abbey, whose back face comes by transforming. Attractions, Contraptions, Dungeons and
    // Conspiracies aren't
    spell: (c) => (["transform", "meld", "flip"].includes(c.layout) ? c.faceTypes.slice(0, 1) : c.faceTypes).some((t) =>
        /\b(artifact|creature|enchantment|instant|sorcery|planeswalker|battle|kindred|tribal)\b/.test(t) && !/\b(land|attraction|contraption|dungeon|conspiracy)\b/.test(t)),
    permanent: (c) => anyFace(c, /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/),
    historic: (c) => anyFace(c, /\b(legendary|artifact|saga)\b/),
    party: (c) => isCreature(c) && hasType(c, /\b(cleric|rogue|warrior|wizard)\b/),
    outlaw: (c) => hasType(c, /\b(assassin|mercenary|pirate|rogue|warlock)\b/),
    // the front face is a creature with no rules text at all
    vanilla: (c) => /\bcreature\b/.test(c.faceTypes[0]) && !/\bland\b/.test(c.faceTypes[0]) && !c.text[0]?.trim(),
    // every line starts with one of its keywords, then ends, or goes on with ", " (anything after it), a cost
    // ("Prototype {2}{R} — 3/2" and "Swampcycling {2}, …" too, but not an activated one, "Waterbend {3}: …"),
    // "—" or reminder text: "Protection from red", "Bushido 1", "Revolt — …", "Flying; banding" and a line of
    // reminder text alone don't count, but "First strike, protection from white" does
    frenchvanilla: (c) => {
        if (!isCreature(c) || !c.keywords.size || !c.fullText.some((t) => t.trim())) return false;
        const line = new RegExp(`^(?:${[...c.keywords].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})(?:$|, | (?:\\{[^}]+\\})+(?:$|, | — | \\()|—| \\()`, "i");
        // and no activated ability: "Waterbend {5}, {T}: …"
        return c.fullText.every((t) => t.split("\n").every((l) => line.test(l) && !/^[^(—]*:/.test(l)));
    },
    // a 2/2 front face at mana value 2, Vehicles too (High-Speed Hoverbike): Scorned Villager // Moonscarred
    // Werewolf isn't one by its 2/2 back
    bear: (c) => c.mv === 2 && c.power[0] === "2" && c.toughness[0] === "2",
    // a bulleted list of modes (Confluences, Sieges, "An opponent chooses one —"), Bloomburrow's Seasons ("{P}
    // worth of modes") or a keyword that works the same way
    modal: (c) => c.text.some((t) => /^•|\bworth of modes\b/m.test(t)) || ["spree", "tiered", "escalate", "entwine"].some((k) => c.keywords.has(k)),
    // the front face's cost: Hallway Heckler // Vicious Verse isn't, by {B/R} on its prepared spell
    hybrid: (c) => [...manaSymbols(c.manaCosts[0] ?? "").keys()].some((s) => s.split("/").filter((p) => p !== "P").length >= 2),
    // {W/P} and the like; not Bloomburrow's paw print {P}
    phyrexian: (c) => symbolsOf(c).some((s) => /\/P$/.test(s)),
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
    alchemy: (p) => p.setType === "alchemy" || p.promoTypes.has("rebalanced"),
    rebalanced: (p) => p.promoTypes.has("rebalanced"),
    universesbeyond: (p) => p.stamp === "triangle" || p.promoTypes.has("universesbeyond"),
    ub: (p) => p.stamp === "triangle" || p.promoTypes.has("universesbeyond"),
    booster: (p) => p.booster,
    hires: (p) => p.hires,
    masterpiece: (p) => p.setType === "masterpiece",
    colorshifted: (p) => p.frameEffects.has("colorshifted"),
};

// Scryfall's is: names for promo types that differ from the bulk files' own. Not is:intro or is:media: those
// are wider than the intropack and mediainsert promo types
const PROMO_NAMES: Record<string, string> = { judge: "judgegift" };

// the land groups (is:fetchland, is:shockland…): Scryfall keeps them by hand, so they're its own lists, kept in
// land-cycles.json by npm run land-cycles. is:manland is is:creatureland
const LAND_CYCLES: Record<string, Set<string>> = Object.fromEntries(Object.entries(
    JSON.parse(readFileSync(new URL("./land-cycles.json", import.meta.url), "utf8")) as Record<string, string[]>,
).map(([cycle, names]) => [cycle, new Set(names)]));
// and their other names, from Scryfall's syntax guide
const LAND_NAMES: Record<string, string> = { manland: "creatureland", cycleland: "bikeland", bicycleland: "bikeland", crowdland: "bondland", bbdland: "bondland",
    battlebondland: "bondland", karoo: "bounceland", canland: "canopyland", snarl: "shadowland", battleland: "tangoland", trikeland: "tricycleland", triome: "tricycleland" };
for (const [alias, cycle] of Object.entries(LAND_NAMES)) LAND_CYCLES[alias] = LAND_CYCLES[cycle];

// every is: value this search knows, for scripts/test-keys.ts to check one by one
export const isValues = (data: Cards) => [...new Set([...Object.keys(IS_CARD), ...Object.keys(IS_PRINT), ...Object.keys(LAND_CYCLES), ...Object.keys(PROMO_NAMES), ...data.promoTypes])].sort();

// keys that change how results are shown, not which cards match
const DISPLAY = new Set(["unique", "order", "direction", "display", "prefer", "include", "lang", "sort"]);

type Test = { level: "card", fn: (c: LocalCard) => boolean } | { level: "print", fn: (p: Printing, c: LocalCard) => boolean };
const card = (fn: (c: LocalCard) => boolean): Test => ({ level: "card", fn });
const print = (fn: (p: Printing, c: LocalCard) => boolean): Test => ({ level: "print", fn });

function compile(t: Term, data: Cards): Test {
    const plainOrRegex = (op: string) => {
        if (op !== ":" && op !== "=") throw new Unsupported(`${t.key}${t.op}`);
        // both sides with their accents off (rules text already is): a:"zoltan boros" is Zoltán Boros
        const plain = (s: string) => /[^\x00-\x7f]/.test(s) ? fold(s) : s;
        if (t.regex) { const re = t.regex; return (list: string[]) => list.some((s) => re.test(plain(s))); }
        const v = fold(t.value).toLowerCase();
        return (list: string[]) => list.some((s) => plain(s).toLowerCase().includes(v));
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
        case "t": case "type": {
            // a type's own name is a whole word (t:human isn't Inhuman, t:ape isn't Shapeshifter); anything else
            // is part of the type line (t:uman, t:art)
            const v = t.value.toLowerCase();
            if (!t.regex && (t.op === ":" || t.op === "=") && TYPES.has(v)) {
                const re = new RegExp(`(^|[^a-z])${escapeRe(v)}($|[^a-z])`);
                return card((c) => c.faceTypes.some((s) => re.test(s)));
            }
            const m = plainOrRegex(t.op);
            return card((c) => m(t.regex ? [c.types] : c.faceTypes));
        }
        // the whole name, a reversible printing's own ("Bolt // Bolt") and, unless it's a regex, a printing's
        // flavor name (name:"green dragon inn" is Homeward Path); a face's name alone doesn't count
        case "name": case "word": { const m = plainOrRegex(t.op); return print((p, c) => m(t.regex ? [c.name, p.name] : [c.name, p.name, p.flavorName])); }
        case "!": return card((c) => c.name.toLowerCase() === v || c.faceNames.some((n) => n.toLowerCase() === v));
        case "c": case "color": { const m = colorTest(t.op, t.value, ">="); return card((c) => c.faceColors.some(m)); }
        case "id": case "identity": case "ci": case "commander": { const m = colorTest(t.op, t.value, "<="); return card((c) => m(c.identity)); }
        case "produces": { const m = colorTest(t.op, t.value, ">=", true); return card((c) => m(c.produced)); }
        case "has":
            if (v === "indicator") return card((c) => c.indicator);
            if (v === "watermark") return print((p) => p.watermarks.size > 0);
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
            const cards = data.tags.get(v) ?? data.tags.get(tagKey(v));
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
        case "wm": case "watermark": return print((p) => p.watermarks.has(v));
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
        // permanents by how many of a color's mana symbols their cost has, a hybrid one counting for both of its
        // colors: devotion:{G}{G}{G} is three or more, devotion:{G/U}{G/U} two or more that are green or blue
        case "devotion": {
            const want = [...manaSymbols(t.value)].flatMap(([sym, n]) => Array(n).fill(sym) as string[]);
            const colors = new Set(want.flatMap((sym) => sym.split("/")).filter((l) => /^[WUBRG]$/.test(l)));
            if (!colors.size) throw new Unsupported(`devotion:${t.value}`);
            const op = t.op === ":" ? ">=" : t.op;
            return card((c) => /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/.test(c.faceTypes[0]) && compare(op,
                [...manaSymbols(c.manaCosts[0] ?? "")].reduce((sum, [sym, n]) => sum + (sym.split("/").some((l) => colors.has(l)) ? n : 0), 0), want.length));
        }
        // a printing that's the first of its card with this rarity (promos aside), art, flavor text or frame
        // (Lotus Cobra's 2012 promo was rare, but Iconic Masters is new:rarity). Flavor text by its letters only:
        // ". . ." is "...", and "Ætheric" "aetheric"
        case "new": {
            const letters = (s: string) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, "");
            const field: Record<string, (p: Printing) => string> = { rarity: (p) => p.rarity, art: (p) => p.art, flavor: (p) => letters(p.flavor.join("")), frame: (p) => p.frame };
            const of = field[v];
            if (!of) throw new Unsupported(`new:${v}`);
            return print((p, c) => {
                const earlier = c.printings.map((i) => data.prints[i]).filter((q) => q.released < p.released && !(v === "rarity" && q.promo));
                return !!of(p) && !earlier.some((q) => of(q) === of(p));
            });
        }
        // each card's cheapest printing in this currency
        case "cheapest": {
            if (!["usd", "eur", "tix"].includes(v)) throw new Unsupported(`cheapest:${v}`);
            const key = v as "usd" | "eur" | "tix";
            return print((p, c) => {
                if (p[key] === undefined) return false;
                return !c.printings.some((i) => { const q = data.prints[i]; return !q.extra && q[key] !== undefined && q[key]! < p[key]!; });
            });
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

// is: keys for printings that are hidden themselves, so asking for them shows them
const PRINT_REVEALS = new Set(["playtest", "oversized", "thick", "surgefoil"]);

// how much of what Scryfall hides by default the search asks for, as a level a hidden printing needs (NEEDS):
// include:extras or naming a set shows everything; naming a hidden type, a name: regex, an artist, a
// watermark, a border, is:dfc or is:funny shows the "extra" ones
const NEEDS: Record<Printing["extra"], number> = { "": 0, extra: 1, setOnly: 2 };
// Naming a set shows its hidden printings to its own part of the search only ("set"): (s:neo or t:sorcery)
// doesn't show the hidden sorceries, s:neo t:dragon does show NEO's dragon tokens. Everything else shows them to
// the whole search ("all"): r:uncommon or o:draw wm:phyrexian shows hidden uncommons too
function revealed(node: Node, negated = false, scope: "all" | "set" = "all"): number {
    if ("term" in node) {
        const { key, value } = node.term;
        // -s:tsp doesn't
        if (["s", "e", "set", "edition"].includes(key)) return scope === "set" && !negated ? 2 : 0;
        if (scope === "set") return 0;
        if (key === "include" && value.toLowerCase() === "extras") return 2;
        // a name: regex does, even the World Championship bios (name:/lightning/ finds the Lightning Bolt art
        // card, name:/^a/ Antoine Ruel Bio), but not name:lightning, and not -name:/dragon/
        if (key === "name" && node.term.regex && !negated) return 2;
        if ((key === "t" || key === "type") && /^(token|emblem|plane|phenomenon|scheme|vanguard|card)$/i.test(value)) return 1;
        // is:dfc shows double-faced tokens, art cards and playtest cards, and -is:dfc everything else;
        // is:transform doesn't
        if (key === "is" && value.toLowerCase() === "dfc") return negated ? 2 : 1;
        // and some kinds of printing that are hidden themselves: is:playtest, is:oversized, is:thick, is:surgefoil
        // (the surge-foil tokens), but not is:stamped or is:setpromo
        if (key === "is" && !negated && PRINT_REVEALS.has(value.toLowerCase())) return 1;
        // and further: is:oversized finds the gold-bordered oversized cards, is:reserved the withdrawn ones
        if (key === "is" && !negated && ["oversized", "reserved"].includes(value.toLowerCase())) return 2;
        // banned: and restricted: show the withdrawn cards (banned:legacy finds Jihad); f:oldschool doesn't
        if (["banned", "restricted"].includes(key) && !negated) return 2;
        // so do artists and watermarks, even left out: a:proce finds his Elemental token, wm:izzet the Weird //
        // Goblin one, and -wm:set t:sliver every sliver token; and border:silver, the silver tokens (not
        // border:black or borderless, or -border:black)
        // (left out, an artist shows everything, as include:extras does)
        if (["a", "artist"].includes(key)) return negated ? 2 : 1;
        if (["wm", "watermark"].includes(key) || (key === "border" && !negated && value.toLowerCase() === "silver")) return 1;
        if (key === "has" && value.toLowerCase() === "watermark") return 1;
        // is:funny shows funny tokens too, like the Dragon
        if (key === "is" && value.toLowerCase() === "funny" && !negated) return 1;
        return 0;
    }
    if ("not" in node) return revealed(node.not, !negated, scope);
    // a set shows its printings to every part of an AND, but to an OR's other branches only if they name sets
    // too (each branch shows more for itself, see evaluate)
    const each = ("and" in node ? node.and : node.or).map((part) => revealed(part, negated, scope));
    return "and" in node || scope === "all" ? Math.max(...each) : Math.min(...each);
}

// the printings among `prints` that match. What Scryfall hides is left out part by part: `level` is what the
// search around this part shows, and a part naming a set shows more for itself (see revealed)
function evaluate(node: Node, data: Cards, all: number[], level = 0, negated = false): number[] {
    const shown = Math.max(level, revealed(node, negated, "set"));
    const prints = all.filter((i) => NEEDS[data.prints[i].extra] <= shown);
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
    if ("and" in node) return node.and.reduce((left, part) => left.length ? evaluate(part, data, left, shown, negated) : left, prints);
    if ("or" in node) {
        const hit = new Set<number>();
        for (const part of node.or) for (const i of evaluate(part, data, all, shown, negated)) hit.add(i);
        return all.filter((i) => hit.has(i));
    }
    // Scryfall's comparisons are its database's: a card without a power has no answer to tou>pow, and "not" of no
    // answer is no answer either, so -(tou>pow or o:draw) leaves out every card without power and toughness
    const out = new Set(evaluate(node.not, data, prints, shown, !negated));
    const stats = statsIn(node.not);
    return prints.filter((i) => !out.has(i) && stats.every((has) => has(data.cards[data.prints[i].card])));
}

// for each stat a search compares (pow, tou, loy, pt), whether a card has it
function statsIn(node: Node): ((c: LocalCard) => boolean)[] {
    if ("term" in node) {
        const keys = [node.term.key, ...(/^(pow|power|tou|toughness|loy|loyalty|pt|powtou)$/.test(node.term.value.toLowerCase()) ? [node.term.value.toLowerCase()] : [])];
        return keys.flatMap((k) => /^(pow|power|pt|powtou)$/.test(k) ? [(c: LocalCard) => c.power.some((v) => v !== undefined)]
            : /^(tou|toughness)$/.test(k) ? [(c: LocalCard) => c.toughness.some((v) => v !== undefined)]
            : /^(loy|loyalty)$/.test(k) ? [(c: LocalCard) => c.loyalty.some((v) => v !== undefined)] : []);
    }
    if ("not" in node) return statsIn(node.not);
    return ("and" in node ? node.and : node.or).flatMap(statsIn);
}

// the cards (as indexes into `cards`) among `among` with a printing that matches the whole search
export function search(node: Node, data: Cards, among?: number[]): number[] {
    const seen = new Set<number>(), out: number[] = [];
    for (const p of searchPrintings(node, data, among)) {
        const c = data.prints[p].card;
        if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
}

// the printings (as indexes into `prints`) that match the whole search, among those it shows
export function searchPrintings(node: Node, data: Cards, among?: number[]): number[] {
    const prints: number[] = [];
    for (const c of among ?? data.cards.keys()) prints.push(...data.cards[c].printings);
    return evaluate(node, data, prints, revealed(node));
}

// ---- which printing each card is shown with ----

// Scryfall goes through a card's printings in one order to pick the one it shows: its "preferred" printings
// newest first, then the rest newest first. That order is plain in a unique:prints search (by name, each card's
// printings come in it: Lightning Bolt's msc, clu, 2x2, clb, jmp … lea, then plst, fdc, slz, sld …), and the
// first is the printing the card is shown with: oracle_cards' printing (see loadCards), where it has one.
// What isn't preferred, found by comparing with oracle_cards' 21,434 cards with more than one printing (the rule
// below picks the same printing for 98.6% of them) and with 8,668 printings' places in unique:prints answers (99.5%
// right): other languages; promos, The List; masterpieces, Secret Lairs and other boxed products (not Game Night or
// the Arena starter kit), memorabilia and the like
const SPECIAL_SET_TYPES = new Set(["box", "masterpiece", "memorabilia", "treasure_chest", "from_the_vault", "premium_deck", "spellbook", "promo", "token", "minigame"]);
const KEPT_SETS = new Set(["gnt", "gn2", "oana", "inr"]);
// special frames, borderless or full art (a foil-only printing is fine: 7ed's 289★ comes before the older ones);
// Arena-only printings; a Universes Beyond reprint with the triangle stamp (Sol Ring's fic, pip, who, ltc and 40k
// printings come after every other, but the cards new in those sets are preferred); and the old frames on a
// printing from 2015 on (Cloudshredder Sliver's Time Spiral Remastered one, The Brothers' War Commander's
// artifacts), though not on Masters Edition or Innistrad Remastered's
// (Planar Chaos's colorshifted cards are preferred: Sinew Sliver's plc/30 before plst/PLC-30)
const SPECIAL_FRAMES = new Set(["showcase", "extendedart", "inverted", "etched", "fullart", "textless", "shatteredglass"]);
// and these sets, though nothing in the bulk files tells their printings from others': Cemetery Reaper's mic,
// scd, drc and fdc printings differ in nothing but the set, yet mic's is shown and the other three come after
// every older printing. Mostly reprint products (Jumpstart 2022 and Foundations Jumpstart, Mystery Booster 2,
// Starter Commander Decks) and some commander decks; learned from oracle_cards, so a new set may need adding
const LOW_SETS = new Set(["anb", "blc", "drc", "fdc", "h2r", "j22", "j25", "m3c", "mb2", "onc", "plst", "punk", "scd", "tblc", "tdft", "tdrc", "tlcc", "tncc", "tscd", "ttdc", "woc", "ymid", "yotj"]);
export function preferred(p: Printing): boolean {
    return p.lang === "en" && !p.promo && (!SPECIAL_SET_TYPES.has(p.setType) || KEPT_SETS.has(p.set)) && !LOW_SETS.has(p.set)
        && ![...p.frameEffects].some((f) => SPECIAL_FRAMES.has(f)) && (p.border === "black" || p.border === "white") && !p.fullArt
        && !(p.games.size === 1 && p.games.has("arena")) && !(p.stamp === "triangle" && p.reprint)
        && !((p.frame === "1993" || p.frame === "1997") && p.released >= "2015" && !KEPT_SETS.has(p.set));
}
// the number in a collector number, its digits together: 1 for "1a", "S1" or "1★", 252 for The List's "MH2-52"
// (order:set lists plst/CNS-35, AFC-50 … ISD-129, then MH2-52)
const cnNumber = (p: Printing) => Number(p.cn.replace(/\D/g, "")) || 0;
// Scryfall's order through a card's printings (see preferred): the preferred ones first, newest first, then the
// rest newest first, and last a Secret Lair's reversible printings (Dragonlord Dromoka's 2022 Magic Online promo
// comes before its 2025 reversible sld/1971). On the same day, the lower collector number first (Secret Lair's 83,
// 84, 85, 86; 1638 before 1638★). Among the rest on one day Scryfall's order has no rule found yet: one/310, 353
// and 444 come before pone/125p, but pwoe/145p before woe/350
function byPreference(data: Cards) {
    const rank = new Map<number, number>();
    const rankOf = (i: number) => {
        let r = rank.get(i);
        if (r === undefined) rank.set(i, r = preferred(data.prints[i]) ? 0 : data.prints[i].layout === "reversible_card" ? 2 : 1);
        return r;
    };
    return (a: number, b: number) => {
        const p = data.prints[a], q = data.prints[b];
        return rankOf(a) - rankOf(b) || q.released.localeCompare(p.released) || cnNumber(p) - cnNumber(q) || p.cn.localeCompare(q.cn);
    };
}

// the printing (of `among`, a card's printings that match) Scryfall shows a card with: the one it always shows,
// when it matches, otherwise the first that matches in its order (see byPreference); `prefer:` changes this
function pickPrinting(c: LocalCard, among: number[], data: Cards, prefer: string, order: (a: number, b: number) => number): number {
    if (among.length === 1) return among[0];
    const first = (cmp: (a: number, b: number) => number) => among.reduce((best, i) => cmp(i, best) < 0 ? i : best);
    const date = (i: number) => data.prints[i].released;
    switch (prefer) {
        case "oldest": return first((a, b) => date(a).localeCompare(date(b)) || order(a, b));
        case "newest": return first((a, b) => date(b).localeCompare(date(a)) || order(a, b));
    }
    const price = /^(usd|eur|tix)-(low|high)$/.exec(prefer);
    if (price) {
        const key = price[1] as "usd" | "eur" | "tix", sign = price[2] === "low" ? 1 : -1;
        return first((a, b) => {
            const x = data.prints[a][key], y = data.prints[b][key];
            if (x === y) return order(a, b);
            if (x === undefined) return 1;
            if (y === undefined) return -1;
            return (x - y) * sign;
        });
    }
    const group = PREFER_GROUPS[prefer];
    if (group) return first((a, b) => Number(group(data.prints[b])) - Number(group(data.prints[a])) || order(a, b));
    if (prefer && prefer !== "default") throw new Unsupported(`prefer:${prefer}`);
    if (c.shown !== undefined && among.includes(c.shown)) return c.shown;
    return first(order);
}
// prefer: kinds of printing put first
const ub = (p: Printing) => p.stamp === "triangle" || p.promoTypes.has("universesbeyond");
const PREFER_GROUPS: Record<string, (p: Printing) => boolean> = {
    promo: (p) => p.promo,
    ub, universesbeyond: ub,
    notub: (p) => !ub(p), notuniversesbeyond: (p) => !ub(p),
};

// ---- what's listed, and in what order ----

// how a search's results are shown: the API's own parameters (the app sends order, dir and unique), or the same
// as keys in the search (order:, direction:, unique:, prefer:), which win
export type View = { order?: string, dir?: string, unique?: string, prefer?: string };

// the value of a key anywhere in the search (order:, unique:…)
function findTerm(node: Node, keys: string[]): string | undefined {
    if ("term" in node) return keys.includes(node.term.key) ? node.term.value.toLowerCase() : undefined;
    if ("not" in node) return findTerm(node.not, keys);
    let found: string | undefined;
    for (const part of "and" in node ? node.and : node.or) found = findTerm(part, keys) ?? found;
    return found;
}

function viewOf(node: Node, view: View): Required<View> {
    return {
        order: findTerm(node, ["order", "sort"]) ?? view.order?.toLowerCase() ?? "name",
        dir: findTerm(node, ["direction", "dir"]) ?? view.dir?.toLowerCase() ?? "auto",
        unique: findTerm(node, ["unique"]) ?? view.unique?.toLowerCase() ?? "cards",
        prefer: findTerm(node, ["prefer"]) ?? view.prefer?.toLowerCase() ?? "",
    };
}

// what Scryfall lists for a search, in its order: a printing each (as indexes into `prints`), one a card (the
// default), every printing for unique:prints, or each card's art once for unique:art
export function results(node: Node, data: Cards, view: View = {}): number[] {
    const v = viewOf(node, view);
    const how = ORDERS[v.order];
    if (!how) throw new Unsupported(`order:${v.order}`);
    if (!["cards", "prints", "art"].includes(v.unique)) throw new Unsupported(`unique:${v.unique}`);
    const order = byPreference(data);
    const byCard = new Map<number, number[]>();
    for (const p of searchPrintings(node, data)) {
        const c = data.prints[p].card;
        const list = byCard.get(c);
        if (list) list.push(p); else byCard.set(c, [p]);
    }
    // sorted by a price, a card is shown with its cheapest printing that has one, whatever the direction: Eater of
    // the Dead with its mb2 printing (1.31 euros, not drk's 5.15 or me1's none), Wall of Roots by tix with its 2013
    // promo (3.80, the least of five). Between printings as cheap, and when none has a price, the one that comes
    // last in Scryfall's order (see byPreference): Mordor Trebuchet's ltr/548 rather than ltr/97 at 0.03 tix, Whip
    // Vine's all/103b rather than 103a. Otherwise see pickPrinting
    const pick = (c: number, list: number[]) => {
        const key = how.price;
        if (!key || v.prefer) return pickPrinting(data.cards[c], list, data, v.prefer, order);
        const price = (p: number) => data.prints[p][key] ?? Infinity;
        // as cheap: the ones that aren't preferred first, newest first, the higher number first
        const last = (a: number, b: number) => Number(preferred(data.prints[a])) - Number(preferred(data.prints[b]))
            || data.prints[b].released.localeCompare(data.prints[a].released) || cnNumber(data.prints[b]) - cnNumber(data.prints[a]);
        return list.reduce((best, p) => (price(p) - price(best) || last(p, best)) < 0 ? p : best);
    };
    const entries: number[] = [];
    for (const [c, list] of byCard) {
        if (v.unique === "prints") { entries.push(...list); continue; }
        if (v.unique === "cards") { entries.push(pick(c, list)); continue; }
        // an art each: the printings with the same illustration, each shown with its first preferred printing (see
        // preferred), not the newest: Phyrexian Metamorph's nph/42 and 2xm/341, Cogwork Assembler's aer/145,
        // Talara's Battalion's eve/77, not their reprints. prefer: and a price order still pick their own
        const arts = new Map<string, number[]>();
        for (const p of list) { const a = data.prints[p].art || data.prints[p].id; arts.set(a, [...arts.get(a) ?? [], p]); }
        const first = (group: number[]) => group.reduce((best, p) => (Number(preferred(data.prints[best])) - Number(preferred(data.prints[p])) || data.prints[p].released.localeCompare(data.prints[best].released) || order(p, best)) < 0 ? p : best);
        for (const group of arts.values()) entries.push(v.prefer || how.price ? pick(c, group) : first(group));
    }
    return sortEntries(entries, data, how, v, order);
}

// a card each (the default), or a printing or art each: their cards' oracle ids, for comparing what was found
export function listed(node: Node, data: Cards, view: View = {}): string[] {
    return results(node, data, view).map((p) => data.cards[data.prints[p].card].oracleId);
}

// a card's name as Scryfall sorts it: letters only, accents and case aside
const byName = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true }).compare;
const WUBRG = ["w", "u", "b", "r", "g"];
// rarities as order:rarity ranks them: special between rare and mythic (Essence Sliver's tsb printing comes
// after the mythics and before the rares)
const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, special: 3, mythic: 4, bonus: 5 };

// each order: what an entry sorts by (its card's or its printing's), ascending as Scryfall's table puts it.
// `high`: direction:auto lists the highest first. `missing`: where what has no value goes, as if it were the
// lowest value ("low": first ascending, last descending) or the highest. `byDate`: ties go by set and collector
// number, turned round with the rest (order:released); otherwise by name. `price`: see `pick` in results
type Order = { key: (p: Printing, c: LocalCard) => number | string | undefined, missing?: "low" | "high", high?: boolean, byDate?: boolean, price?: "usd" | "eur" | "tix" };
// colors as order:color lists them: white, blue, black, red, green, then two colors in the guilds' order (the
// allied pairs, then the enemy ones: Crystalline Sliver WU, Dementia UB … Harmonic GW, Necrotic WB … Dormant GU),
// then three, four and five, then colorless
const COLOR_GROUPS = ["w", "u", "b", "r", "g", "wu", "ub", "br", "rg", "gw", "wb", "ur", "bg", "rw", "gu",
    "wub", "ubr", "brg", "rgw", "gwu", "wbg", "urw", "bgu", "rwb", "gur", "wubr", "ubrg", "brgw", "rgwu", "gwub", "wubrg"]
    .map((g) => [...g].sort().join(""));
const ORDERS: Record<string, Order> = {
    name: { key: () => 0 },
    cmc: { key: (_, c) => c.mv },
    power: { key: (_, c) => c.power[0] === undefined ? undefined : statNumber(c.power[0]), missing: "low" },
    toughness: { key: (_, c) => c.toughness[0] === undefined ? undefined : statNumber(c.toughness[0]), missing: "low" },
    color: { key: (_, c) => {
        // the front face's (a split card's are both halves'): Heliod, the Radiant Dawn is white, not white-blue
        const colors = [...c.faceColors[0] ?? []].filter((l) => WUBRG.includes(l)).sort().join("");
        return colors ? COLOR_GROUPS.indexOf(colors) : 99;
    } },
    // unranked cards count as the highest rank: last, or first with direction:desc (Cosmic Sovereign, an Alchemy
    // card, leads f:timeless t:dragon order:edhrec direction:desc)
    edhrec: { key: (_, c) => c.edhrec, missing: "high" },
    penny: { key: (_, c) => c.penny, missing: "high" },
    // the price of the printing shown (see `pick` in results), dearest first; no price counts as the lowest
    usd: { key: (p) => p.usd, high: true, missing: "low", price: "usd" },
    eur: { key: (p) => p.eur, high: true, missing: "low", price: "eur" },
    tix: { key: (p) => p.tix, high: true, missing: "low", price: "tix" },
    // newest first
    released: { key: (p) => p.released, high: true, byDate: true },
    rarity: { key: (p) => RARITY_RANK[p.rarity] ?? -1, high: true },
    // by set code, then collector number
    set: { key: (p) => `${p.set}/${String(cnNumber(p)).padStart(6, "0")}/${p.cn}` },
    // letters only, as names are: Lucas Graciano before Luca Zontini
    artist: { key: (p) => p.artist, missing: "high" },
};
ORDERS.mv = ORDERS.manavalue = ORDERS.cmc;
ORDERS.pow = ORDERS.power;
ORDERS.tou = ORDERS.toughness;

function sortEntries(entries: number[], data: Cards, how: Order, v: Required<View>, order: (a: number, b: number) => number): number[] {
    const flip = v.dir === "desc" || (v.dir === "auto" && how.high) ? -1 : 1;
    const keys = new Map(entries.map((p) => [p, how.key(data.prints[p], data.cards[data.prints[p].card])]));
    const tie = (a: number, b: number) => {
        const p = data.prints[a], q = data.prints[b];
        // released: on the same day a set comes before its parent set, whichever the direction (tdc/309 before
        // tdm/400 descending, tsb/8 before tsp/37 ascending, hoc before hob); otherwise by set code and collector
        // number, turned round with the dates (direction:desc lists spg before ecc, tdm/400, 321, 319…)
        if (how.byDate) return Number(data.parents.get(q.set) === p.set) - Number(data.parents.get(p.set) === q.set) || (p.set.localeCompare(q.set) || cnNumber(p) - cnNumber(q)) * flip;
        // by name (turned round only for order:name), then a card's printings in Scryfall's own order
        return byName(data.cards[p.card].name, data.cards[q.card].name) * (v.order === "name" ? flip : 1) || order(a, b);
    };
    return [...entries].sort((a, b) => {
        const x = keys.get(a), y = keys.get(b);
        if (x !== y) {
            if (x === undefined) return (how.missing === "low" ? -1 : 1) * flip;
            if (y === undefined) return (how.missing === "low" ? 1 : -1) * flip;
            const cmp = how === ORDERS.artist ? byName(x as string, y as string) : x < y ? -1 : 1;
            if (cmp) return cmp * flip;
        }
        return tie(a, b);
    });
}

// the cards (from search) in the order Scryfall lists them, for a search shown a card each
export function sortCards(node: Node, data: Cards, cards: number[], view: View = {}): number[] {
    const wanted = new Set(cards);
    return results(node, data, { ...view, unique: "cards" }).map((p) => data.prints[p].card).filter((c) => wanted.has(c));
}
