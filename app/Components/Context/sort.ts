import { proxy, subscribe } from "valtio";

// Scryfall's `order` values we offer, with the words people see and what each direction means for it
export const SORT_ORDERS = [
    { value: 'name', label: 'Name', asc: 'A → Z', desc: 'Z → A' },
    { value: 'cmc', label: 'Mana value', asc: 'Low → high', desc: 'High → low' },
    { value: 'usd', label: 'Price (USD)', asc: 'Cheapest first', desc: 'Priciest first' },
    { value: 'eur', label: 'Price (EUR)', asc: 'Cheapest first', desc: 'Priciest first' },
    { value: 'tix', label: 'Price (MTGO)', asc: 'Cheapest first', desc: 'Priciest first' },
    { value: 'released', label: 'Release date', asc: 'Oldest first', desc: 'Newest first' },
    { value: 'rarity', label: 'Rarity', asc: 'Common first', desc: 'Mythic first' },
    { value: 'color', label: 'Color', asc: 'White → green', desc: 'Green → white' },
    { value: 'power', label: 'Power', asc: 'Low → high', desc: 'High → low' },
    { value: 'toughness', label: 'Toughness', asc: 'Low → high', desc: 'High → low' },
    { value: 'edhrec', label: 'EDHREC popularity', asc: 'Most popular first', desc: 'Least popular first' },
    { value: 'set', label: 'Set', asc: 'A → Z', desc: 'Z → A' },
    { value: 'artist', label: 'Artist', asc: 'A → Z', desc: 'Z → A' },
] as const

export type SortOrder = typeof SORT_ORDERS[number]['value']
// 'auto' lets Scryfall pick the natural direction for the order
export type SortDir = 'auto' | 'asc' | 'desc'

const STORAGE_KEY = 'sort'

export const sort = proxy<{ order: SortOrder, dir: SortDir }>({ order: 'name', dir: 'auto' })

// one string per sort, so pages sorted differently are kept apart
export const sortKey = (s: { order: string, dir: string } = sort) => `${s.order} ${s.dir}`

// read after hydration so the server and first client render agree
export function loadSort() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        if (SORT_ORDERS.some((o) => o.value === saved?.order)) sort.order = saved.order
        if (['auto', 'asc', 'desc'].includes(saved?.dir)) sort.dir = saved.dir
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(sort, () => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: sort.order, dir: sort.dir })) } catch { }
    })
}
