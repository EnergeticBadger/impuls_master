import { useEffect, useState } from "react";
import type { Ruling, ScryfallCard } from "~/types";
import { scryfallGet } from "./scryfall";
import { mapPool } from "./pool";
import { SITE_URL, bucketHeader, bucketOf, bucketOfName, oracleOf, paths, pickByName, pickPrinting, printingCard, readRecord, slug, type CardRecord } from "./carddata";

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

// one of the site's card data files; undefined when the site doesn't have it
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

// one of the site's small JSON data files, parsed; undefined when the site doesn't have it
export async function dataJson<T>(path: string): Promise<T | undefined> {
    const bytes = await dataFile(path)
    try {
        return bytes && JSON.parse(new TextDecoder().decode(bytes)) as T
    } catch (err) {
        console.error(`Card data file ${path} isn't JSON: `, err)
        return undefined
    }
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

type NameLine = { name: string; set?: string; number?: string }

// the card a line means, read from its bucket file's bytes; undefined when the data has no such card
// (front-face-only names, which Scryfall matches, and a missing file both mean "ask Scryfall")
function cardFromBucket(bytes: Uint8Array | undefined, line: NameLine): ScryfallCard | undefined {
    if (!bytes) return undefined
    const header = bucketHeader(bytes)
    const record = pickByName(bytes, header, line.name, line.set, line.number)
    return record ? printingCard(record, pickPrinting(record, line.set, line.number)) : undefined
}

async function cardFromScryfall(line: NameLine): Promise<ScryfallCard | undefined> {
    try {
        const query = `exact=${encodeURIComponent(line.name)}${line.set ? `&set=${encodeURIComponent(line.set)}` : ""}`
        const card = await scryfallGet(`cards/named?${query}`)
        return card?.object === "card" ? card as ScryfallCard : undefined
    } catch (err) {
        console.error(`Failed to look up ${line.name}: `, err)
        return undefined
    }
}

// a card by name (and set and collector number) for deck import: the site's card data first, Scryfall when
// the data files aren't there (local dev); undefined when no such card
export async function cardByName(line: NameLine): Promise<ScryfallCard | undefined> {
    return cardFromBucket(await dataFile(paths.bucket(bucketOfName(line.name))), line) ?? cardFromScryfall(line)
}

// how many bucket files are fetched at once
const BUCKET_FETCHES = 8

// Looks the lines up. Each bucket file is fetched once, several at a time, and serves every line in it (a deck's
// cards are spread over hundreds of buckets, so fetching one by one was most of the wait). Only the lines the
// card data can't answer go to Scryfall, one after another, so they stay within the proxy's spacing.
export async function cardsByName<L extends NameLine>(lines: L[], onProgress?: (done: number, total: number) => void):
    Promise<{ found: { line: L; card: ScryfallCard }[]; missing: L[] }> {
    const cards = new Array<ScryfallCard | undefined>(lines.length)
    const byBucket = new Map<number, number[]>()
    lines.forEach((line, i) => {
        const b = bucketOfName(line.name)
        byBucket.set(b, [...(byBucket.get(b) ?? []), i])
    })
    let done = 0
    const tick = () => onProgress?.(++done, lines.length)
    const needScryfall: number[] = []
    await mapPool([...byBucket.entries()], BUCKET_FETCHES, async ([bucket, indexes]) => {
        const bytes = await dataFile(paths.bucket(bucket))
        for (const i of indexes) {
            cards[i] = cardFromBucket(bytes, lines[i])
            if (cards[i]) tick()
            else needScryfall.push(i)
        }
    })
    needScryfall.sort((a, b) => a - b)
    for (const i of needScryfall) {
        cards[i] = await cardFromScryfall(lines[i])
        tick()
    }
    const found: { line: L; card: ScryfallCard }[] = []
    const missing: L[] = []
    lines.forEach((line, i) => {
        const card = cards[i]
        if (card) found.push({ line, card })
        else missing.push(line)
    })
    return { found, missing }
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
