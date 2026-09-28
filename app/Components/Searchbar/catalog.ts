import { useEffect, useState } from 'react'
import { scryfallGet } from '~/lib/scryfall'

// Scryfall's lists of every type word, used to fix plurals ("dragons" → Dragon) and to spot types that don't exist.

// every list a `t:` search can match against
const TYPE_CATALOGS = [
    'creature-types', 'planeswalker-types', 'land-types', 'artifact-types', 'enchantment-types',
    'spell-types', 'battle-types', 'supertypes', 'card-types',
] as const

type CatalogName = typeof TYPE_CATALOGS[number]

const loaded: Partial<Record<CatalogName, string[]>> = {}
const loading = new Map<CatalogName, Promise<string[]>>()

export function loadCatalog(name: CatalogName): Promise<string[]> {
    let p = loading.get(name)
    if (!p) {
        p = scryfallGet(`catalog/${name}`).then((res) => {
            if (!Array.isArray(res?.data)) throw new Error(`catalog ${name} failed`)
            return loaded[name] = res.data as string[]
        })
        // let a later call try again after a failure
        p.catch(() => loading.delete(name))
        loading.set(name, p)
    }
    return p
}

export const loadTypeCatalogs = () => Promise.allSettled(TYPE_CATALOGS.map(loadCatalog))

// what's already loaded, for code that can't wait (building a search as it's typed)
export const creatureTypes = () => loaded['creature-types']
export function allTypes(): string[] | undefined {
    if (!TYPE_CATALOGS.every((n) => loaded[n])) return undefined
    return TYPE_CATALOGS.flatMap((n) => loaded[n]!)
}

export function useCatalog(name: CatalogName) {
    const [list, setList] = useState(loaded[name])
    useEffect(() => {
        let live = true
        loadCatalog(name).then((l) => live && setList(l), () => { })
        return () => { live = false }
    }, [name])
    return list
}

// words whose plural isn't just the singular plus an ending
const IRREGULAR: Record<string, string> = {
    mice: 'mouse', geese: 'goose', cyclopes: 'cyclops', oxen: 'ox',
}

// the type a word names, allowing for plurals: dragons → Dragon, elves → Elf, fungi → Fungus.
// Only returns a type that's really in the list, so it's never a guess.
export function singular(word: string, types: readonly string[] | undefined): string | undefined {
    if (!types) return undefined
    const w = word.trim().toLowerCase()
    if (!w) return undefined
    const tries = [
        w,
        IRREGULAR[w],
        w.replace(/ies$/, 'y'),
        w.replace(/ves$/, 'f'),
        w.replace(/ves$/, 'fe'),
        w.replace(/es$/, ''),
        w.replace(/s$/, ''),
        w.replace(/men$/, 'man'),
        w.replace(/i$/, 'us'),
    ]
    for (const t of tries) {
        if (!t) continue
        const hit = types.find((x) => x.toLowerCase() === t)
        if (hit) return hit
    }
    return undefined
}

// types matching what's typed so far: exact or plural match first, then ones that start with it, then ones containing it
export function findTypes(query: string, types: readonly string[] | undefined, limit = 8): string[] {
    const q = query.trim().toLowerCase()
    if (!q || !types) return []
    const exact = singular(q, types)
    const starts = types.filter((t) => t.toLowerCase().startsWith(q))
    const contains = types.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))
    return [...new Set([...(exact ? [exact] : []), ...starts, ...contains])].slice(0, limit)
}

// a `t:` value is only wrong for sure when no type word contains it (Scryfall allows partial words)
export function isKnownType(value: string) {
    const types = allTypes()
    if (!types) return true
    const v = value.toLowerCase()
    return types.some((t) => t.toLowerCase().includes(v))
}
