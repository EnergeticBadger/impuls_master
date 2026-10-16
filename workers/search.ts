// The local search (scripts/local-search.ts) answering as Scryfall's cards/search: the browser calls
// /api/search/cards/search?<Scryfall's parameters> and gets Scryfall's answer (scripts/search-api.ts), made here
// from the search index (scripts/search-index.ts) and the card data's records, both from the same nightly
// version in the card data's R2 bucket (app/lib/carddata.server.ts).
// Anything it doesn't answer itself goes to Scryfall through /api/scryfall (workers/scryfall.ts): a search the
// engine doesn't support, while this Worker copy is still loading the index, no index or card data, a card
// missing from the card data, any error. LOCAL_SEARCH=off (wrangler.jsonc) sends every search there. Each answer
// says which in X-Search: "local", or "scryfall; <why>". Local answers are kept in Cloudflare's cache by search,
// deploy and card data version.
// The index takes most of a Worker's 128 MB, so it's loaded only when a search asks for it, one version at a time.

import { cardsSearch } from "../scripts/search-api";
import { decodeIndexParts, indexLayout, START } from "../scripts/search-index-file";
import { Unsupported, type Cards } from "../scripts/local-search";
import { cardByOracle, dataVersion } from "../app/lib/carddata.server";
import { printingCard, type CardRecord } from "../app/lib/carddata";
import { SCRYFALL_PREFIX, handleScryfall } from "./scryfall";

export const SEARCH_PREFIX = "/api/search/";
const INDEX = "search-index.bin";
// how long the browser and Cloudflare's cache keep an answer (the card data version is in the cache's key)
const BROWSER_TTL = 60 * 60;
const EDGE_TTL = 60 * 60 * 24;
// after a failed load, how long before trying again
const RETRY_MS = 60_000;

// the index this Worker copy holds, for one card data version: a new version drops the old one before loading,
// as two wouldn't fit
let index: { version: string, cards?: Cards, loading?: Promise<void>, failed?: number } | undefined;

// read in parts with ranges (where the header and arrays are, the header, the arrays), so the file is never
// held whole beside what's made of it
async function readIndex(env: Env, version: string): Promise<Cards> {
    const key = `v/${version}/${INDEX}`;
    const part = async (range: R2Range) => {
        const obj = await env.CARD_DATA.get(key, { range });
        if (!obj) throw new Error(`no ${key}`);
        return obj;
    };
    const at = indexLayout(new Uint8Array(await (await part({ offset: 0, length: START })).arrayBuffer()));
    const [header, arrays] = await Promise.all([
        part({ offset: at.header[0], length: at.header[1] - at.header[0] }).then((o) => o.text()),
        part({ offset: at.arrays }).then((o) => o.arrayBuffer()),
    ]);
    return decodeIndexParts(header, arrays);
}

// the index, or undefined while it loads (starting it if need be)
function indexFor(env: Env, ctx: ExecutionContext, version: string): Cards | undefined {
    if (index?.version !== version) index = { version };
    const mine = index;
    if (mine.cards) return mine.cards;
    if (!mine.loading && !(mine.failed && Date.now() - mine.failed < RETRY_MS)) {
        const started = Date.now();
        mine.loading = readIndex(env, version).then((cards) => {
            mine.cards = cards;
            console.log(`Search index ${version} loaded in ${Date.now() - started} ms: ${cards.cards.length} cards, ${cards.prints.length} printings`);
        }, (err) => {
            mine.failed = Date.now();
            console.error(`Search index ${version} didn't load`, err);
        }).finally(() => mine.loading = undefined);
        ctx.waitUntil(mine.loading);
    }
    return undefined;
}

// a printing the card data doesn't have, so the answer can't be made here
class MissingCard extends Error {}

// header values are Latin-1: a reason quoting the search is cut to plain characters
const plain = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);

async function fromScryfall(request: Request, ctx: ExecutionContext, path: string, why: string): Promise<Response> {
    const url = new URL(request.url);
    const res = await handleScryfall(new Request(new URL(`${SCRYFALL_PREFIX}${path}${url.search}`, url.origin), request), ctx);
    const out = new Response(res.body, res);
    out.headers.set("X-Search", plain(`scryfall; ${why}`));
    return out;
}

export async function handleSearch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(SEARCH_PREFIX.length);
    if (request.method !== "GET" || path !== "cards/search") {
        return Response.json({ object: "error", status: 404, details: "Only cards/search is answered here" }, { status: 404 });
    }
    if (String(env.LOCAL_SEARCH) === "off") return fromScryfall(request, ctx, path, "off");
    const version = await dataVersion(env);
    if (!version) return fromScryfall(request, ctx, path, "no card data");

    // the same search, the same key: its parameters in order, with the deploy's and the card data's versions
    const keyUrl = new URL(url.pathname, url.origin);
    for (const [k, v] of [...url.searchParams].sort(([a], [b]) => a.localeCompare(b))) keyUrl.searchParams.append(k, v);
    keyUrl.searchParams.set("__version", `${env.CF_VERSION_METADATA.id}-${version}`);
    const key = new Request(keyUrl.toString());
    const cache = await caches.open("search");
    const hit = await cache.match(key);
    if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set("Cache-Control", `public, max-age=${BROWSER_TTL}`);
        res.headers.set("X-Cache", "HIT");
        return res;
    }

    const cards = indexFor(env, ctx, version);
    if (!cards) return fromScryfall(request, ctx, path, "loading the index");
    const started = Date.now();
    try {
        // each card's record once, however many of its printings are on the page
        const records = new Map<string, Promise<CardRecord | undefined>>();
        const answer = await cardsSearch(cards, Object.fromEntries(url.searchParams), {
            base: `${url.origin}${SEARCH_PREFIX}`,
            card: async (i) => {
                const p = cards.prints[i], c = cards.cards[p.card];
                let record = records.get(c.oracleId);
                if (!record) records.set(c.oracleId, record = cardByOracle(env, [c.name, p.name], c.oracleId));
                const r = await record;
                const shown = r?.prints.find((x) => x.id === p.id);
                if (!r || !shown) throw new MissingCard(`${c.name} (${p.set}/${p.cn}) isn't in the card data`);
                return printingCard(r, shown);
            },
        });
        const res = Response.json(answer.body, {
            status: answer.status,
            headers: { "Cache-Control": `public, max-age=${EDGE_TTL}`, "X-Search": "local", "X-Search-Ms": String(Date.now() - started) },
        });
        ctx.waitUntil(cache.put(key, res.clone()));
        res.headers.set("Cache-Control", `public, max-age=${BROWSER_TTL}`);
        res.headers.set("X-Cache", "MISS");
        return res;
    } catch (err) {
        if (err instanceof Unsupported) return fromScryfall(request, ctx, path, `unsupported: ${err.message}`);
        console.error(`Local search failed for ${url.search}`, err);
        return fromScryfall(request, ctx, path, err instanceof MissingCard ? err.message : "error");
    }
}
