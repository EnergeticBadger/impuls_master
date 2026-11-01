// ---- decks kept in the browser: the saved shape and reading it back safely; no state, no UI ----

import type { Deck, DeckEntry } from "./deck.ts";
import type { ScryfallCard } from "~/types";

export type SavedDeck = { id: string; name: string; updated: number; deck: Deck }

export const newDeck = (name: string, now: number, id: string): SavedDeck =>
    ({ id, name, updated: now, deck: { main: [], side: [] } })

// the deck being built: the current one, or when that's gone (deleted, stale saved id) the most recently updated
export function deckToBuild<T extends { id: string; updated: number }>(list: readonly T[], current?: string): T | undefined {
    return list.find((d) => d.id === current) ?? list.reduce<T | undefined>((best, d) => (!best || d.updated > best.updated ? d : best), undefined)
}

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
        decks.push({
            id: item.id,
            name: item.name,
            updated: typeof item.updated === "number" ? item.updated : 0,
            deck: slimDeck(saved),
        })
    }
    return decks
}
