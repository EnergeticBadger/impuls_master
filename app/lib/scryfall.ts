// All Scryfall API calls go through our Worker (workers/scryfall.ts), which caches them.

const API = "https://api.scryfall.com/";
const PROXY = "/api/scryfall/";

// turn a Scryfall API url (e.g. card.prints_search_uri) into our proxied one
export function proxied(uri: string) {
    return uri.startsWith(API) ? PROXY + uri.slice(API.length) : uri
}

export async function scryfallGet(pathOrUri: string, init?: RequestInit): Promise<any> {
    const url = pathOrUri.startsWith("http") ? proxied(pathOrUri) : PROXY + pathOrUri
    const res = await fetch(url, { ...init, headers: { Accept: "application/json" } })
    return res.json()
}

// Our own search engine (workers/search.ts) answers Scryfall's cards/search in Scryfall's shape, and hands any
// search it can't answer to Scryfall through the proxy above (its X-Search header says which).
// LOCAL_SEARCH=off in wrangler.jsonc sends every search to Scryfall without a client change.
const LOCAL_SEARCH = "/api/search/"

export async function searchCards(params: URLSearchParams, init?: RequestInit): Promise<any> {
    const res = await fetch(`${LOCAL_SEARCH}cards/search?${params}`, { ...init, headers: { Accept: "application/json" } })
    return res.json()
}
