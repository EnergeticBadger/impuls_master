import { proxy, subscribe } from "valtio";

// Simple is a name box and a few one-tap filters; Advanced is every filter, built up as chips.
// Both edit the same chips, so switching keeps the search.
export type SearchMode = 'simple' | 'advanced'

const STORAGE_KEY = 'search-mode'

export const searchMode = proxy<{ mode: SearchMode }>({ mode: 'simple' })

// read after hydration so the server and first client render agree
export function loadMode() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === 'simple' || saved === 'advanced') searchMode.mode = saved
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(searchMode, () => {
        try { localStorage.setItem(STORAGE_KEY, searchMode.mode) } catch { }
    })
}
