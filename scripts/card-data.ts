// Builds the site's card data from Scryfall's daily bulk files: node scripts/card-data.ts [out dir]
// It writes into card-data/ by default; scripts/upload-card-data.sh then puts that in the R2 bucket the
// site reads it from, apart from the deploy. Paths below are as the site serves them. It writes:
//   /data/cards/<bucket>.json  one record per card, packed (see app/lib/carddata.ts for the layout)
//   /data/cards/renamed.json   the few pages whose slug is longer than the card's name
//   /data/sets.json, /data/sets/<code>.json  the list of sets, and each set's cards
//   /data/browse.json          the footer's links
//   /sitemap.xml, /sitemaps/*  one entry per card, set and page
// The bulk files come from data.scryfall.io, which has no rate limit; this makes one API call, for the
// file list, and one for the list of sets (for their icons). Set SCRYFALL_BULK_DIR to a folder holding
// default_cards.jsonl.gz, rulings.jsonl.gz and sets.json (api.scryfall.com/sets) to build from files already
// downloaded instead.
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createReadStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    DATA_DIR, LINK_TEMPLATES, SET_PAGE, SITE_URL, bucketOf, imageUris, oracleOf, paths, setPath, slug, templateLink,
    type Browse, type BucketEntry, type CardFaceText, type CardRecord, type LinkKey, type Printing, type RelatedCard, type Renamed,
    type SetCard, type SetFile, type SetSummary,
} from "../app/lib/carddata.ts";
import type { Ruling } from "../app/types.ts";

