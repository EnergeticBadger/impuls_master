// Plain-language filters that write Scryfall search syntax, so nobody has to remember `mv>=3` or `c<=wu`.

import { allTypes, creatureTypes, isKnownType, mergedType, singular, typeLabel } from './catalog'
import { blockSentence, blockToken, emptyBlock, roleLabel, type RuleBlock } from './rules'

// `token` is written as-is instead of `key:value`, for options that need other syntax (e.g. is:commander)
export type Option = { label: string, value: string, token?: string }

type Base = {
    id: string
    label: string
    hint: string
    // words someone might start typing to find this filter
    keywords: string[]
    // the Scryfall keys this filter writes; typing one (e.g. `c:`) jumps to it
    keys: string[]
}

export type Filter =
    // pick one or more from a list; several picks are joined with any-of / all-of
    | Base & { kind: 'choice', key: string, options: Option[], customPlaceholder?: string }
    // search Scryfall's full list of creature types and pick them like @-mentions
    | Base & { kind: 'creature', key: 't' }
    | Base & { kind: 'color', key: 'c' | 'id' }
    | Base & { kind: 'number', key: string, placeholder: string }
    | Base & { kind: 'text', key: string, placeholder: string, suggestions?: string[] }
    // what the card does: roles (otag:), ability blocks built from pieces, and exact words (o:)
    | Base & { kind: 'rules', key: 'o' }

export type Compare = '=' | '>=' | '<=' | '>' | '<'
export type Match = 'any' | 'all'
export type Join = 'and' | 'or'

export type Draft = {
    values: readonly string[]
    custom: string
    match: Match
    compare: Compare
    text: string
    exclude: boolean
    // color filters: pick the colors themselves, or just how many there are
    colorBy: 'colors' | 'count'
    // rules filter: one entry per ability being looked for
    blocks: readonly RuleBlock[]
}

export const emptyDraft = (filter: Filter): Draft => ({
    values: [],
    custom: '',
    // several things a card does usually means it should do all of them
    match: filter.kind === 'rules' ? 'all' : 'any',
    compare: filter.kind === 'color' ? (filter.key === 'id' ? '<=' : '>=') : filter.kind === 'number' ? '>=' : '=',
    text: '',
    exclude: false,
    colorBy: 'colors',
    // the ability builder starts with one empty ability, so its pieces are there to pick from
    blocks: filter.kind === 'rules' ? [emptyBlock()] : [],
})

export const COMPARE_WORDS: { value: Compare, label: string }[] = [
    { value: '=', label: 'exactly' },
    { value: '>=', label: 'at least' },
    { value: '<=', label: 'at most' },
    { value: '>', label: 'more than' },
    { value: '<', label: 'less than' },
]

export const COLORS: Option[] = [
    { label: 'White', value: 'w' },
    { label: 'Blue', value: 'u' },
    { label: 'Black', value: 'b' },
    { label: 'Red', value: 'r' },
    { label: 'Green', value: 'g' },
    { label: 'Colorless', value: 'c' },
]

// how the picked colors are compared, in words
export const COLOR_MODES: Record<'c' | 'id', { value: Compare, label: string }[]> = {
    c: [
        { value: '>=', label: 'includes these' },
        { value: '=', label: 'exactly these' },
        { value: '<=', label: 'only these (or fewer)' },
    ],
    id: [
        { value: '<=', label: 'fits in a deck of these colors' },
        { value: '=', label: 'exactly these' },
        { value: '>=', label: 'includes these' },
    ],
}

export const COLOR_COUNTS = ['0', '1', '2', '3', '4', '5']

const opts = (...values: string[]): Option[] =>
    values.map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v }))

