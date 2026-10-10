// Reads the card data files (see ./carddata.ts) from the R2 bucket they live in, apart from the deploy, so
// deploying never takes them away. Each answer is undefined when the files don't have it: the bucket has no
// card data (local dev) or can't be read, or the card is newer than the last refresh. Callers then ask Scryfall.
import {
    bucketHeader, bucketOf, paths, readRecord,
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

function readObject(env: Env, key: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    let hit = files.get(key);
    if (hit) {
        files.delete(key);
    } else {
        hit = env.CARD_DATA.get(key).then(async (obj) => obj ? new Uint8Array(await obj.arrayBuffer()) : undefined);
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

async function bucket(env: Env, n: number): Promise<Bucket | undefined> {
    const bytes = await quietly(readFile(env, paths.bucket(n)));
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
