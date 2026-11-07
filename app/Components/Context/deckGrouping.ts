import { proxy, subscribe } from "valtio";

const STORAGE_KEY = 'deckGrouping'

export type DeckGrouping = 'type' | 'manaValue'

// how the deck page groups the main deck; remembered in the browser
export const deckGrouping = proxy<{ by: DeckGrouping }>({ by: 'type' })

// read after hydration so the server and first client render agree
export function loadDeckGrouping() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === 'type' || saved === 'manaValue') deckGrouping.by = saved
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(deckGrouping, () => {
        try { localStorage.setItem(STORAGE_KEY, deckGrouping.by) } catch { }
    })
}
