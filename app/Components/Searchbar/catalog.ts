import { useEffect, useState } from 'react'
import { dataJson } from '~/lib/card'
import { paths } from '~/lib/carddata'
import { scryfallGet } from '~/lib/scryfall'
import { AFFINITY_SUBTYPES, AFFINITY_TYPES, MECHANICS, mechanicByValue, OUR_SEARCHES, type MechanicsFile } from './mechanics'

// Scryfall's lists of every type word, used to fix plurals ("dragons" → Dragon) and to spot types that don't exist.

// every list a `t:` search can match against
const TYPE_CATALOGS = [
    'creature-types', 'planeswalker-types', 'land-types', 'artifact-types', 'enchantment-types',
    'spell-types', 'battle-types', 'supertypes', 'card-types',
] as const

// everything a `kw:` search matches: keyword abilities (Flying), keyword actions (Scry) and ability words (Landfall)
const KEYWORD_CATALOGS = ['keyword-abilities', 'keyword-actions', 'ability-words'] as const

type CatalogName = typeof TYPE_CATALOGS[number] | typeof KEYWORD_CATALOGS[number]

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

// every type word except creature types (those have their own picker), grouped the way a type line reads
export const TYPE_GROUPS: { name: CatalogName, label: string }[] = [
    { name: 'card-types', label: 'Card types' },
    { name: 'supertypes', label: 'Supertypes' },
    { name: 'artifact-types', label: 'Artifact types' },
    { name: 'enchantment-types', label: 'Enchantment types' },
    { name: 'land-types', label: 'Land types' },
    { name: 'spell-types', label: 'Instant & sorcery types' },
    { name: 'battle-types', label: 'Battle types' },
    { name: 'planeswalker-types', label: 'Planeswalker types' },
]

// types Scryfall lists that no card in a normal search has (they're only on tokens, schemes or digital-only cards),
// so offering them would only lead to "no cards found"
// (checked against Scryfall one type at a time)
const NO_CARDS = new Set([
    'boss', 'event', 'ongoing', 'blood', 'gold', 'incubator', 'junk', 'map', 'terminus', 'role', 'shard', 'cloud',
    'abian', 'deb', 'duck', 'ersta', 'inzerva', 'luxior', 'master', 'monopoly', 'svega', 'wanderer',
])

// a type written the way cards print it: `saga` → Saga, `urza's` → Urza's
export function typeLabel(value: string) {
    const v = value.toLowerCase()
    const hit = TYPE_CATALOGS.flatMap((n) => loaded[n] ?? []).find((t) => t.toLowerCase() === v)
    return hit ?? value.charAt(0).toUpperCase() + value.slice(1)
}

export type TypeGroup = { label: string, types: string[] }

// the groups above as they load, each list sorted A–Z
export function useTypeGroups(): TypeGroup[] | undefined {
    const [groups, setGroups] = useState<TypeGroup[] | undefined>(() => build())
    function build() {
        // a list that failed to load is just left out
        const ready = TYPE_GROUPS.filter((g) => loaded[g.name])
        if (!ready.length) return undefined
        return ready.map((g) => ({
            label: g.label,
            types: loaded[g.name]!.filter((t) => !NO_CARDS.has(t.toLowerCase())).sort((a, b) => a.localeCompare(b)),
        }))
    }
    useEffect(() => {
        let live = true
        Promise.allSettled(TYPE_GROUPS.map((g) => loadCatalog(g.name))).then(() => { if (live) setGroups(build()) })
        return () => { live = false }
    }, [])
    return groups
}

