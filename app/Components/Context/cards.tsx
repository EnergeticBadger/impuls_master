import { proxy } from "valtio";
import { deepClone } from "valtio/utils";
import type { CardProps } from "~/types";

// how many result pages stay rendered (hidden) so going back and forth doesn't rebuild them
const KEEP_MOUNTED = 4

export type ResultPage = { key: string, cards: CardProps[], has_more: boolean, scrollY: number, seen: number }

// `pages` keeps a stable order so React never moves or rebuilds a page's cards; `active` is the one on screen
export const cardsearch = proxy<{ pages: ResultPage[], active: string }>({ pages: [], active: '' })

let clock = 0

export function pageKey(query: string, page: number) {
    return `${query}\u0000${page}`
}

export function getPage(key: string) {
    return cardsearch.pages.find((p) => p.key === key)
}

// show a page, adding it if it's new, and remember where we were scrolled on the page we're leaving
export function showPage(key: string, cards?: CardProps[], has_more = false) {
    const leaving = getPage(cardsearch.active)
    if (leaving && typeof window !== 'undefined') leaving.scrollY = window.scrollY

    let page = getPage(key)
    if (!page) {
        cardsearch.pages.push({ key, cards: deepClone(cards ?? []), has_more, scrollY: 0, seen: ++clock })
        if (cardsearch.pages.length > KEEP_MOUNTED) {
            const oldest = cardsearch.pages.reduce((a, b) => (a.seen <= b.seen ? a : b))
            cardsearch.pages.splice(cardsearch.pages.indexOf(oldest), 1)
        }
        page = getPage(key)!
    }
    page.seen = ++clock
    cardsearch.active = key

    if (typeof window !== 'undefined') {
        const y = page.scrollY
        requestAnimationFrame(() => window.scrollTo(0, y))
    }
}
