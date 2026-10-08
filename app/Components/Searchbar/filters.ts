// Plain-language filters that write Scryfall search syntax, so nobody has to remember `mv>=3` or `c<=wu`.

import { allTypes, creatureTypes, isKnownType, keywordLabel, mergedType, singular, typeLabel } from './catalog'
import { mechanicByToken, mechanicByValue } from './mechanics'
import { blockSentence, blockToken, emptyBlock, readBlock, roleLabel, type RuleBlock } from './rules'

// `token` is written as-is instead of `key:value`, for options that need other syntax (e.g. is:commander)
export type Option = { label: string, value: string, token?: string }

// the headings the filter list is grouped under, in the order they're shown
export const FILTER_GROUPS = ['Card', 'Rules text', 'Stats', 'Printing', 'Advanced'] as const

type Base = {
    id: string
    group: typeof FILTER_GROUPS[number]
    label: string
    hint: string
    // the Scryfall keys this filter writes; syntax read from an address with one (e.g. `c:red`) becomes this filter's chip
    keys: string[]
}

export type Filter =
    // pick one or more from a list; several picks are joined with any-of / all-of
    | Base & { kind: 'choice', key: string, options: Option[], customPlaceholder?: string }
    // search Scryfall's full list of creature types and pick them like @-mentions
    | Base & { kind: 'creature', key: 't' }
    // search every keyword ability, keyword action and ability word, and pick several
    | Base & { kind: 'keyword', key: 'kw', common: string[] }
    | Base & { kind: 'color', key: 'c' | 'id' }
    | Base & { kind: 'number', key: string, placeholder: string }
    | Base & { kind: 'text', key: string, placeholder: string, suggestions?: string[] }
    // what the card does: roles (otag:), ability blocks built from pieces, and exact words (o:)
    | Base & { kind: 'rules', key: 'o' }
    // Scryfall syntax written by hand, for whatever the other filters don't cover
    | Base & { kind: 'query', placeholder: string }

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
        { value: '<=', label: 'fits a deck of these colors' },
        { value: '=', label: 'exactly these' },
        { value: '>=', label: 'includes these' },
    ],
}

export const COLOR_COUNTS = ['0', '1', '2', '3', '4', '5']

// each comparison's opposite, for a number filter that's left out
const OPPOSITE: Record<Compare, string> = { '=': '!=', '>=': '<', '<=': '>', '>': '<=', '<': '>=' }

// the words before the dash on a type line: what kind of card it is, and the supertypes that go in front
export const CARD_TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'kindred']
export const SUPERTYPES = ['legendary', 'basic', 'snow']

const opts = (...values: string[]): Option[] =>
    values.map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v }))