// each card type's subtypes, the words after the dash on its type line ("Artifact — Equipment").
// `types` are the card types that can have them; instants and sorceries share theirs
export const SUBTYPE_GROUPS: { name: CatalogName, label: string, types: string[] }[] = [
    { name: 'artifact-types', label: 'Artifact', types: ['artifact'] },
    { name: 'enchantment-types', label: 'Enchantment', types: ['enchantment'] },
    { name: 'land-types', label: 'Land', types: ['land'] },
    { name: 'spell-types', label: 'Instant & sorcery', types: ['instant', 'sorcery'] },
    { name: 'planeswalker-types', label: 'Planeswalker', types: ['planeswalker'] },
    { name: 'battle-types', label: 'Battle', types: ['battle'] },
    // last: there are hundreds, and they'd push the others out of sight
    { name: 'creature-types', label: 'Creature', types: ['creature', 'kindred'] },
]

// the subtype groups as they load, each sorted A–Z
export function useSubtypeGroups(): TypeGroup[] | undefined {
    const [groups, setGroups] = useState<TypeGroup[] | undefined>(() => build())
    function build() {
        const ready = SUBTYPE_GROUPS.filter((g) => loaded[g.name])
        if (!ready.length) return undefined
        return ready.map((g) => ({
            label: g.label,
            types: loaded[g.name]!.filter((t) => !NO_CARDS.has(t.toLowerCase())).sort((a, b) => a.localeCompare(b)),
        }))
    }
    useEffect(() => {
        let live = true
        Promise.allSettled(SUBTYPE_GROUPS.map((g) => loadCatalog(g.name))).then(() => { if (live) setGroups(build()) })
        return () => { live = false }
    }, [])
    return groups
}

const KEYWORD_GROUPS: { name: typeof KEYWORD_CATALOGS[number], label: string }[] = [
    { name: 'keyword-abilities', label: 'Keyword abilities' },
    { name: 'keyword-actions', label: 'Keyword actions' },
    { name: 'ability-words', label: 'Ability words' },
]

// a keyword written the way cards print it: `first strike` → First strike
export function keywordLabel(value: string) {
    const mechanic = mechanicByValue(value)
    if (mechanic) return mechanic.label
    const v = value.toLowerCase()
    const hit = KEYWORD_CATALOGS.flatMap((n) => loaded[n] ?? []).find((k) => k.toLowerCase() === v)
    return hit ?? value.charAt(0).toUpperCase() + value.slice(1)
}

// our own mechanics (./mechanics.ts), last, after Scryfall's lists, then Affinity for a type and for a subtype
const ourGroups: TypeGroup[] = [
    { label: 'Mechanics', types: MECHANICS.map((m) => m.label).sort((a, b) => a.localeCompare(b)) },
    { label: 'Affinity for a type', types: AFFINITY_TYPES.map((m) => m.label) },
    { label: 'Affinity for a subtype', types: AFFINITY_SUBTYPES.map((m) => m.label) },
]

// the three keyword lists as they load, each sorted A–Z, then our own groups. Undefined until Scryfall's lists
// have loaded or failed; ours are shown either way
export function useKeywordGroups(): TypeGroup[] | undefined {
    const [groups, setGroups] = useState<TypeGroup[] | undefined>(() => build(false))
    function build(settled: boolean) {
        const ready = KEYWORD_GROUPS.filter((g) => loaded[g.name])
        if (!ready.length && !settled) return undefined
        return [...ready.map((g) => ({ label: g.label, types: [...loaded[g.name]!].sort((a, b) => a.localeCompare(b)) })), ...ourGroups]
    }
    useEffect(() => {
        let live = true
        Promise.allSettled(KEYWORD_GROUPS.map((g) => loadCatalog(g.name))).then(() => { if (live) setGroups(build(true)) })
        return () => { live = false }
    }, [])
    return groups
}

