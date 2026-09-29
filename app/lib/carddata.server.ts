// Reads the card data files that ship with the site (see ./carddata.ts). Each answer is undefined when
// the files don't have it: they aren't there (local dev, or a deploy without scripts/card-data.ts) or the
// card is newer than the last refresh. Callers then ask Scryfall.
import { bucketHeader, bucketOf, paths, readRecord, type BucketEntry, type CardRecord, type Renamed } from "./carddata";

// Files read by this isolate, most recently used last. Reading a file is I/O, which doesn't count toward
// the Worker's CPU time; parsing does, so only the header is parsed here and each record on its own.
// The files only change with a deploy, which starts new isolates.
const MAX_FILES = 64;
type Bucket = { bytes: Uint8Array, header: ReturnType<typeof bucketHeader> };
const files = new Map<string, Promise<Uint8Array | undefined>>();
const buckets = new Map<number, Bucket>();

function readFile(env: Env, path: string): Promise<Uint8Array | undefined> {
    let hit = files.get(path);
    if (hit) {
        files.delete(path);
    } else {
        hit = env.ASSETS.fetch(new Request(`https://assets.local/${path}`)).then(async (res) => {
            if (res.status === 404) return undefined;
            if (!res.ok) throw new Error(`${path}: ${res.status}`);
            return new Uint8Array(await res.arrayBuffer());
        });
        // a failure isn't kept, so the next request tries again
        hit.catch(() => files.delete(path));
    }
    files.set(path, hit);
    if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
    return hit;
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

let renamed: Promise<Renamed | undefined> | undefined;
async function renamedSlugs(env: Env): Promise<Renamed | undefined> {
    renamed ??= quietly(readFile(env, paths.renamed())).then((bytes) => bytes && JSON.parse(new TextDecoder().decode(bytes)));
    const r = await renamed;
    if (!r) renamed = undefined;
    return r;
}

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
