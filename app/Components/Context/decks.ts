import { proxy, ref, subscribe } from "valtio";
import { addCard, removeCard, type Deck } from "~/lib/deck";
import type { ScryfallCard } from "~/types";
import { newDeck, readSavedDecks, type SavedDeck } from "~/lib/savedDecks";

const STORAGE_KEY = 'decks'

// the user's decks, kept in the browser like the compare drawer's cards; `current` is the id of the deck being built.
// Each deck is stored with ref() so valtio doesn't wrap every Scryfall field in a proxy.
export const decks = proxy<{ list: SavedDeck[], current?: string }>({ list: [] })

export function createDeck(name: string): SavedDeck {
    const made = newDeck(name, Date.now(), crypto.randomUUID())
    decks.list.push(ref(made))
    decks.current = made.id
    return made
}

export function renameDeck(id: string, name: string) {
    update(id, (d) => ({ ...d, name }))
}

export function deleteDeck(id: string) {
    decks.list = decks.list.filter((d) => d.id !== id)
    if (decks.current === id) decks.current = undefined
}

export function setCurrentDeck(id: string) {
    decks.current = id
}

// applies a function from deck.ts (addCard, removeCard, ...) to the deck and bumps `updated`
export function updateDeck(id: string, fn: (deck: Deck) => Deck) {
    update(id, (d) => ({ ...d, deck: fn(d.deck) }))
}

// one copy into the current deck's main deck; with no decks yet, makes "Untitled deck" first
export function addToCurrentDeck(card: ScryfallCard) {
    const id = decks.list.some((d) => d.id === decks.current) ? decks.current : decks.list.length ? undefined : createDeck("Untitled deck").id
    if (!id) return
    updateDeck(id, (deck) => addCard(deck, card))
}

export function removeFromCurrentDeck(card: ScryfallCard) {
    if (decks.current) updateDeck(decks.current, (deck) => removeCard(deck, card))
}

// the deck being built, if there is one
export const currentDeckOf = <T extends { id: string }>(list: readonly T[], current?: string): T | undefined =>
    list.find((d) => d.id === current)

// saved decks are replaced rather than edited in place, so the ref() stays whole
function update(id: string, fn: (saved: SavedDeck) => SavedDeck) {
    const at = decks.list.findIndex((d) => d.id === id)
    if (at < 0) return
    decks.list[at] = ref({ ...fn(decks.list[at]), updated: Date.now() })
}

// read after hydration so the server and first client render agree
export function loadDecks() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        decks.list = readSavedDecks(saved?.list).map((d) => ref(d))
        decks.current = decks.list.some((d) => d.id === saved?.current) ? saved.current : undefined
    } catch (e) {
        console.error('Could not read saved decks', e)
    }
}

if (typeof window !== 'undefined') {
    subscribe(decks, () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: decks.list, current: decks.current }))
        } catch (e) {
            console.error('Could not save decks', e)
        }
    })
}
