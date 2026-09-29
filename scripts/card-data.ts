// Builds the site's card data from Scryfall's daily bulk files: node scripts/card-data.ts [out dir]
// Run it after `npm run build` (it writes into build/client by default, next to the other static files)
// and before deploying. It writes:
//   /data/cards/<bucket>.json  one record per card, packed (see app/lib/carddata.ts for the layout)
//   /data/cards/renamed.json   the few pages whose slug is longer than the card's name
//   /sitemap.xml, /sitemaps/*  one entry per card, as static files
// The bulk files come from data.scryfall.io, which has no rate limit; this makes one API call, for the
// file list. Set SCRYFALL_BULK_DIR to a folder holding default_cards.jsonl.gz and rulings.jsonl.gz to
// build from files already downloaded instead.
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createReadStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    DATA_DIR, LINK_TEMPLATES, SITE_URL, bucketOf, imageUris, oracleOf, paths, slug, templateLink,
    type BucketEntry, type CardFaceText, type CardRecord, type LinkKey, type Printing, type Renamed,
} from "../app/lib/carddata.ts";
import type { Ruling } from "../app/types.ts";

const HEADERS = { "User-Agent": "impuls_master/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };
const out = resolve(process.argv[2] ?? "build/client");
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
    const s = slug(b.record.name) || "card";
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
const dataFiles = files;
const dataBytes = bytes;

// ---- sitemaps: one entry per card, with its main printing's image ----

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PER_SITEMAP = 10_000;
const listed = records
    .filter((r) => !(r.layout in NOT_CARDS) && r.prints.some((p) => p.released <= today))
    .sort((a, b) => a.slug.localeCompare(b.slug));
const sitemaps: string[] = ["sitemaps/home.xml"];
write("sitemaps/home.xml", urlSet([`<url><loc>${SITE_URL}/</loc></url>`]));
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
console.log(`sitemaps: ${listed.length} cards in ${sitemaps.length - 1} files; ${files} files written to ${out}`);
console.log(`${linkExceptions} store/Gatherer links kept as-is; ${imageMismatches} images not at the usual address${mismatchExamples.length ? `, e.g. ${mismatchExamples.join(" ")}` : ""}`);
