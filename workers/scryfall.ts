// Caching proxy for the Scryfall API.
// The browser calls /api/scryfall/<path>?<query>; the Worker answers from cache
// when it can, and otherwise asks Scryfall politely (identifying headers, one
// request at a time with a gap between them) and caches the answer.
// Scryfall's limits: https://scryfall.com/docs/api/rate-limits

export const SCRYFALL_PREFIX = "/api/scryfall/";

const UPSTREAM = "https://api.scryfall.com/";
const USER_AGENT = "impuls_master/1.0 (+https://github.com/EnergeticBadger/impuls_master)";

// Scryfall's hard limits: searches and name lookups 2 a second, everything else 10 a second
const MIN_GAP_MS = 100;
const SEARCH_GAP_MS = 500;
const SEARCH_LIKE = /^cards\/(search|named|random|collection)$/;
// a request that would have to queue longer than this is turned away instead of left hanging
const MAX_WAIT_MS = 10_000;
// a 429 locks us out for 30 seconds; Scryfall says to stop sending until then
const LOCKOUT_MS = 30_000;

// card data changes about once a day
const TTL_OK = 60 * 60 * 24;
// "no cards found" etc. — cache briefly so typos don't hammer the API
const TTL_NOT_FOUND = 60 * 60;
// how long the browser may reuse an answer without asking us
const BROWSER_TTL = 60 * 60;

// only proxy the read-only endpoints the app actually needs
const ALLOWED = [
	/^cards\/search$/,
	/^cards\/named$/,
	/^cards\/autocomplete$/,
	/^cards\/[0-9a-f-]{36}$/,
	/^cards\/[0-9a-f-]{36}\/rulings$/,
	/^cards\/[a-z0-9]+\/[^/]+$/,
	/^sets(\/[a-z0-9]+)?$/,
	/^catalog\/[a-z-]+$/,
	/^symbology(\/parse-mana)?$/,
];

type Stored = { status: number; headers: [string, string][]; body: ArrayBuffer };

// requests already on their way to Scryfall, so identical ones share a single call.
// Stored as plain data: a Response body can't be shared between Worker requests.
const inFlight = new Map<string, Promise<Stored>>();

// Small in-memory cache per Worker instance. The Cache API above is the main cache,
// but it does nothing on *.workers.dev domains, so this keeps hot queries cheap there too.
// Expired entries stay until they're pushed out, to answer with while Scryfall is unavailable.
const MEMORY_MAX_BYTES = 32 * 1024 * 1024;
const memory = new Map<string, { stored: Stored; expires: number }>();
let memoryBytes = 0;

function memoryGet(key: string) {
	const hit = memory.get(key);
	if (!hit) return undefined;
	memory.delete(key);
	memory.set(key, hit); // move to newest
	return { stored: hit.stored, fresh: hit.expires >= Date.now() };
}

function memorySet(key: string, stored: Stored, ttl: number) {
	const size = stored.body.byteLength;
	if (size > MEMORY_MAX_BYTES / 4) return;
	const old = memory.get(key);
	if (old) {
		memory.delete(key);
		memoryBytes -= old.stored.body.byteLength;
	}
	memory.set(key, { stored, expires: Date.now() + ttl * 1000 });
	memoryBytes += size;
	// drop the least recently used entries
	for (const [k, v] of memory) {
		if (memoryBytes <= MEMORY_MAX_BYTES) break;
		memory.delete(k);
		memoryBytes -= v.stored.body.byteLength;
	}
}

// Scryfall can't take the request right now (we're over its limit, or waiting out a 429)
class Busy extends Error {
	constructor(readonly retryAfter: number) {
		super("Scryfall is busy");
	}
}

// times the next upstream call may start, so this isolate keeps to Scryfall's limits.
// Other isolates keep their own; a shared limiter is on the TODO list.
let nextAny = 0;
let nextSearch = 0;
// no calls to Scryfall before this time, after it answered 429
let lockedUntil = 0;

async function throttle(searchLike: boolean) {
	const now = Date.now();
	if (lockedUntil > now) throw new Busy(Math.ceil((lockedUntil - now) / 1000));
	const slot = Math.max(now, nextAny, searchLike ? nextSearch : 0);
	if (slot - now > MAX_WAIT_MS) throw new Busy(Math.ceil((slot - now) / 1000));
	nextAny = slot + MIN_GAP_MS;
	if (searchLike) nextSearch = slot + SEARCH_GAP_MS;
	if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
	// a 429 may have come back while this one waited its turn
	if (lockedUntil > Date.now()) throw new Busy(Math.ceil((lockedUntil - Date.now()) / 1000));
}

