// Reads the card data files (see ./carddata.ts) from the R2 bucket they live in, apart from the deploy, so
// deploying never takes them away. Each answer is undefined when the files don't have it: the bucket has no
// card data (local dev) or can't be read, or the card is newer than the last refresh. Callers then ask Scryfall.
import {
    BUCKETS, bucketHeader, bucketOf, paths, readRecord, slug,
    type Browse, type BucketEntry, type CardRecord, type Renamed, type SetFile, type SetSummary,
} from "./carddata";

// Each refresh (scripts/upload-card-data.sh) uploads a whole new copy under v/<version>/ and only then points
// `current` at it, so a page never mixes two days' files. An isolate asks which version is current at most
// once a minute; the upload deletes the copy before it only two minutes later, so one still on it can finish.
const CURRENT = "current";
const VERSION_TTL = 60_000;
let version: { checked: number, value: Promise<string | undefined> } | undefined;

// the version of the card data being served; undefined when there's none
export function dataVersion(env: Env): Promise<string | undefined> {
    if (!version || Date.now() - version.checked > VERSION_TTL) {
        version = {
            checked: Date.now(),
            value: quietly(env.CARD_DATA.get(CURRENT).then((obj) => obj?.text())).then((v) => v?.trim() || undefined),
        };
    }
    return version.value;
}

const keyOf = (v: string, path: string) => `v/${v}/${path}`;

// Files read by this isolate, by their key (so a new version means new files), most recently used last.
// Reading a file is I/O, which doesn't count toward the Worker's CPU time; parsing does, so only the header is
// parsed here and each record on its own.
const MAX_FILES = 64;
type Bucket = { bytes: Uint8Array, header: ReturnType<typeof bucketHeader> };
const files = new Map<string, Promise<Uint8Array<ArrayBuffer> | undefined>>();
const buckets = new Map<number, Bucket>();

type Load = () => Promise<Uint8Array<ArrayBuffer> | undefined>;

function readObject(env: Env, key: string, load?: Load): Promise<Uint8Array<ArrayBuffer> | undefined> {
    let hit = files.get(key);
    if (hit) {
        files.delete(key);
    } else {
        hit = load ? load() : env.CARD_DATA.get(key).then(async (obj) => obj ? new Uint8Array(await obj.arrayBuffer()) : undefined);
        // a failure isn't kept, so the next request tries again
        hit.catch(() => files.delete(key));
    }
    files.set(key, hit);
    if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
    return hit;
}

async function readFile(env: Env, path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const v = await dataVersion(env);
    return v === undefined ? undefined : readObject(env, keyOf(v, path));
}

// the files can be missing or broken; that only means asking Scryfall instead
async function quietly<T>(promise: Promise<T | undefined>): Promise<T | undefined> {
    try {
        return await promise;
    } catch (err) {
        console.error("Card data file failed", err);
        return undefined;
    }
}

// small files, parsed once per isolate and version
const parsed = new Map<string, Promise<unknown>>();
async function parsedFile<T>(env: Env, path: string): Promise<T | undefined> {
    const v = await dataVersion(env);
    if (v === undefined) return undefined;
    const key = keyOf(v, path);
    let hit = parsed.get(key);
    if (!hit) {
        for (const old of parsed.keys()) if (!old.startsWith(keyOf(v, ""))) parsed.delete(old);
        hit = quietly(readObject(env, key)).then((bytes) => bytes && JSON.parse(new TextDecoder().decode(bytes)));
        parsed.set(key, hit);
    }
    const value = await hit;
    if (!value) parsed.delete(key);
    return value as T | undefined;
}

const TYPES: Record<string, string> = { json: "application/json", xml: "application/xml; charset=utf-8" };

// a card data file or sitemap as a response, for the browser (/data/...) and search engines (/sitemap.xml, /sitemaps/...)
export async function dataFileResponse(env: Env, path: string): Promise<Response> {
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
        const v = await dataVersion(env);
        if (v === undefined) throw new Error("No card data version");
        bytes = await readObject(env, keyOf(v, path));
    } catch (err) {
        console.error("Card data file failed", err);
        // a 503 tells search engines to come back later, where a 404 would tell them the sitemap is gone
        return new Response("Card data is temporarily unavailable. Try again in a minute.", {
            status: 503,
            headers: { "Retry-After": "60", "Cache-Control": "no-store" },
        });
    }
    if (!bytes) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(bytes, {
        headers: {
            "Content-Type": TYPES[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream",
            "Cache-Control": "public, max-age=3600",
        },
    });
}

async function bucket(env: Env, n: number, edge?: EdgeWrites): Promise<Bucket | undefined> {
    const bytes = await quietly(edge ? edgeFile(env, paths.bucket(n), edge) : readFile(env, paths.bucket(n)));
    if (!bytes) return undefined;
    let b = buckets.get(n);
    if (b?.bytes !== bytes) {
        b = { bytes, header: bucketHeader(bytes) };
        buckets.set(n, b);
        if (buckets.size > MAX_FILES) buckets.delete(buckets.keys().next().value!);
    }
    return b;
}

const renamedSlugs = (env: Env) => parsedFile<Renamed>(env, paths.renamed());

