import { proxy } from "valtio";
import { hasData, hasStatus, type Print, type ScryfallCard } from "~/types";
import { scryfallGet } from "~/lib/scryfall";
import { loadRecord } from "~/lib/card";
import { imageUris } from "~/lib/carddata";



export const alternate = proxy<Print>({
    name: 'none',
    uri: 'none'
})


 export async function setCurrentAlternate(name: string, uri: string) {
    alternate.name = name
    alternate.uri = uri
}



export const all_alt_art = proxy<{ name: string, prints: Print[] }>({ name: '', prints: [] })

export function setAltArtList(name: string, prints: Print[]) {
    all_alt_art.prints = prints
    all_alt_art.name = name
}


// prints already fetched this session, keyed by card name
const printsCache = new Map<string, Print[]>()
// only the most recent request is allowed to update the list
let pending: AbortController | null = null

// the card's printings from the site's card data files, else from Scryfall
async function fetchPrints(card: ScryfallCard, signal: AbortSignal): Promise<Print[] | undefined> {
    const record = await loadRecord(card)
    if (record) return record.prints.filter((p) => p.img).map((p) => ({ name: p.set_name, uri: imageUris(p.id, 'front', p.img!).large }))

    const res = await scryfallGet(card.prints_search_uri, { signal });
    if (hasStatus(res) || !hasData(res)) {
        console.error(`${res.status}`, { cause: res.details });
        return undefined
    }
    // double-faced printings keep their images on the faces; show the front
    return res.data
        .map((c) => ({ name: c.set_name, uri: c.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.large ?? '' }))
        .filter((p) => p.uri)
}

export async function loadPrints(card: ScryfallCard) {
    const name = card.name
    const cached = printsCache.get(name)
    if (cached) {
        pending?.abort()
        pending = null
        setAltArtList(name, cached)
        return
    }

    pending?.abort()
    const controller = new AbortController()
    pending = controller
    // clear the old card's prints so they never show under this card while loading or on error
    setAltArtList(name, [])

    try {
        const prints = await fetchPrints(card, controller.signal)
        if (!prints) return
        printsCache.set(name, prints)

        // a newer card was opened while this one was loading
        if (pending !== controller) return
        setAltArtList(name, prints)
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Failed to fetch prints: ', err)
    } finally {
        if (pending === controller) pending = null
    }
}
