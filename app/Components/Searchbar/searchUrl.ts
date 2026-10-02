import { SORT_ORDERS, type SortDir, type SortOrder } from '../Context/sort'

// A search as an address, like `/?q=t:elf c:g&order=usd&dir=desc&page=2`, so it can be shared and survives a
// refresh or the back button. The names are Scryfall's own; the default sort and the first page are left out.
export type SearchTarget = { q: string, order: SortOrder, dir: SortDir, page: number }

// the search an address asks for, or null when it has none
export function readSearchUrl(search: string): SearchTarget | null {
    const params = new URLSearchParams(search)
    const q = params.get('q')?.trim()
    if (!q) return null
    const order = SORT_ORDERS.find((o) => o.value === params.get('order'))?.value ?? 'name'
    const dir = (['asc', 'desc'] as const).find((d) => d === params.get('dir')) ?? 'auto'
    const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1)
    return { q, order, dir, page }
}

// spaces as `+`, and `:` and `/` left as they are, so `?q=t:elf+c:g` stays readable
const encode = (v: string) => encodeURIComponent(v).replace(/%20/g, '+').replace(/%3A/gi, ':').replace(/%2F/gi, '/')

// the `?...` part of the address for a search; empty for no search
export function searchUrl(t: { q: string, order: string, dir: string, page: number } | null): string {
    if (!t?.q) return ''
    let url = `?q=${encode(t.q)}`
    if (t.order !== 'name') url += `&order=${encode(t.order)}`
    if (t.dir !== 'auto') url += `&dir=${encode(t.dir)}`
    if (t.page > 1) url += `&page=${t.page}`
    return url
}
