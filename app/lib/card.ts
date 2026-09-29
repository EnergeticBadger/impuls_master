import { useEffect, useState } from "react";
import type { Ruling, ScryfallCard } from "~/types";
import { scryfallGet } from "./scryfall";
import { SITE_URL, bucketHeader, bucketOf, oracleOf, paths, readRecord, slug, type CardRecord } from "./carddata";

export { SITE_URL, slug };

// the card's page, open on this printing: /card/<name>?print=<set>-<collector number>.
// A card that shares its name with another is sent on to its own page from there.
export function cardPath(card: Pick<ScryfallCard, "set" | "collector_number" | "name">) {
    return `/card/${slug(card.name)}?print=${encodeURIComponent(`${card.set}-${card.collector_number}`)}`
}

const absolute = (path: string) => (typeof window !== "undefined" ? window.location.origin : SITE_URL) + path

// Phones get the system share sheet; everywhere else the link is copied.
// Resolves to what happened so the button can say so.
export async function shareLink(path: string, name: string): Promise<"shared" | "copied" | "failed"> {
    const url = absolute(path)
    const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches
    if (touch && navigator.share) {
        try {
            await navigator.share({ title: name, text: `${name} on Impulse Caster`, url })
            return "shared"
        } catch (err) {
            // closing the share sheet isn't a failure, and there's nothing to fall back to
            if (err instanceof DOMException && err.name === "AbortError") return "shared"
        }
    }
    try {
        await navigator.clipboard.writeText(url)
        return "copied"
    } catch (err) {
        console.error("Failed to copy link: ", err)
        return "failed"
    }
}

// card data files already fetched this session (see ./carddata.ts), most recently used last
const MAX_FILES = 16
const dataFiles = new Map<string, Promise<Uint8Array | undefined>>()

// one of the card data files that ship with the site; undefined when the site doesn't have it
// (local dev, or it couldn't be fetched), so the caller asks Scryfall instead
function dataFile(path: string): Promise<Uint8Array | undefined> {
    let file = dataFiles.get(path)
    if (file) {
        dataFiles.delete(path)
    } else {
        file = fetch(`/${path}`)
            .then(async (res) => res.ok && res.headers.get("Content-Type")?.includes("json") ? new Uint8Array(await res.arrayBuffer()) : undefined)
            .catch((err) => { console.error(`Card data file ${path} failed: `, err); return undefined })
        file.then((f) => { if (f === undefined) dataFiles.delete(path) })
    }
    dataFiles.set(path, file)
    if (dataFiles.size > MAX_FILES) dataFiles.delete(dataFiles.keys().next().value!)
    return file
}

// the card's record (rules text, rulings, every printing) from the site's card data files
export async function loadRecord(card: Pick<ScryfallCard, "name" | "oracle_id" | "card_faces">): Promise<CardRecord | undefined> {
    const oracle = oracleOf(card)
    if (!oracle) return undefined
    const bytes = await dataFile(paths.bucket(bucketOf(slug(card.name))))
    if (!bytes) return undefined
    const header = bucketHeader(bytes)
    const entry = header.entries.find((e) => e[1] === oracle)
    return entry ? readRecord(bytes, header, entry) : undefined
}

async function loadRulings(card: Pick<ScryfallCard, "name" | "oracle_id" | "rulings_uri" | "card_faces">, signal: AbortSignal): Promise<Ruling[]> {
    const record = await loadRecord(card)
    if (record) return record.rulings
    const res = await scryfallGet(card.rulings_uri, { signal })
    // Scryfall busy or down: an error, not "no rulings"
    if (res?.object !== "list" || !Array.isArray(res.data)) throw new Error(res?.details ?? "No rulings list")
    return res.data
}

// rulings already fetched this session, keyed by oracle id (every printing shares them)
const rulingsCache = new Map<string, Ruling[]>()

// a card's rulings, fetched when `enabled` turns on; undefined while loading, null if they couldn't be loaded
export function useRulings(card: Pick<ScryfallCard, "name" | "oracle_id" | "rulings_uri" | "card_faces">, enabled = true) {
    const key = oracleOf(card) ?? card.rulings_uri
    const [rulings, setRulings] = useState<Ruling[] | null | undefined>(() => rulingsCache.get(key))

    useEffect(() => {
        if (!enabled) return
        const cached = rulingsCache.get(key)
        if (cached) {
            setRulings(cached)
            return
        }
        setRulings(undefined)
        const controller = new AbortController()
        loadRulings(card, controller.signal)
            .then((list) => {
                rulingsCache.set(key, list)
                if (!controller.signal.aborted) setRulings(list)
            })
            .catch((err) => {
                if (err instanceof DOMException && err.name === "AbortError") return
                console.error("Failed to fetch rulings: ", err)
                // not cached, so opening the card again tries again
                setRulings(null)
            })
        return () => controller.abort()
    }, [key, enabled])

    return rulings
}