const HEADERS = { "User-Agent": "impuls_master/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };
const out = resolve(process.argv[2] ?? "card-data");
const localDir = process.env.SCRYFALL_BULK_DIR;

type BulkFile = { type: string, jsonl_download_uri?: string, updated_at: string };

async function lines(type: string, remote: () => Promise<string>) {
    let input: NodeJS.ReadableStream;
    if (localDir) {
        input = createReadStream(join(localDir, `${type}.jsonl.gz`));
    } else {
        const url = await remote();
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
        input = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    }
    return createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
}

let bulkList: Promise<BulkFile[]> | undefined;
function bulkUrl(type: string) {
    return async () => {
        bulkList ??= fetch("https://api.scryfall.com/bulk-data", { headers: HEADERS })
            .then((r) => r.json() as Promise<{ data: BulkFile[] }>).then((l) => l.data);
        const file = (await bulkList).find((f) => f.type === type);
        if (!file?.jsonl_download_uri) throw new Error(`no ${type} bulk file`);
        return file.jsonl_download_uri;
    };
}

// Scryfall's list of sets, for their icons and release dates; the sets still get pages without it
type ApiSet = { code: string, released_at?: string, icon_svg_uri?: string };
async function apiSets(): Promise<Map<string, ApiSet>> {
    try {
        const list: ApiSet[] = localDir
            ? JSON.parse(readFileSync(join(localDir, "sets.json"), "utf8")).data
            : (await (await fetch("https://api.scryfall.com/sets", { headers: HEADERS })).json() as { data: ApiSet[] }).data;
        return new Map(list.map((s) => [s.code, s]));
    } catch (err) {
        console.warn("No set list, so no set icons:", err);
        return new Map();
    }
}

let files = 0;
let bytes = 0;
function write(path: string, body: string) {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    files++;
    bytes += Buffer.byteLength(body);
}

// ---- which printing a card's page opens on ----

// the sets a player would call a normal printing, as opposed to promos, Secret Lairs, tokens, digital sets...
const REGULAR_SETS = new Set(["expansion", "core", "masters", "draft_innovation", "commander", "starter", "duel_deck", "eternal"]);
const SPECIAL_FRAMES = new Set(["showcase", "extendedart", "etched", "inverted"]);
// cards that aren't spells or permanents; they get pages but stay out of the sitemap and yield their name to real cards
const NOT_CARDS: Record<string, string> = {
    token: "token", double_faced_token: "token", emblem: "emblem", art_series: "art-card",
    vanguard: "vanguard", scheme: "scheme", planar: "plane",
};

type Facts = { paper: boolean, special: boolean, regular: boolean, english: boolean };
const today = new Date().toISOString().slice(0, 10);

function mainPrinting(prints: Printing[], facts: Map<string, Facts>): number {
    const out = (p: Printing) => p.released <= today;
    const tiers: ((p: Printing, f: Facts) => boolean)[] = [
        (p, f) => out(p) && f.paper && f.regular && !f.special && f.english,
        (p, f) => out(p) && f.paper && f.english,
        (p) => out(p),
        () => true,
    ];
    for (const tier of tiers) {
        const i = prints.findIndex((p) => tier(p, facts.get(p.id)!));
        if (i >= 0) return i;
    }
    return 0;
}

// newest first; within a day, by set and then collector number as a person would count
const collator = new Intl.Collator("en", { numeric: true });
const byNewest = (a: Printing, b: Printing) =>
    b.released.localeCompare(a.released) || a.set.localeCompare(b.set) || collator.compare(a.number, b.number);

// ---- reading the cards ----

type Building = { record: Omit<CardRecord, "slug" | "rulings" | "main">, facts: Map<string, Facts>, seen: Map<string, number> };
const cards = new Map<string, Building>();
// for the related cards: which card each printing is, and the printings each card names or makes (Scryfall's
// all_parts: tokens, meld halves, cards named in its text)
const printingOracle = new Map<string, string>();
const parts = new Map<string, Set<string>>();
// each set's name and kind, as its cards give them
const setInfo = new Map<string, { name: string, type: string, digital: boolean }>();
let linkExceptions = 0;
let imageMismatches = 0;
const mismatchExamples: string[] = [];

const clean = <T extends Record<string, unknown>>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;

function faceText(f: Record<string, any>): CardFaceText {
    return clean({
        name: f.name, oracle_id: f.oracle_id, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text,
        power: f.power, toughness: f.toughness, loyalty: f.loyalty, defense: f.defense,
    });
}

function printing(c: Record<string, any>): Printing {
    const front = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;
    const stamp = typeof front === "string" ? front.match(/\?(\d+)$/)?.[1] : undefined;
    const back = !c.image_uris && !!c.card_faces?.[1]?.image_uris;
    if (front && (!stamp || imageUris(c.id, "front", stamp).normal !== front)) {
        imageMismatches++;
        if (mismatchExamples.length < 3) mismatchExamples.push(front);
    }
    const faces = Array.isArray(c.card_faces) ? c.card_faces.map((f: Record<string, any>) => clean({ artist: f.artist, flavor: f.flavor_text })) : undefined;
    const p: Printing = clean({
        id: c.id, set: c.set, set_name: c.set_name, number: c.collector_number, rarity: c.rarity, released: c.released_at,
        lang: c.lang === "en" ? undefined : c.lang,
        artist: c.artist,
        flavor: c.flavor_text,
        // only kept when a face has something the card as a whole doesn't say
        faces: faces?.some((f: { artist?: string, flavor?: string }) => f.flavor || (f.artist && f.artist !== c.artist)) ? faces : undefined,
        img: front && stamp ? stamp : undefined,
        back: back ? 1 : undefined,
        prices: c.prices ? clean({ ...c.prices }) : undefined,
        tcg: c.tcgplayer_id, mtgo: c.mtgo_id, cm: c.cardmarket_id, mv: c.multiverse_ids?.[0],
    });
    if (p.prices && !Object.keys(p.prices).length) delete p.prices;

    // links that the templates would get wrong are stored as they are
    const actual: Record<LinkKey, string | undefined> = {
        tcgplayer: c.purchase_uris?.tcgplayer, cardmarket: c.purchase_uris?.cardmarket,
        cardhoarder: c.purchase_uris?.cardhoarder, gatherer: c.related_uris?.gatherer,
    };
    if (!actual.tcgplayer && !actual.cardmarket && !actual.cardhoarder) p.nobuy = 1;
    for (const key of Object.keys(LINK_TEMPLATES) as LinkKey[]) {
        if (templateLink(p, key, c.name) !== actual[key]) {
            (p.links ??= {})[key] = actual[key] ?? "";
            linkExceptions++;
        }
    }
    return p;
}

for await (const line of await lines("default_cards", bulkUrl("default_cards"))) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    const oracle = oracleOf(c);
    if (c.object !== "card" || typeof c.id !== "string" || !oracle) continue;

    printingOracle.set(c.id, oracle);
    if (Array.isArray(c.all_parts)) {
        let named = parts.get(oracle);
        if (!named) parts.set(oracle, named = new Set());
        for (const part of c.all_parts) if (typeof part?.id === "string") named.add(part.id);
    }
    if (!setInfo.has(c.set)) setInfo.set(c.set, { name: c.set_name, type: c.set_type, digital: !!c.digital });

    let b = cards.get(oracle);
    if (!b) {
        b = {
            record: clean({
                oracle_id: oracle, name: c.name, layout: c.layout, mana_cost: c.mana_cost, cmc: c.cmc ?? 0,
                type_line: c.type_line ?? c.card_faces?.map((f: { type_line?: string }) => f.type_line).join(" // ") ?? "",
                oracle_text: c.oracle_text, colors: c.colors, color_identity: c.color_identity ?? [], keywords: c.keywords ?? [],
                legalities: c.legalities ?? {}, reserved: c.reserved || undefined,
                power: c.power, toughness: c.toughness, loyalty: c.loyalty, defense: c.defense,
                edhrec_rank: c.edhrec_rank, edhrec: c.related_uris?.edhrec,
                faces: Array.isArray(c.card_faces) ? c.card_faces.map(faceText) : undefined,
                prints: [],
            }) as Building["record"],
            facts: new Map(),
            seen: new Map(),
        };
        cards.set(oracle, b);
    }
    // one entry per printing: the English card when Scryfall has it in more than one language
    const key = `${c.set}|${c.collector_number}`;
    const at = b.seen.get(key);
    if (at !== undefined && (b.record.prints[at].lang === undefined || c.lang !== "en")) continue;

    const p = printing(c);
    const effects: string[] = c.frame_effects ?? [];
    b.facts.set(p.id, {
        paper: (c.games ?? []).includes("paper") && !c.digital && !c.oversized,
        special: !!c.promo || c.border_color === "borderless" || !!c.full_art && !/Basic/.test(c.type_line ?? "") || effects.some((e) => SPECIAL_FRAMES.has(e)),
        regular: REGULAR_SETS.has(c.set_type),
        english: c.lang === "en",
    });
    if (at !== undefined) b.record.prints[at] = p;
    else { b.seen.set(key, b.record.prints.length); b.record.prints.push(p); }
}

