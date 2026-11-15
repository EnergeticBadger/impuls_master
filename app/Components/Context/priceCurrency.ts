import { proxy, subscribe } from "valtio";

const STORAGE_KEY = 'priceCurrency'

export type PriceCurrency = 'usd' | 'eur' | 'tix'

// which currency the deck price estimate uses; remembered in the browser
export const priceCurrency = proxy<{ currency: PriceCurrency }>({ currency: 'usd' })

// read after hydration so the server and first client render agree
export function loadPriceCurrency() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === 'usd' || saved === 'eur' || saved === 'tix') priceCurrency.currency = saved
    } catch { }
}

if (typeof window !== 'undefined') {
    subscribe(priceCurrency, () => {
        try { localStorage.setItem(STORAGE_KEY, priceCurrency.currency) } catch { }
    })
}
