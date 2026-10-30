// ---- decks kept in the browser: the saved shape and reading it back safely; no state, no UI ----

import type { Deck, DeckEntry } from "./deck.ts";

export type SavedDeck = { id: string; name: string; updated: number; deck: Deck }

export const newDeck = (name: string, now: number, id: string): SavedDeck =>
    ({ id, name, updated: now, deck: { main: [], side: [] } })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

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
            deck: saved,
        })
    }
    return decks
}