// ---- rulings ----

const rulings = new Map<string, Ruling[]>();
let rulingCount = 0;
for await (const line of await lines("rulings", bulkUrl("rulings"))) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (typeof r.oracle_id !== "string") continue;
    let list = rulings.get(r.oracle_id);
    if (!list) rulings.set(r.oracle_id, list = []);
    list.push({ source: r.source, published_at: r.published_at, comment: r.comment });
    rulingCount++;
}

// ---- page slugs: the card's name, made longer only when another card has the same name ----

const records: CardRecord[] = [];
const byName = new Map<string, Building[]>();
for (const b of cards.values()) {
    const s = slug(b.record.name);
    let group = byName.get(s);
    if (!group) byName.set(s, group = []);
    group.push(b);
}
const taken = new Set(byName.keys());
const renamed: Renamed = {};
const firstOut = (b: Building) => b.record.prints.reduce((d, p) => (p.released < d ? p.released : d), "9999");
for (const [name, group] of byName) {
    // real cards before tokens and the like, then the oldest first, so a new printing never takes a slug away
    group.sort((a, b) => Number(a.record.layout in NOT_CARDS) - Number(b.record.layout in NOT_CARDS)
        || firstOut(a).localeCompare(firstOut(b)) || a.record.oracle_id.localeCompare(b.record.oracle_id));
    group.forEach((b, i) => {
        let s = name;
        if (i > 0) {
            const word = NOT_CARDS[b.record.layout];
            const stem = word ? `${name}-${word}` : name;
            s = word && !taken.has(stem) ? stem : `${stem}-2`;
            for (let n = 2; taken.has(s); n++) s = `${stem}-${n}`;
            taken.add(s);
            renamed[s] = name;
        }
        b.record.prints.sort(byNewest);
        records.push({
            ...b.record,
            slug: s,
            rulings: rulings.get(b.record.oracle_id) ?? [],
            main: mainPrinting(b.record.prints, b.facts),
        } as CardRecord);
    });
}