// undefined: no card data files at all; null: the files are there but no card has this page
export async function findCard(env: Env, pageSlug: string): Promise<CardRecord | null | undefined> {
    const names = await renamedSlugs(env);
    if (!names) return undefined;
    const b = await bucket(env, bucketOf(names[pageSlug] ?? pageSlug));
    if (!b) return undefined;
    const entry = b.header.entries.find((e) => e[0] === pageSlug);
    return entry ? readRecord(b.bytes, b.header, entry) : null;
}

// the other cards with the same name as this one (tokens, variants), to find which one has a printing
export async function sameName(env: Env, record: CardRecord): Promise<CardRecord[]> {
    const names = await renamedSlugs(env);
    const name = names?.[record.slug] ?? record.slug;
    const b = await bucket(env, bucketOf(name));
    if (!b || !names) return [];
    const others = b.header.entries.filter((e: BucketEntry) => e[0] !== record.slug && (e[0] === name || names[e[0]] === name));
    return others.map((e) => readRecord(b.bytes, b.header, e));
}

// ---- sets and the footer ----

// every set with a page, newest first; undefined without the card data files
export const allSets = (env: Env) => parsedFile<SetSummary[]>(env, paths.sets());

// the footer's links; undefined without the card data files
export const browseLinks = (env: Env) => parsedFile<Browse>(env, paths.browse());

// undefined: no card data files at all; null: no set has this code
export async function findSet(env: Env, code: string): Promise<SetFile | null | undefined> {
    const sets = await allSets(env);
    if (!sets) return undefined;
    if (!sets.some((s) => s.code === code)) return null;
    const bytes = await quietly(readFile(env, paths.set(code)));
    return bytes && JSON.parse(new TextDecoder().decode(bytes));
}

// ---- the search Worker's reads ----
// A results page needs up to 175 records from as many bucket files, and an invocation has only 6 reads in flight
// at once, so a page took 29 rounds of R2 reads (about 80 ms each, whatever the size). A bucket file never changes
// within a version, so search keeps them in this data centre's cache, a few ms a read. The copies it writes are
// queued in `edge` and written once the answer is made (see workers/search.ts), so they don't take read slots.
export type EdgeWrites = (() => Promise<void>)[];

const EDGE_CACHE = "card-data";
// any URL works as a cache key; the version is in the key, so a new version never meets an old file
const edgeKey = (key: string) => new Request(`https://card-data.invalid/${key}`);
const EDGE_TTL = 2 * 24 * 60 * 60;

async function edgeFile(env: Env, path: string, edge: EdgeWrites): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const v = await dataVersion(env);
    if (v === undefined) return undefined;
    const key = keyOf(v, path);
    return readObject(env, key, async () => {
        const cache = await caches.open(EDGE_CACHE);
        const cached = await cache.match(edgeKey(key));
        if (cached) return new Uint8Array(await cached.arrayBuffer());
        const obj = await env.CARD_DATA.get(key);
        if (!obj) return undefined;
        const bytes = new Uint8Array(await obj.arrayBuffer());
        edge.push(() => cache.put(edgeKey(key), new Response(bytes, { headers: { "Cache-Control": `public, max-age=${EDGE_TTL}` } })));
        return bytes;
    });
}

// Fills this data centre's cache ahead of searches, `count` bucket files at a time (run after an answer is sent):
// each new version starts with an empty cache, so this keeps the slow first searches after a refresh few. Each
// isolate walks the buckets once per version from a random start, so isolates mostly warm different ones. The
// file goes from R2 to the cache as a stream, never parsed or copied here.
let warming: { version: string, next: number, left: number } | undefined;

export async function warmEdge(env: Env, count: number): Promise<void> {
    const v = await dataVersion(env);
    if (v === undefined) return;
    if (warming?.version !== v) warming = { version: v, next: Math.floor(Math.random() * BUCKETS), left: BUCKETS };
    const w = warming;
    const cache = await caches.open(EDGE_CACHE);
    const warmOne = async (n: number) => {
        const key = keyOf(v, paths.bucket(n));
        const cached = await cache.match(edgeKey(key));
        if (cached) { await cached.body?.cancel(); return; }
        const obj = await env.CARD_DATA.get(key);
        if (obj) await cache.put(edgeKey(key), new Response(obj.body, { headers: { "Cache-Control": `public, max-age=${EDGE_TTL}` } }));
    };
    while (count > 0 && w.left > 0) {
        const batch: number[] = [];
        while (batch.length < 6 && count > 0 && w.left > 0) {
            batch.push(w.next);
            w.next = (w.next + 1) % BUCKETS;
            w.left--;
            count--;
        }
        await Promise.all(batch.map((n) => warmOne(n).catch((err) => console.error("Edge cache warm failed", err))));
    }
}

// a card's record by its oracle id, for the search Worker's results (workers/search.ts): the file it's in goes by
// its name, so each of `names` (the card's, a reversible printing's own) is tried. undefined when it isn't there
export async function cardByOracle(env: Env, names: string[], oracleId: string, edge: EdgeWrites): Promise<CardRecord | undefined> {
    for (const name of new Set(names.map(slug))) {
        const b = await bucket(env, bucketOf(name), edge);
        const entry = b?.header.entries.find((e) => e[1] === oracleId);
        if (b && entry) return readRecord(b.bytes, b.header, entry);
    }
    return undefined;
}