export const FILTERS: Filter[] = [
    {
        id: 'type', kind: 'choice', key: 't', keys: ['t', 'type'],
        label: 'Card type', hint: 'Creature, instant, land, saga, equipment… search or browse all of them',
        keywords: ['type', 'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker', 'tribe', 'subtype'],
        options: opts('creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'legendary', 'equipment', 'aura', 'vehicle'),
    },
    {
        id: 'creature', kind: 'creature', key: 't', keys: ['t', 'type'],
        label: 'Creature type', hint: 'Dragon, Elf, Zombie… search or browse all of them',
        keywords: ['creature type', 'tribe', 'tribal', 'subtype', 'race', 'dragon', 'elf', 'goblin', 'zombie', 'human', 'wizard', 'angel', 'vampire'],
    },
    {
        id: 'legendary', kind: 'choice', key: 't', keys: ['is'],
        label: 'Legendary', hint: 'Legendary cards, or ones that can be your commander',
        keywords: ['legendary', 'legend', 'commander', 'general', 'unique'],
        options: [
            { label: 'Any legendary', value: 'legendary' },
            { label: 'Legendary creature', value: 'legendary creature', token: 't:legendary t:creature' },
            { label: 'Legendary planeswalker', value: 'legendary planeswalker', token: 't:legendary t:planeswalker' },
            { label: 'Can be your commander', value: 'commander', token: 'is:commander' },
        ],
    },
    {
        id: 'color', kind: 'color', key: 'c', keys: ['c', 'color', 'colors'],
        label: 'Color', hint: 'The colors of the card itself',
        keywords: ['color', 'colour', 'white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolor', 'mono', 'how many'],
    },
    {
        id: 'identity', kind: 'color', key: 'id', keys: ['id', 'identity', 'ci'],
        label: 'Commander colors', hint: 'Color identity: what fits in a Commander deck',
        keywords: ['commander', 'identity', 'edh', 'deck colors'],
    },
    {
        id: 'mv', kind: 'number', key: 'mv', keys: ['mv', 'cmc', 'manavalue'],
        label: 'Mana value', hint: 'Total mana cost, e.g. at most 3',
        keywords: ['mana', 'cost', 'cmc', 'mana value', 'cheap'],
        placeholder: '3',
    },
    {
        id: 'oracle', kind: 'rules', key: 'o', keys: ['o', 'oracle', 'otag', 'function'],
        label: 'What it does', hint: 'Removal, card draw… or build an ability like "when this enters, draw"',
        keywords: ['text', 'rules', 'oracle', 'ability', 'does', 'says', 'effect', 'trigger', 'when', 'whenever', 'removal', 'draw', 'ramp', 'role', 'function'],
    },
    {
        id: 'keyword', kind: 'text', key: 'kw', keys: ['kw', 'keyword'],
        label: 'Keyword ability', hint: 'Flying, trample, lifelink…',
        keywords: ['keyword', 'ability', 'flying', 'trample', 'haste'],
        placeholder: 'flying',
        suggestions: ['flying', 'trample', 'haste', 'lifelink', 'deathtouch', 'vigilance', 'first strike', 'double strike', 'reach', 'menace', 'hexproof', 'indestructible', 'flash', 'ward', 'defender', 'prowess', 'cycling', 'flashback', 'kicker', 'convoke'],
    },
    {
        id: 'name', kind: 'text', key: 'name', keys: ['name', 'n'],
        label: 'Name contains', hint: 'Part of the card name',
        keywords: ['name', 'called', 'title'],
        placeholder: 'dragon',
    },
    {
        id: 'power', kind: 'number', key: 'pow', keys: ['pow', 'power'],
        label: 'Power', hint: 'Creature attack strength',
        keywords: ['power', 'attack', 'strength', 'pow'],
        placeholder: '4',
    },
    {
        id: 'toughness', kind: 'number', key: 'tou', keys: ['tou', 'toughness'],
        label: 'Toughness', hint: 'Creature defense',
        keywords: ['toughness', 'defense', 'tou'],
        placeholder: '4',
    },
    {
        id: 'loyalty', kind: 'number', key: 'loy', keys: ['loy', 'loyalty'],
        label: 'Loyalty', hint: 'Planeswalker starting loyalty',
        keywords: ['loyalty', 'planeswalker'],
        placeholder: '3',
    },
    {
        id: 'rarity', kind: 'choice', key: 'r', keys: ['r', 'rarity'],
        label: 'Rarity', hint: 'Common, uncommon, rare, mythic',
        keywords: ['rarity', 'common', 'uncommon', 'rare', 'mythic'],
        options: opts('common', 'uncommon', 'rare', 'mythic'),
    },
    {
        id: 'format', kind: 'choice', key: 'f', keys: ['f', 'format', 'legal'],
        label: 'Legal in format', hint: 'Commander, Standard, Modern…',
        keywords: ['format', 'legal', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper', 'commander', 'edh'],
        options: opts('commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'brawl', 'historic', 'timeless'),
    },
    {
        id: 'price', kind: 'number', key: 'usd', keys: ['usd', 'price'],
        label: 'Price (USD)', hint: 'Cheapest printing, e.g. less than 1',
        keywords: ['price', 'cost', 'usd', 'dollar', 'budget', 'cheap'],
        placeholder: '1',
    },
    {
        id: 'year', kind: 'number', key: 'year', keys: ['year'],
        label: 'Year printed', hint: 'e.g. at least 2020',
        keywords: ['year', 'date', 'new', 'old', 'released'],
        placeholder: '2020',
    },
    {
        id: 'set', kind: 'text', key: 's', keys: ['s', 'set', 'e', 'edition'],
        label: 'Set code', hint: 'Three- to five-letter set code, e.g. neo',
        keywords: ['set', 'edition', 'expansion'],
        placeholder: 'neo',
    },
    {
        id: 'artist', kind: 'text', key: 'a', keys: ['a', 'artist'],
        label: 'Artist', hint: 'Who painted it',
        keywords: ['artist', 'art', 'illustrator', 'painter'],
        placeholder: 'Rebecca Guay',
    },
]

// the word currently being typed at the end of the search box
export function lastFragment(text: string) {
    return text.match(/(\S*)$/)![1]
}

// filters worth suggesting for what's being typed; syntax like `c:` or `mv>` jumps straight to its filter
export function matchFilters(fragment: string): Filter[] {
    const f = fragment.toLowerCase()
    if (!f) return FILTERS
    const key = f.replace(/^-/, '').match(/^([a-z]+)[:=<>!]/)?.[1]
    if (key) return FILTERS.filter((filter) => filter.keys.includes(key))
    if (/[^a-z]/.test(f)) return []
    return FILTERS.filter((filter) =>
        filter.label.toLowerCase().startsWith(f) || filter.keywords.some((k) => k.startsWith(f)) || filter.keys.includes(f))
}

const quote = (v: string) => /[\s()]/.test(v) ? `"${v.replace(/"/g, '')}"` : v.replace(/"/g, '')

// a `t:` value that isn't a type but whose singular is (dragons → dragon), or an old type that was merged
// into another (ants → insect); anything else is left alone
export function fixType(value: string) {
    if (isKnownType(value)) return value
    return (singular(value, allTypes()) ?? mergedType(value)?.type)?.toLowerCase() ?? value
}

// every picked value, including a typed-in extra one
function picked(filter: Filter, d: Draft) {
    let custom = d.custom.trim()
    if (custom && filter.key === 't') custom = fixType(custom)
    return filter.kind === 'choice' && custom && !d.values.includes(custom) ? [...d.values, custom] : d.values
}

// the Scryfall syntax for one filter, or '' while it's still incomplete
export function buildToken(filter: Filter, d: Draft): string {
    let token = ''
    switch (filter.kind) {
        case 'choice':
        case 'creature': {
            const options = filter.kind === 'choice' ? filter.options : []
            const parts = picked(filter, d).map((v) =>
                options.find((o) => o.value === v)?.token ?? `${filter.key}:${quote(v.toLowerCase())}`)
            // a multi-term option inside an OR needs its own brackets
            if (parts.length > 1) token = d.match === 'all' ? parts.join(' ') : `(${parts.map((p) => /\s/.test(p) ? `(${p})` : p).join(' or ')})`
            else token = parts[0] ?? ''
            break
        }
        case 'color':
            // a number instead of colors matches cards with that many colors, e.g. c>=2
            if (d.colorBy === 'count') {
                if (d.text !== '') token = `${filter.key}${d.compare}${d.text}`
                break
            }
            // colorless can't be "included"; for a card's own colors it only makes sense as exactly none
            if (d.values[0] === 'c' && filter.key === 'c') token = 'c=c'
            else if (d.values.length) token = `${filter.key}${d.compare}${d.values.join('')}`
            break
        case 'number':
            if (d.text.trim() !== '') token = `${filter.key}${d.compare}${d.text.trim()}`
            break
        case 'text':
            if (d.text.trim()) token = `${filter.key}:${quote(d.text.trim())}`
            break
        case 'rules': {
            const parts = [
                ...d.values.map((v) => `otag:${v}`),
                ...d.blocks.map(blockToken).filter(Boolean),
                ...(d.text.trim() ? [`o:${quote(d.text.trim())}`] : []),
            ]
            token = parts.length > 1 ? (d.match === 'all' ? parts.join(' ') : `(${parts.join(' or ')})`) : parts[0] ?? ''
            break
        }
    }
    if (!token || !d.exclude) return token
    // one term takes a leading minus; a group needs parentheses around it first
    const unquoted = token.replace(/"[^"]*"/g, '')
    return /\s/.test(unquoted) && !token.startsWith('(') ? `-(${token})` : `-${token}`
}

// the same filter as a sentence, so it's clear what the syntax means
export function describe(filter: Filter, d: Draft): string {
    const not = d.exclude ? 'NOT ' : ''
    const list = (values: string[], word: string) =>
        values.length > 1 ? values.slice(0, -1).join(', ') + ` ${word} ` + values.at(-1) : values[0]
    switch (filter.kind) {
        case 'choice':
        case 'creature': {
            const options = filter.kind === 'choice' ? filter.options : []
            const labels = picked(filter, d).map((v) => options.find((o) => o.value === v)?.label ?? (filter.key === 't' ? typeLabel(v) : v))
            return `${filter.label}: ${not}${list(labels, d.match === 'all' ? 'and' : 'or')}`
        }
        case 'color': {
            if (d.colorBy === 'count') {
                const word = COMPARE_WORDS.find((c) => c.value === d.compare)!.label
                return `${filter.label}: ${not}${word} ${d.text} ${d.text === '1' ? 'color' : 'colors'}`
            }
            const names = d.values.map((v) => COLORS.find((c) => c.value === v)!.label)
            const mode = COLOR_MODES[filter.key].find((m) => m.value === d.compare)!.label
            return `${filter.label}: ${not}${mode} — ${list(names, 'and')}`
        }
        case 'number': {
            const word = COMPARE_WORDS.find((c) => c.value === d.compare)!.label
            return `${filter.label} is ${not}${word} ${d.text.trim()}`
        }
        case 'text':
            return `${filter.label} ${d.exclude ? 'does not include' : 'includes'} “${d.text.trim()}”`
        case 'rules': {
            const said = [
                ...d.values.map(roleLabel),
                ...d.blocks.map(blockSentence).filter(Boolean),
                ...(d.text.trim() ? [`says “${d.text.trim()}”`] : []),
            ]
            // the pieces have commas of their own, so they're joined with a plain AND / OR
            return `${d.exclude ? "Doesn't do" : 'Does'}: ${said.join(d.match === 'all' ? ' AND ' : ' OR ')}`
        }
    }
}

// true when the whole string is one parenthesised group, e.g. `(a or b)` but not `(a) (b)`
function isGroup(q: string) {
    if (!q.startsWith('(') || !q.endsWith(')')) return false
    let depth = 0
    for (let i = 0; i < q.length; i++) {
        if (q[i] === '(') depth++
        else if (q[i] === ')' && --depth === 0 && i < q.length - 1) return false
    }
    return true
}

// add a filter to what's already in the box; OR means "everything so far, or this instead"
export function joinQuery(existing: string, token: string, join: Join) {
    const q = existing.trim()
    if (!q) return token
    if (join === 'and') return `${q} ${token}`
    return `${/\s/.test(q) && !isGroup(q) ? `(${q})` : q} or ${token}`
}

// ---- chips: each filter in the search box is kept as its own piece ----

// `join` is how this chip combines with everything before it; the first chip's is ignored.
// `filterId`/`draft` are there when the chip can be reopened in its filter's editor.
export type Chip = { id: number, token: string, join: Join, filterId?: string, draft?: Draft }

export const filterById = (id: string | undefined) => FILTERS.find((f) => f.id === id)

// the whole search: chips read left to right, then whatever is typed in the box
export function buildQuery(chips: readonly Pick<Chip, 'token' | 'join'>[], text: string) {
    let q = ''
    for (const c of chips) q = joinQuery(q, c.token, c.join)
    const t = text.trim()
    if (!t) return q
    // typed text with its own `or` keeps it to itself
    return joinQuery(q, /\bor\b/i.test(t) && q && !isGroup(t) ? `(${t})` : t, 'and')
}

// a chip's label in words, falling back to its syntax
export function chipLabel(chip: Pick<Chip, 'token' | 'filterId' | 'draft'>) {
    const filter = filterById(chip.filterId)
    return filter && chip.draft ? describe(filter, chip.draft) : chip.token
}

// true when quotes and brackets are all closed, so the term is finished being typed
export function isComplete(term: string) {
    if ((term.match(/"/g)?.length ?? 0) % 2) return false
    let depth = 0
    for (const ch of term) {
        if (ch === '(') depth++
        else if (ch === ')' && --depth < 0) return false
    }
    return depth === 0
}

const OPS = /^(-?)([a-z]+)(>=|<=|!=|:|=|>|<)(.+)$/i

// turn typed syntax like `t:elf`, `-mv>=3` or `c:rg` back into a filter, so it can be shown and edited as a chip
export function parseToken(term: string): { filter: Filter, draft: Draft } | null {
    const m = term.match(OPS)
    if (!m) return null
    const [, minus, rawKey, rawOp, rawValue] = m
    const key = rawKey.toLowerCase()
    const value = rawValue.replace(/^"(.*)"$/, '$1')
    if (!value || /["()]/.test(value) || rawOp === '!=') return null
    const exclude = minus === '-'
    const op = (rawOp === ':' ? '=' : rawOp) as Compare

    if (key === 'otag' || key === 'oracletag' || key === 'function') {
        if (rawOp !== ':') return null
        const filter = filterById('oracle')!
        return { filter, draft: { ...emptyDraft(filter), values: [value.toLowerCase()], exclude } }
    }

    if (key === 'is') {
        if (value.toLowerCase() !== 'commander' || rawOp !== ':') return null
        const filter = filterById('legendary')!
        return { filter, draft: { ...emptyDraft(filter), values: ['commander'], exclude } }
    }

    const filter = FILTERS.find((f) => f.keys.includes(key) && f.id !== 'legendary')
    if (!filter) return null
    const draft = { ...emptyDraft(filter), exclude }

    switch (filter.kind) {
        case 'choice':
        case 'creature': {
            if (rawOp !== ':' && rawOp !== '=') return null
            const v = value.toLowerCase()
            if (filter.key === 't') {
                // a creature type (or the plural of one, or an old type that was merged) opens in the creature type picker
                const creature = singular(v, creatureTypes()) ?? mergedType(v)?.type
                const fixed = fixType(v)
                // only when no other type contains the word as typed, since Scryfall would match that one too
                if (creature && creature.toLowerCase() === fixed) {
                    const c = filterById('creature')!
                    return { filter: c, draft: { ...emptyDraft(c), values: [creature], exclude } }
                }
                const typeFilter = filterById('type') as Filter & { kind: 'choice' }
                // a real type word is picked like the chips; anything else stays as typed
                const known = typeFilter.options.some((o) => o.value === fixed) || !!allTypes()?.some((t) => t.toLowerCase() === fixed)
                return { filter: typeFilter, draft: { ...draft, values: known ? [fixed] : [], custom: known ? '' : fixed } }
            }
            return { filter, draft: { ...draft, values: [v] } }
        }
        case 'color': {
            if (/^\d$/.test(value)) return { filter, draft: { ...draft, colorBy: 'count', compare: op, text: value } }
            const v = value.toLowerCase()
            if (!/^[wubrgc]+$/.test(v) || (v.includes('c') && v !== 'c')) return null
            // a bare `c:` means "includes", a bare `id:` means "fits in"
            const compare = rawOp === ':' ? emptyDraft(filter).compare : op
            return { filter, draft: { ...draft, values: v === 'c' ? ['c'] : [...new Set(v)], compare } }
        }
        case 'number':
            if (!/^\d+(\.\d+)?$/.test(value)) return null
            return { filter, draft: { ...draft, compare: op, text: value } }
        case 'text':
        case 'rules':
            // a hand-written regex stays as typed text
            if (rawOp !== ':' || value.startsWith('/')) return null
            return { filter, draft: { ...draft, text: value } }
    }
}

// top-level terms of typed text with where each starts; quoted phrases and bracketed groups stay whole
export function splitTerms(text: string): { term: string, start: number }[] {
    const terms: { term: string, start: number }[] = []
    let start = -1, depth = 0, quoted = false
    for (let i = 0; i <= text.length; i++) {
        const ch = text[i]
        const split = ch === undefined || (/\s/.test(ch) && !quoted && depth <= 0)
        if (split) {
            if (start >= 0) terms.push({ term: text.slice(start, i), start })
            start = -1
            continue
        }
        if (start < 0) start = i
        if (ch === '"') quoted = !quoted
        else if (!quoted && ch === '(') depth++
        else if (!quoted && ch === ')') depth--
    }
    return terms
}
