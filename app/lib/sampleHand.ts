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

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

// the chance that `seen` cards drawn without replacement from `deckSize` include at least one of `copies`:
// 1 - C(deckSize - copies, seen) / C(deckSize, seen), as a running product so 100-card decks don't overflow.
// Bad input (negative, NaN) counts as 0, and copies or seen beyond the deck size are capped at it.
export function atLeastOneChance(deckSize: number, copies: number, seen: number): number {
    const n = whole(deckSize)
    const k = Math.min(whole(copies), n)
    const s = Math.min(whole(seen), n)
    if (k === 0 || s === 0) return 0
    if (s > n - k) return 1
    let none = 1
    for (let i = 0; i < s; i++) none *= (n - k - i) / (n - i)
    return 1 - none
}

// cards seen by the given turn: the opening 7, plus one draw a turn, skipping the first draw on the play
export const cardsSeen = (turn: number, onThePlay: boolean): number => 7 + turn - (onThePlay ? 1 : 0)
