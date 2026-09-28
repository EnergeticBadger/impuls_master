import { proxy, subscribe } from "valtio";

export const MIN_PER_ROW = 1
export const MAX_PER_ROW = 10
const STORAGE_KEY = 'cards-per-row'

// how many cards the grid tries to fit in a row; 0 lets the screen width decide
export const view = proxy<{ perRow: number }>({ perRow: 0 })

// read after hydration so the server and first client render agree
export function loadView() {
    try {
        const saved = Number(localStorage.getItem(STORAGE_KEY))
        if (saved >= MIN_PER_ROW && saved <= MAX_PER_ROW) view.perRow = saved
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(view, () => {
        try { localStorage.setItem(STORAGE_KEY, String(view.perRow)) } catch { }
    })
}