function json(status: number, details: string, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify({ object: "error", status, details }), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

const busy = (retryAfter: number) =>
	json(503, "Scryfall is busy, try again in a moment", { "Retry-After": String(Math.max(1, retryAfter)), "Cache-Control": "no-store" });

// same request, same cache entry: sort params and drop ones that don't change the answer
function upstreamUrl(url: URL, path: string) {
	const params = [...url.searchParams.entries()]
		.filter(([k]) => k !== "format" || url.searchParams.get("format") !== "json")
		.sort(([a], [b]) => a.localeCompare(b));
	const target = new URL(path, UPSTREAM);
	for (const [k, v] of params) target.searchParams.append(k, v);
	return target;
}

async function fetchUpstream(target: URL, path: string): Promise<Stored> {
	await throttle(SEARCH_LIKE.test(path));
	const res = await fetch(target.toString(), {
		headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
	});
	if (res.status === 429) {
		const wait = Number(res.headers.get("Retry-After")) * 1000 || LOCKOUT_MS;
		lockedUntil = Math.max(lockedUntil, Date.now() + wait);
		console.warn(`Scryfall answered 429 for ${path}; pausing ${wait}ms`);
		await res.body?.cancel();
		throw new Busy(Math.ceil(wait / 1000));
	}
	const ttl = res.ok ? TTL_OK : res.status === 404 ? TTL_NOT_FOUND : 0;
	const stored: Stored = {
		status: res.status,
		headers: [
			["Content-Type", res.headers.get("Content-Type") ?? "application/json"],
			["Cache-Control", ttl ? `public, max-age=${ttl}` : "no-store"],
		],
		body: await res.arrayBuffer(),
	};
	if (ttl) memorySet(target.toString(), stored, ttl);
	return stored;
}

export async function handleScryfall(request: Request, ctx: ExecutionContext): Promise<Response> {
	if (request.method !== "GET") return json(405, "Only GET is supported");

	const url = new URL(request.url);
	const path = url.pathname.slice(SCRYFALL_PREFIX.length);
	if (!ALLOWED.some((re) => re.test(path))) return json(404, "Not a supported Scryfall endpoint");

	const target = upstreamUrl(url, path);
	const key = new Request(target.toString());
	const cache = await caches.open("scryfall");

	let res = await cache.match(key);
	let source = "HIT";

	const remembered = res ? undefined : memoryGet(key.url);
	if (remembered?.fresh) {
		source = "HIT-MEMORY";
		res = new Response(remembered.stored.body, { status: remembered.stored.status, headers: remembered.stored.headers });
	}

	if (!res) {
		source = "MISS";
		// an expired copy is better than nothing when Scryfall can't answer
		const stale = () => {
			if (!remembered) return undefined;
			source = "STALE";
			return new Response(remembered.stored.body, { status: remembered.stored.status, headers: remembered.stored.headers });
		};
		let pending = inFlight.get(key.url);
		if (!pending) {
			pending = fetchUpstream(target, path).finally(() => inFlight.delete(key.url));
			inFlight.set(key.url, pending);
		}
		try {
			const stored = await pending;
			res = stored.status >= 500 ? stale() : undefined;
			res ??= new Response(stored.body, { status: stored.status, headers: stored.headers });
		} catch (err) {
			res = stale();
			if (!res && err instanceof Busy) return busy(err.retryAfter);
			if (!res) {
				console.error("Scryfall request failed", err);
				return json(502, "Could not reach Scryfall");
			}
		}
		if (source === "MISS" && res.headers.get("Cache-Control")?.startsWith("public")) {
			ctx.waitUntil(cache.put(key, res.clone()));
		}
	}

	const out = new Response(res.body, res);
	out.headers.set("X-Cache", source);
	out.headers.set(
		"Cache-Control",
		// a stale answer is only kept briefly, so the browser asks again once Scryfall is back
		source === "STALE" ? "public, max-age=60"
			: res.ok || res.status === 404 ? `public, max-age=${BROWSER_TTL}` : "no-store",
	);
	return out;
}