export const FILTERS: Filter[] = [
    // first, now that there's no search box to type a name into
    {
        id: 'name', group: 'Card', kind: 'text', key: 'name', keys: ['name', 'n'],
        label: 'Name contains', hint: 'Part of the card name',
        placeholder: 'e.g. dragon',
    },
    {
        id: 'type', group: 'Card', kind: 'choice', key: 't', keys: ['t', 'type'],
        label: 'Card type', hint: 'Creature, artifact, legendary… and subtypes like Saga, Equipment or Elf',
        // the types and supertypes the picker shows up top, then subtypes known even before the lists load
        options: opts(...CARD_TYPES, ...SUPERTYPES, 'equipment', 'aura', 'vehicle'),
    },
    {
        id: 'creature', group: 'Card', kind: 'creature', key: 't', keys: ['t', 'type'],
        label: 'Creature type', hint: 'Dragon, Elf, Zombie… search or browse all of them',
    },
    {
        id: 'legendary', group: 'Card', kind: 'choice', key: 't', keys: ['is'],
        label: 'Legendary', hint: 'Legendary cards, or ones that can be your commander',
        options: [
            { label: 'Any legendary', value: 'legendary' },
            { label: 'Legendary creature', value: 'legendary creature', token: 't:legendary t:creature' },
            { label: 'Legendary planeswalker', value: 'legendary planeswalker', token: 't:legendary t:planeswalker' },
            { label: 'Can be your commander', value: 'commander', token: 'is:commander' },
        ],
    },
    // Color and color identity side by side, each hint saying where its colors come from, so the difference
    // (a card's text can add to its identity) is learned from the list itself
    {
        id: 'color', group: 'Card', kind: 'color', key: 'c', keys: ['c', 'color', 'colors'],
        label: 'Color', hint: 'Colors in its mana cost',
    },
    {
        id: 'identity', group: 'Card', kind: 'color', key: 'id', keys: ['id', 'identity', 'ci'],
        label: 'Color identity', hint: 'Cost and text symbols, as Commander counts',
    },
    {
        id: 'oracle', group: 'Rules text', kind: 'rules', key: 'o', keys: ['o', 'oracle', 'otag', 'function'],
        label: 'What it does', hint: 'Removal, card draw… or build an ability like "when this enters, draw"',
    },
    {
        id: 'keyword', group: 'Rules text', kind: 'keyword', key: 'kw', keys: ['kw', 'keyword'],
        label: 'Keyword', hint: 'Flying, trample, scry, landfall, devotion… pick one or several',
        common: ['flying', 'trample', 'haste', 'lifelink', 'deathtouch', 'vigilance', 'first strike', 'double strike', 'reach', 'menace', 'hexproof', 'indestructible', 'flash', 'ward', 'defender', 'prowess', 'scry', 'cycling', 'flashback', 'landfall'],
    },
    {
        id: 'mv', group: 'Stats', kind: 'number', key: 'mv', keys: ['mv', 'cmc', 'manavalue'],
        label: 'Mana value', hint: 'Total mana cost, e.g. at most 3',
        placeholder: 'e.g. 3',
    },
    {
        id: 'power', group: 'Stats', kind: 'number', key: 'pow', keys: ['pow', 'power'],
        label: 'Power', hint: 'Creature attack strength',
        placeholder: 'e.g. 4',
    },
    {
        id: 'toughness', group: 'Stats', kind: 'number', key: 'tou', keys: ['tou', 'toughness'],
        label: 'Toughness', hint: 'Creature defense',
        placeholder: 'e.g. 4',
    },
    {
        id: 'loyalty', group: 'Stats', kind: 'number', key: 'loy', keys: ['loy', 'loyalty'],
        label: 'Loyalty', hint: 'Planeswalker starting loyalty',
        placeholder: 'e.g. 3',
    },
    {
        id: 'rarity', group: 'Printing', kind: 'choice', key: 'r', keys: ['r', 'rarity'],
        label: 'Rarity', hint: 'Common, uncommon, rare, mythic',
        options: opts('common', 'uncommon', 'rare', 'mythic'),
    },
    {
        id: 'format', group: 'Printing', kind: 'choice', key: 'f', keys: ['f', 'format', 'legal'],
        label: 'Legal in format', hint: 'Commander, Standard, Modern…',
        options: opts('commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'brawl', 'historic', 'timeless'),
    },
    {
        id: 'price', group: 'Printing', kind: 'number', key: 'usd', keys: ['usd', 'price'],
        label: 'Price (USD)', hint: 'Cheapest printing, e.g. less than 1',
        placeholder: 'e.g. 1',
    },
    {
        id: 'year', group: 'Printing', kind: 'number', key: 'year', keys: ['year'],
        label: 'Year printed', hint: 'e.g. at least 2020',
        placeholder: 'e.g. 2020',
    },
    {
        id: 'set', group: 'Printing', kind: 'text', key: 's', keys: ['s', 'set', 'e', 'edition'],
        label: 'Set code', hint: 'Three- to five-letter set code, e.g. neo',
        placeholder: 'e.g. neo',
    },
    {
        id: 'artist', group: 'Printing', kind: 'text', key: 'a', keys: ['a', 'artist'],
        label: 'Artist', hint: 'Who painted it',
        placeholder: 'e.g. Rebecca Guay',
    },
    {
        id: 'custom', group: 'Advanced', kind: 'query', keys: [],
        label: 'Custom query', hint: 'Write Scryfall syntax yourself, e.g. t:elf (o:draw or o:scry)',
        placeholder: 'e.g. t:elf (o:draw or o:scry) mv<=3',
    },
]

const quote = (v: string) => /[\s()]/.test(v) ? `"${v.replace(/"/g, '')}"` : v.replace(/"/g, '')

// a custom query written over several lines reads as one
const oneLine = (v: string) => v.trim().replace(/\s*\n\s*/g, ' ')

// a `t:` value that isn't a type but whose singular is (dragons → dragon), or an old type that was merged
// into another (ants → insect); anything else is left alone
export function fixType(value: string) {
    if (isKnownType(value)) return value
    return (singular(value, allTypes()) ?? mergedType(value)?.type)?.toLowerCase() ?? value
}

// every picked value, including a typed-in extra one
function picked(filter: Filter, d: Draft) {
    if (filter.kind !== 'choice') return d.values
    let custom = d.custom.trim()
    if (custom && filter.key === 't') custom = fixType(custom)
    return custom && !d.values.includes(custom) ? [...d.values, custom] : d.values
}

// how many separate things a filter has picked; with two or more a card can match any, all or none of them
export function pickCount(filter: Filter, d: Draft) {
    switch (filter.kind) {
        case 'choice':
        case 'creature':
        case 'keyword':
            return picked(filter, d).length
        case 'rules':
            return d.values.length + d.blocks.filter((b) => blockToken(b)).length + (d.text.trim() ? 1 : 0)
        default:
            return 1
    }
}

// the Scryfall syntax for one filter, or '' while it's still incomplete
export function buildToken(filter: Filter, d: Draft): string {
    let token = ''
    switch (filter.kind) {
        case 'choice':
        case 'creature':
        case 'keyword': {
            const options = filter.kind === 'choice' ? filter.options : []
            // a mechanic isn't a Scryfall keyword (kw:devotion finds nothing), so it writes its own search
            const parts = picked(filter, d).map((v) =>
                options.find((o) => o.value === v)?.token
                ?? (filter.kind === 'keyword' ? mechanicByValue(v)?.token : undefined)
                ?? `${filter.key}:${quote(v.toLowerCase())}`)
            // a multi-term option inside an OR needs its own brackets
            if (parts.length > 1) token = d.match === 'all' ? parts.join(' ') : `(${parts.map((p) => isCompound(p) && !isGroup(p) ? `(${p})` : p).join(' or ')})`
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
            if (d.text.trim() === '') break
            // left out, it's the opposite comparison: Scryfall drops -mv>=3 as an unknown key "-mv", so the
            // filter would do nothing
            if (d.exclude) return `${filter.key}${OPPOSITE[d.compare]}${d.text.trim()}`
            token = `${filter.key}${d.compare}${d.text.trim()}`
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
        case 'query':
            token = oneLine(d.text)
            break
    }
    if (!token || !d.exclude) return token
    // one term takes a leading minus; several need parentheses around them first
    return isCompound(token) && !isGroup(token) ? `-(${token})` : `-${token}`
}

// the same filter as a sentence, so it's clear what the syntax means
export function describe(filter: Filter, d: Draft): string {
    const not = d.exclude ? 'NOT ' : ''
    const list = (values: string[], word: string) =>
        values.length > 1 ? values.slice(0, -1).join(', ') + ` ${word} ` + values.at(-1) : values[0]
    switch (filter.kind) {
        case 'choice':
        case 'creature':
        case 'keyword': {
            const options = filter.kind === 'choice' ? filter.options : []
            const labels = picked(filter, d).map((v) => options.find((o) => o.value === v)?.label
                ?? (filter.key === 't' ? typeLabel(v) : filter.kind === 'keyword' ? keywordLabel(v) : v))
            // several left out means none of them may be on the card
            if (d.exclude && labels.length > 1) return `${filter.label}: none of ${labels.join(', ')}`
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
        case 'query':
            return `${filter.label}: ${not}${oneLine(d.text)}`
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

// more than one term side by side, e.g. `t:elf c:g` or `t:elf or t:goblin`, but not `(a or b)` or `name:"two words"`
const isCompound = (q: string) => splitTerms(q).length > 1

// add a filter to what's already in the search, so chips read left to right: OR means "everything so far, or
// this instead", AND "everything so far, and this too"
export function joinQuery(existing: string, token: string, join: Join) {
    const q = existing.trim()
    if (!q) return token
    // AND binds tighter than OR, so an OR so far is bracketed first: `a or b` and c is `(a or b) c`, not a or (b c)
    if (join === 'and') return `${hasOr(q) ? `(${q})` : q} ${token}`
    // several terms (a custom query, say) stay together on the right of the OR, as they do on the left
    return `${/\s/.test(q) && !isGroup(q) ? `(${q})` : q} or ${isCompound(token) && !isGroup(token) ? `(${token})` : token}`
}

// ---- chips: each filter in the search is kept as its own piece ----

// `join` is how this chip combines with everything before it; the first chip's is ignored.
// `filterId`/`draft` are there when the chip can be reopened in its filter's editor.
export type Chip = { id: number, token: string, join: Join, filterId?: string, draft?: Draft }

export const filterById = (id: string | undefined) => FILTERS.find((f) => f.id === id)

// the whole search: chips read left to right
export function buildQuery(chips: readonly Pick<Chip, 'token' | 'join'>[]) {
    let q = ''
    for (const c of chips) {
        // a custom query with its own `or` keeps it to itself, wherever it sits among the others
        const own = chips.length > 1 && splitTerms(c.token).some((t) => isOr(t.term)) && !isGroup(c.token)
        q = joinQuery(q, own ? `(${c.token})` : c.token, c.join)
    }
    return q
}

// hand-written syntax as a Custom query chip
export function customChip(text: string, join: Join = 'and'): Omit<Chip, 'id'> {
    const filter = filterById('custom')!
    const draft = { ...emptyDraft(filter), text: text.trim() }
    return { token: buildToken(filter, draft), join, filterId: filter.id, draft }
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
    // one of our mechanics' searches, before its o:"…" or o:/…/ is read as rules text
    const mechanic = mechanicByToken(term)
    if (mechanic) {
        const filter = filterById('keyword')!
        return { filter, draft: { ...emptyDraft(filter), values: [mechanic.mechanic.value], exclude: mechanic.exclude } }
    }

    // a regex the "What it does" filter wrote goes back into its ability
    const block = term.includes('o:/') ? readBlock(term.replace(/^-/, '')) : null
    if (block) {
        const filter = filterById('oracle')!
        return { filter, draft: { ...emptyDraft(filter), blocks: [block], exclude: term.startsWith('-') } }
    }

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
                // a word that isn't a type stays as plain text, where the note under the box points it out
                if (!known && allTypes()) return null
                return { filter: typeFilter, draft: { ...draft, values: known ? [fixed] : [], custom: known ? '' : fixed } }
            }
            return { filter, draft: { ...draft, values: [v] } }
        }
        case 'keyword':
            if (rawOp !== ':' && rawOp !== '=') return null
            return { filter, draft: { ...draft, values: [value.toLowerCase()] } }
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
        case 'query':
            return null
    }
}

// top-level terms of typed text with where each starts; quoted phrases, regexes and bracketed groups stay whole
export function splitTerms(text: string): { term: string, start: number }[] {
    const terms: { term: string, start: number }[] = []
    let start = -1, depth = 0, quoted = false, regex = false
    for (let i = 0; i <= text.length; i++) {
        const ch = text[i]
        // a regex's spaces and brackets are its own, up to the closing slash
        if (regex && ch !== undefined) {
            if (ch === '\\') i++
            else if (ch === '/') regex = false
            continue
        }
        const split = ch === undefined || (/\s/.test(ch) && !quoted && depth <= 0)
        if (split) {
            if (start >= 0) terms.push({ term: text.slice(start, i), start })
            start = -1
            continue
        }
        if (start < 0) start = i
        if (ch === '/' && !quoted && /[:=]$/.test(text.slice(0, i))) regex = true
        else if (ch === '"') quoted = !quoted
        else if (!quoted && ch === '(') depth++
        else if (!quoted && ch === ')') depth--
    }
    return terms
}

const isOr = (term: string) => /^or$/i.test(term)
// an `or` outside any brackets
const hasOr = (q: string) => splitTerms(q).some((t) => isOr(t.term))
// the terms inside a bracketed group
const inside = (group: string) => splitTerms(group.slice(1, -1)).map((t) => t.term)

// The reverse of buildQuery, for a search read back from the address: as much as possible goes back into chips
// and the rest becomes Custom query chips. Either way it searches the same cards.
export function parseQuery(q: string): Omit<Chip, 'id'>[] {
    const terms = splitTerms(q).map((t) => t.term)
    for (let n = terms.length; n > 0; n--) {
        const rest = terms.slice(n)
        // the rest is ANDed onto the chips, so an `or` in either would change what it means: buildQuery would
        // bracket the chips first. A search written before chips read left to right (`a or b c`) stays whole
        if (rest.length && terms.slice(0, n).some(isOr)) continue
        if (rest.some(isOr)) continue
        const chips = toChips(terms.slice(0, n))
        if (chips) return [...chips, ...rest.map((t) => ({ ...termChip(t), join: 'and' as const }))]
    }
    return q.trim() ? [customChip(q)] : []
}

// one term as its filter's chip, or as a Custom query of its own when it isn't one
function termChip(term: string): Omit<Chip, 'id' | 'join'> {
    const parsed = parseToken(term)
    if (!parsed) return customChip(term)
    return { token: buildToken(parsed.filter, parsed.draft), filterId: parsed.filter.id, draft: parsed.draft }
}

// terms the way buildQuery writes chips, back into chips; null if they aren't
function toChips(terms: string[]): Omit<Chip, 'id'>[] | null {
    const last = terms.at(-1)
    if (!last) return null
    if (terms.length === 1) {
        // `(a or b)` on its own: chips joined with OR, bracketed because an AND came after them
        const grouped = !parseToken(last) && isGroup(last) && hasOr(last.slice(1, -1)) ? toChips(inside(last)) : null
        return grouped ?? [{ ...termChip(last), join: 'and' }]
    }
    const chip = termChip(last)
    if (isOr(terms.at(-2)!)) {
        // `a or b`, or `(a b) or c`: everything before the `or` was bracketed if it was more than one term
        if (terms.length !== 3) return null
        const before = isGroup(terms[0]) && !parseToken(terms[0]) ? toChips(inside(terms[0])) : toChips([terms[0]])
        return before && [...before, { ...chip, join: 'or' }]
    }
    // before an AND there's no bare `or`: buildQuery brackets one
    const rest = terms.slice(0, -1)
    if (rest.some(isOr)) return null
    const before = toChips(rest)
    return before && [...before, { ...chip, join: 'and' }]
}