// ---- related cards: the cards a card names or makes, then the cards most like it ----
// These links are also how search engines get from one card's page to the next.

// the cards with pages people search for (the sitemap's list); the others don't get related cards
const listed = records
    .filter((r) => !(r.layout in NOT_CARDS) && r.prints.some((p) => p.released <= today))
    .sort((a, b) => a.slug.localeCompare(b.slug));

const RELATED = 12;
const bySlug = new Map(records.map((r) => [r.slug, r]));
const byOracle = new Map(records.map((r) => [r.oracle_id, r]));
const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Ongoing", "Host", "Elite", "Token"]);

type Traits = {
    subtypes: string[], types: string, colors: string, keywords: string[], sentences: string[], cmc: number, rank: number, real: boolean,
};
// the rules text as sentences, the card's own name as ~ and reminder text left out, so "Chain Lightning deals 3
// damage to any target." and Lightning Bolt's own text match
function sentences(r: CardRecord): string[] {
    const texts = r.faces?.length ? r.faces.map((f) => [f.name, f.oracle_text ?? ""]) : [[r.name, r.oracle_text ?? ""]];
    const out = new Set<string>();
    for (const [name, text] of texts) {
        const plain = text.replace(/\([^)]*\)/g, "").split(name).join("~").toLowerCase();
        for (const s of plain.split(/(?<=\.)\s+|\n/)) if (s.trim().length > 12) out.add(s.trim());
    }
    return [...out];
}
function traits(r: CardRecord): Traits {
    const subtypes = new Set<string>();
    const types = new Set<string>();
    for (const face of r.type_line.split(" // ")) {
        const [left, right = ""] = face.split(" — ");
        for (const t of left.split(" ")) if (t && !SUPERTYPES.has(t)) types.add(t);
        for (const t of right.split(" ")) if (t) subtypes.add(t);
    }
    return {
        subtypes: [...subtypes], types: [...types].sort().join(" "), colors: [...r.color_identity].sort().join(""),
        keywords: r.keywords, sentences: sentences(r), cmc: r.cmc, rank: r.edhrec_rank ?? Infinity,
        // legal somewhere, so Un-cards and the like are only matched with each other
        real: Object.values(r.legalities).some((v) => v !== "not_legal"),
    };
}
const all = listed.map(traits);
// who to compare each card with: the cards sharing a subtype or a sentence of rules text, and the cards of the
// same types and colors
const bySubtype = new Map<string, number[]>();
const bySentence = new Map<string, number[]>();
const byKind = new Map<string, number[]>();
const add = (index: Map<string, number[]>, key: string, i: number) => {
    let list = index.get(key);
    if (!list) index.set(key, list = []);
    list.push(i);
};
all.forEach((t, i) => {
    for (const s of t.subtypes) add(bySubtype, s, i);
    for (const s of t.sentences) add(bySentence, s, i);
    add(byKind, `${t.types}|${t.colors}`, i);
});
// a sentence on hundreds of cards ("~ can't block.", a land's mana ability) says little about either card
for (const [s, list] of bySentence) if (list.length > 300) bySentence.delete(s);

const shared = (a: string[], b: string[]) => a.reduce((n, x) => n + (b.includes(x) ? 1 : 0), 0);
function likeness(a: Traits, b: Traits) {
    let score = 3 * shared(a.subtypes, b.subtypes) + 2 * shared(a.keywords, b.keywords)
        + 4 * a.sentences.reduce((n, s) => n + (bySentence.has(s) && b.sentences.includes(s) ? 1 : 0), 0);
    if (a.colors === b.colors) score += 2;
    else if ([...a.colors].some((c) => b.colors.includes(c))) score += 1;
    if (a.types === b.types) score += 1;
    if (Math.abs(a.cmc - b.cmc) <= 1) score += 1;
    return score;
}

