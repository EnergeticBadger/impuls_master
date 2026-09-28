import { proxy, ref, subscribe } from "valtio";
import type { CardProps } from "~/types";

const STORAGE_KEY = 'compare'

// cards picked for side-by-side comparison; `collapsed` shrinks the drawer to its title bar.
// Cards are stored with ref() so valtio doesn't wrap every Scryfall field in a proxy.
export const compare = proxy<{ cards: CardProps[], collapsed: boolean }>({ cards: [], collapsed: false })

export const inCompare = (cards: readonly { card: { id: string } }[], id: string) => cards.some((c) => c.card.id === id)

export function toggleCompare(props: CardProps) {
    const at = compare.cards.findIndex((c) => c.card.id === props.card.id)
    if (at >= 0) {
        compare.cards.splice(at, 1)
    } else {
        // the props come from a render snapshot (a tracking proxy structuredClone can't copy), so copy through JSON
        compare.cards.push(ref(JSON.parse(JSON.stringify(props))))
        compare.collapsed = false
    }
}

export function removeCompare(id: string) {
    compare.cards = compare.cards.filter((c) => c.card.id !== id)
}

export function clearCompare() {
    compare.cards = []
}

// read after hydration so the server and first client render agree
export function loadCompare() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        if (Array.isArray(saved?.cards)) compare.cards = saved.cards.filter((c: CardProps) => c?.card?.id).map((c: CardProps) => ref(c))
        compare.collapsed = !!saved?.collapsed
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(compare, () => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: compare.cards, collapsed: compare.collapsed })) } catch { }
    })
}