// how many cards each mechanic finds, by value, from the nightly card data. Empty where the site has no card
// data (local dev) and for a mechanic whose search changed after the count was made
let mechanicCounts: Promise<Map<string, number>> | undefined
export function useMechanicCounts(): Map<string, number> | undefined {
    const [counts, setCounts] = useState<Map<string, number>>()
    useEffect(() => {
        let live = true
        mechanicCounts ??= dataJson<MechanicsFile>(paths.mechanics()).then((file) => new Map(
            OUR_SEARCHES.flatMap((m) => {
                const entry = file?.mechanics[m.value]
                return entry?.token === m.token ? [[m.value, entry.count] as const] : []
            })))
        mechanicCounts.then((c) => live && setCounts(c))
        return () => { live = false }
    }, [])
    return counts
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

// Old creature types Wizards folded into another one (mostly in the 2007 creature type update), plus common
// misspellings. Old cards were retyped, so searching the old word finds nothing, or worse, matches it inside
// other words (`t:ant` finds Giants and Instants). Each was checked against how the named cards are typed today.
export const MERGED_TYPES: Record<string, { type: string, why: 'merged' | 'spelling' }> = {
    abomination: { type: 'Horror', why: 'merged' },
    ant: { type: 'Insect', why: 'merged' },
    asp: { type: 'Snake', why: 'merged' },
    bandit: { type: 'Rogue', why: 'merged' },
    bee: { type: 'Insect', why: 'merged' },
    bull: { type: 'Ox', why: 'merged' },
    cow: { type: 'Ox', why: 'merged' },
    fairy: { type: 'Faerie', why: 'spelling' },
    ghost: { type: 'Spirit', why: 'merged' },
    hound: { type: 'Dog', why: 'merged' },
    mage: { type: 'Wizard', why: 'merged' },
    magician: { type: 'Wizard', why: 'merged' },
    mammoth: { type: 'Elephant', why: 'merged' },
    mummy: { type: 'Zombie', why: 'merged' },
    paladin: { type: 'Knight', why: 'merged' },
    pikeman: { type: 'Soldier', why: 'merged' },
    priest: { type: 'Cleric', why: 'merged' },
    robber: { type: 'Rogue', why: 'merged' },
    spectre: { type: 'Specter', why: 'spelling' },
    swarm: { type: 'Insect', why: 'merged' },
    thief: { type: 'Rogue', why: 'merged' },
    undead: { type: 'Zombie', why: 'merged' },
    waterfowl: { type: 'Bird', why: 'merged' },
}

// an old or misspelled creature type word (plurals too: "ants", "thieves") and the type it became
export function mergedType(word: string): { from: string, type: string, why: 'merged' | 'spelling' } | undefined {
    const from = singular(word, Object.keys(MERGED_TYPES))
    return from ? { from, ...MERGED_TYPES[from] } : undefined
}

// the sentence explaining a merged type, shown wherever someone searches the old word
export function mergedNote(m: { from: string, type: string, why: 'merged' | 'spelling' }) {
    const old = m.from[0].toUpperCase() + m.from.slice(1)
    return m.why === 'spelling'
        ? `Magic spells it ${m.type}, not “${old}”.`
        : `${old} isn't a creature type any more. Wizards merged it into ${m.type}, and older ${old} cards were changed to ${m.type}.`
}

// types matching what's typed so far: exact or plural match first, then ones that start with it, then ones containing it
export function findTypes(query: string, types: readonly string[] | undefined, limit = 8): string[] {
    const q = query.trim().toLowerCase()
    if (!q || !types) return []
    // an old type points at the one it was merged into
    const exact = singular(q, types) ?? mergedType(q)?.type
    const starts = types.filter((t) => t.toLowerCase().startsWith(q))
    const contains = types.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))
    return [...new Set([...(exact ? [exact] : []), ...starts, ...contains])].slice(0, limit)
}

// a `t:` value is only wrong for sure when no type word contains it (Scryfall allows partial words)
export function isKnownType(value: string) {
    const v = value.toLowerCase()
    // a merged type (`ant`) is contained in real words (Giant, Instant) but still isn't a type;
    // none of the old words is a type today, so this doesn't need the lists to have loaded
    if (mergedType(v)) return false
    const types = allTypes()
    if (!types) return true
    return types.some((t) => t.toLowerCase().includes(v))
}
