// ---- practice hands: pure functions, the caller supplies the randomness ----

import type { ScryfallCard } from "~/types";
import type { Deck } from "./deck.ts";

// one element per copy in the main deck (no sideboard, no commander)
export function libraryOf(deck: Deck): ScryfallCard[] {
    return deck.main.flatMap(e => Array.from({ length: e.count }, () => e.card))
}

// Fisher-Yates; returns a new array
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
    }
    return out
}

export function drawHand<T>(library: readonly T[], size: number, random: () => number): { hand: T[]; rest: T[] } {
    const shuffled = shuffle(library, random)
    const n = Math.max(0, Math.min(size, shuffled.length))
    return { hand: shuffled.slice(0, n), rest: shuffled.slice(n) }
}
