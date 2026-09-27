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
