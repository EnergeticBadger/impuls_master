// ---- decks kept in the browser: the saved shape and reading it back safely; no state, no UI ----

import type { Deck, DeckEntry } from "./deck.ts";
import type { ScryfallCard } from "~/types";

export type SavedDeck = { id: string; name: string; updated: number; deck: Deck; format?: string }

export const newDeck = (name: string, now: number, id: string): SavedDeck =>
    ({ id, name, updated: now, deck: { main: [], side: [] } })

// a copy of a saved deck under a new id and time, named "<name> (copy)"; the lists are new arrays and entries,
// so changing the copy can't change the original
export function copyDeck(saved: SavedDeck, now: number, id: string): SavedDeck {
    const copyEntries = (entries: DeckEntry[]): DeckEntry[] => entries.map((e) => ({ ...e }))
    const deck: Deck = { main: copyEntries(saved.deck.main), side: copyEntries(saved.deck.side) }
    if (saved.deck.commander) deck.commander = { ...saved.deck.commander }
    return { id, name: `${saved.name} (copy)`, updated: now, deck }
}

// the deck being built: the current one, or when that's gone (deleted, stale saved id) the most recently updated
export function deckToBuild<T extends { id: string; updated: number }>(list: readonly T[], current?: string): T | undefined {
    return list.find((d) => d.id === current) ?? list.reduce<T | undefined>((best, d) => (!best || d.updated > best.updated ? d : best), undefined)
}

// most recently updated first; a new array, the input is left alone
export const decksByRecent = <T extends { updated: number }>(list: readonly T[]): T[] =>
    [...list].sort((a, b) => b.updated - a.updated)

type Bag = Record<string, unknown>

// a copy of `from` with only the listed keys that are present (never an `undefined` key)
function pick(from: unknown, keys: readonly string[]): Bag {
    const out: Bag = {}
    if (typeof from !== "object" || from === null) return out
    const src = from as Bag
    for (const k of keys) if (src[k] !== undefined) out[k] = src[k]
    return out
}

const slimImages = (v: unknown) => (typeof v === "object" && v !== null ? pick(v, ["small", "normal"]) : undefined)

const CARD_KEYS = ["id", "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "colors",
    "color_identity", "legalities", "set", "collector_number", "rarity"] as const
const FACE_KEYS = ["name", "mana_cost", "type_line", "oracle_text", "colors"] as const

// the card with only the fields the deck code uses, so saved decks stay small in localStorage
export function slimCard(card: ScryfallCard): ScryfallCard {
    const src: Bag = { ...card }
    const out = pick(src, CARD_KEYS)
    if (src.prices) out.prices = pick(src.prices, ["usd", "usd_foil", "eur", "tix"])
    const images = slimImages(src.image_uris)
    if (images) out.image_uris = images
    if (Array.isArray(src.card_faces)) {
        out.card_faces = src.card_faces.map((face: unknown) => {
            const slim = pick(face, FACE_KEYS)
            const faceImages = slimImages((face as Bag | null)?.image_uris)
            if (faceImages) slim.image_uris = faceImages
            return slim
        })
    }
    return out as unknown as ScryfallCard
}

const slimEntry = (e: DeckEntry): DeckEntry => ({ ...e, card: slimCard(e.card) })

export function slimDeck(deck: Deck): Deck {
    const slim: Deck = { main: deck.main.map(slimEntry), side: deck.side.map(slimEntry) }
    if (deck.commander) slim.commander = slimEntry(deck.commander)
    return slim
}

const isRecord =(v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

const isEntry = (v: unknown): v is DeckEntry =>
    isRecord(v) && isRecord(v.card) && typeof v.card.id === "string" && v.card.id !== ""
    && typeof v.count === "number" && v.count > 0

const entriesOf = (v: unknown): DeckEntry[] => (Array.isArray(v) ? v.filter(isEntry) : [])

// the decks in parsed localStorage JSON that are well-formed; anything else is dropped, never thrown on
export function readSavedDecks(json: unknown): SavedDeck[] {
    if (!Array.isArray(json)) return []
    const decks: SavedDeck[] = []
    for (const item of json) {
        if (!isRecord(item)) continue
        if (typeof item.id !== "string" || item.id === "") continue
        if (typeof item.name !== "string" || item.name === "") continue
        const deck = isRecord(item.deck) ? item.deck : {}
        const saved: Deck = { main: entriesOf(deck.main), side: entriesOf(deck.side) }
        if (isEntry(deck.commander)) saved.commander = deck.commander
        const read: SavedDeck = {
            id: item.id,
            name: item.name,
            updated: typeof item.updated === "number" ? item.updated : 0,
            deck: slimDeck(saved),
        }
        if (typeof item.format === "string") read.format = item.format
        decks.push(read)
    }
    return decks
}

// what to tell people when writing their decks to localStorage failed: a full storage, or anything else
export function saveErrorMessage(error: unknown): string {
    const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        return "Your browser's storage is full, so the latest deck changes were not saved. Delete a deck or copy this one out with Export."
    }
    return "Your browser didn't let us save your decks, so the latest changes will be lost on reload."
}

const BACKUP_APP = "impulse-caster"

// every deck as one file's text, cards slimmed
export function backupJson(list: SavedDeck[]): string {
    const decks = list.map((d) => ({ ...d, deck: slimDeck(d.deck) }))
    return JSON.stringify({ app: BACKUP_APP, version: 1, decks })
}

// the decks in a backup file's text; a bad file gives no decks and a one-line error, bad entries are dropped
export function readBackup(text: string): { decks: SavedDeck[]; error?: string } {
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        return { decks: [], error: "That file isn't a deck backup (it isn't valid JSON)." }
    }
    if (!isRecord(json) || json.app !== BACKUP_APP) {
        return { decks: [], error: "That file isn't an Impulse Caster deck backup." }
    }
    return { decks: readSavedDecks(json.decks) }
}

// existing decks plus the incoming ones: a new id is added; for an id already there the later `updated` wins
export function mergeDecks(existing: SavedDeck[], incoming: SavedDeck[]): SavedDeck[] {
    const merged = [...existing]
    for (const deck of incoming) {
        const at = merged.findIndex((d) => d.id === deck.id)
        if (at < 0) merged.push(deck)
        else if (deck.updated > merged[at].updated) merged[at] = deck
    }
    return merged
}

// what a tab holds after another tab saved: that tab's decks, keeping our `current` if that deck still exists
export function reloadFromStorage(newValue: string | null, current?: string): { list: SavedDeck[]; current?: string } {
    const saved: unknown = JSON.parse(newValue ?? 'null')
    const list = readSavedDecks(isRecord(saved) ? saved.list : undefined)
    return { list, current: list.some((d) => d.id === current) ? current : undefined }
}

// Lets a store skip the one write its own storage-driven reload triggers, so tabs never echo each other's saves.
// Call skipNext() when a reload changes the store; shouldWrite() answers for each change notification after.
export function writeGate() {
    let skip = false
    return {
        skipNext() { skip = true },
        shouldWrite(): boolean {
            const write = !skip
            skip = false
            return write
        },
    }
}
