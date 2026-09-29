// Scryfall calls made while rendering on the server. They go straight through the Worker's
// caching proxy (no network hop back to ourselves), so they share its cache and rate limit.
import { data } from "react-router";
import { SCRYFALL_PREFIX, handleScryfall } from "../../workers/scryfall";

const API = "https://api.scryfall.com/";

// Scryfall couldn't answer (busy, rate limited or down), as opposed to answering "not found"
export class ScryfallUnavailable extends Error {
    constructor(readonly status: number, readonly retryAfter: string) {
        super(`Scryfall unavailable (${status})`);
    }
}

// the JSON Scryfall answered with, including its "not found" errors; throws ScryfallUnavailable when it couldn't answer
export async function scryfallServerGet(pathOrUri: string, base: string, ctx: ExecutionContext): Promise<any> {
    const path = pathOrUri.startsWith(API) ? pathOrUri.slice(API.length) : pathOrUri
    const res = await handleScryfall(new Request(new URL(SCRYFALL_PREFIX + path, base)), ctx)
    if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel()
        throw new ScryfallUnavailable(res.status, res.headers.get("Retry-After") ?? "60")
    }
    return res.json()
}

// what a page or sitemap answers when Scryfall is unavailable: a 503 tells search engines to come back
// later, where a 404 would tell them the page is gone
export function unavailable(err: unknown): never {
    if (err instanceof ScryfallUnavailable) {
        throw data("Card data is temporarily unavailable. Try again in a minute.", {
            status: 503,
            headers: { "Retry-After": err.retryAfter, "Cache-Control": "no-store" },
        })
    }
    throw err
}