const related = (r: CardRecord): RelatedCard => {
    const p = r.prints[r.main];
    return p.img ? [r.slug, r.name, p.id, p.img] : [r.slug, r.name, p.id];
};
const seenStamp = new Int32Array(listed.length).fill(-1);
let relatedLinks = 0;
listed.forEach((r, i) => {
    const out: CardRecord[] = [];
    const taken = new Set([r.slug, r.name]);
    // what it names or makes, in Scryfall's order
    for (const id of parts.get(r.oracle_id) ?? []) {
        const other = byOracle.get(printingOracle.get(id) ?? "");
        if (!other || taken.has(other.slug) || taken.has(other.name)) continue;
        taken.add(other.slug).add(other.name);
        out.push(other);
        if (out.length === RELATED) break;
    }
    // then the closest matches, the most played first among equals
    const me = all[i];
    const best: { j: number, score: number }[] = [];
    const consider = (j: number) => {
        if (seenStamp[j] === i) return;
        seenStamp[j] = i;
        const other = all[j];
        if (j === i || other.real !== me.real || taken.has(listed[j].name)) return;
        const score = likeness(me, other);
        if (score < 3) return;
        const worse = (k: number) => best[k].score < score || (best[k].score === score && all[best[k].j].rank > other.rank);
        if (best.length === RELATED && !worse(RELATED - 1)) return;
        let at = best.length;
        while (at > 0 && worse(at - 1)) at--;
        best.splice(at, 0, { j, score });
        if (best.length > RELATED) best.pop();
    };
    for (const s of me.sentences) for (const j of bySentence.get(s) ?? []) consider(j);
    for (const s of me.subtypes) for (const j of bySubtype.get(s)!) consider(j);
    for (const j of byKind.get(`${me.types}|${me.colors}`)!) consider(j);
    for (const { j } of best) {
        if (out.length === RELATED) break;
        out.push(listed[j]);
    }
    if (out.length) {
        r.related = out.map(related);
        relatedLinks += out.length;
    }
});

// ---- write the bucket files ----

rmSync(join(out, DATA_DIR), { recursive: true, force: true });
rmSync(join(out, "sitemaps"), { recursive: true, force: true });
rmSync(join(out, "sitemap.xml"), { force: true });

const buckets = new Map<number, CardRecord[]>();
for (const r of records) {
    const b = bucketOf(renamed[r.slug] ?? r.slug);
    let list = buckets.get(b);
    if (!list) buckets.set(b, list = []);
    list.push(r);
}
let biggestRecord = { size: 0, name: "" };
let biggestFile = 0;
for (const [bucket, list] of buckets) {
    const entries: BucketEntry[] = [];
    const bodies: string[] = [];
    let offset = 0;
    for (const r of list) {
        const json = JSON.stringify(r);
        const size = Buffer.byteLength(json);
        entries.push([r.slug, r.oracle_id, offset, size]);
        bodies.push(json);
        offset += size;
        if (size > biggestRecord.size) biggestRecord = { size, name: r.name };
    }
    const body = `${JSON.stringify(entries)}\n${bodies.join("")}`;
    biggestFile = Math.max(biggestFile, Buffer.byteLength(body));
    write(paths.bucket(bucket), body);
}
write(paths.renamed(), JSON.stringify(renamed));

// ---- sets: a page per set listing its cards, linked from the footer and each card's page ----

const setCards = new Map<string, SetCard[]>();
for (const r of listed) {
    r.prints.forEach((p, i) => {
        if (p.released > today) return;
        let list = setCards.get(p.set);
        if (!list) setCards.set(p.set, list = []);
        const usd = p.prices?.usd ?? p.prices?.usd_foil ?? p.prices?.usd_etched;
        const entry: SetCard = [r.slug, r.name, p.number, p.rarity, p.id, p.img, usd ?? undefined, i === r.main ? 1 : undefined];
        // no trailing empty fields
        while (entry.length && entry[entry.length - 1] === undefined) entry.pop();
        list.push(entry);
    });
}
const known = await apiSets();
const setPages: SetSummary[] = [];
for (const [code, list] of setCards) {
    const info = setInfo.get(code)!;
    const api = known.get(code);
    list.sort((a, b) => collator.compare(a[2], b[2]) || a[1].localeCompare(b[1]));
    const summary: SetSummary = clean({
        code, name: info.name, type: info.type, count: list.length,
        released: api?.released_at ?? list.reduce((d, c) => {
            const p = bySlug.get(c[0])!.prints.find((p) => p.id === c[4])!;
            return p.released < d ? p.released : d;
        }, "9999"),
        icon: api?.icon_svg_uri, digital: info.digital || undefined,
    }) as SetSummary;
    setPages.push(summary);
    write(paths.set(code), JSON.stringify({ ...summary, cards: list } satisfies SetFile));
}
setPages.sort((a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
write(paths.sets(), JSON.stringify(setPages));

// the footer: the newest main sets, and the most played cards (EDHREC's ranking)
const FOOTER_SETS = new Set(["expansion", "core", "masters", "draft_innovation", "commander", "eternal"]);
const browse: Browse = {
    latest: setPages.filter((s) => FOOTER_SETS.has(s.type) && !s.digital).slice(0, 8),
    popular: listed.filter((r) => r.edhrec_rank).sort((a, b) => a.edhrec_rank! - b.edhrec_rank!).slice(0, 30).map((r) => [r.slug, r.name]),
};
write(paths.browse(), JSON.stringify(browse));
const dataFiles = files;
const dataBytes = bytes;

// ---- sitemaps: one entry per card, with its main printing's image ----

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PER_SITEMAP = 10_000;
const sitemaps: string[] = ["sitemaps/home.xml"];
write("sitemaps/home.xml", urlSet([
    `${SITE_URL}/`, `${SITE_URL}/syntax`, `${SITE_URL}/sets`,
    ...setPages.map((s) => `${SITE_URL}${setPath(s.code, 1)}`),
    ...setPages.flatMap((s) => Array.from({ length: Math.ceil(s.count / SET_PAGE) - 1 }, (_, i) => `${SITE_URL}${setPath(s.code, i + 2)}`)),
].map((url) => `<url><loc>${escape(url)}</loc></url>`)));
for (let i = 0; i * PER_SITEMAP < listed.length; i++) {
    const path = `sitemaps/cards-${i + 1}.xml`;
    sitemaps.push(path);
    write(path, urlSet(listed.slice(i * PER_SITEMAP, (i + 1) * PER_SITEMAP).map((r) => {
        const p = r.prints[r.main];
        const image = p.img ? imageUris(p.id, "front", p.img).large : undefined;
        return `<url><loc>${escape(`${SITE_URL}/card/${r.slug}`)}</loc>${image ? `<image:image><image:loc>${escape(image)}</image:loc></image:image>` : ""}</url>`;
    })));
}
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map((s) => `<sitemap><loc>${SITE_URL}/${s}</loc></sitemap>`).join("\n")}
</sitemapindex>
`);

function urlSet(urls: string[]) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}
</urlset>
`;
}

const printCount = records.reduce((n, r) => n + r.prints.length, 0);
console.log(`${records.length} cards (${Object.keys(renamed).length} with a longer slug), ${printCount} printings, ${rulingCount} rulings`);
console.log(`${dataFiles} data files, ${(dataBytes / 1024 / 1024).toFixed(1)} MB; biggest file ${(biggestFile / 1024).toFixed(0)} KB, biggest card ${biggestRecord.name} ${(biggestRecord.size / 1024).toFixed(0)} KB`);
console.log(`${relatedLinks} related card links; ${setPages.length} sets`);
console.log(`sitemaps: ${listed.length} cards in ${sitemaps.length - 1} files; ${files} files written to ${out}`);
console.log(`${linkExceptions} store/Gatherer links kept as-is; ${imageMismatches} images not at the usual address${mismatchExamples.length ? `, e.g. ${mismatchExamples.join(" ")}` : ""}`);
