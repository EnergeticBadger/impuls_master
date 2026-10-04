// Works out why a search found nothing. Only reports what's certainly wrong; "too specific" is left to the pop-up's counts.

import { allTypes, creatureTypes, isKnownType, mergedNote, mergedType, singular } from './catalog'
import { buildToken, chipLabel, emptyDraft, filterById, splitTerms, type Chip, type Compare, type Draft } from './filters'
import { querybox } from '../Context/query'

export type Problem = { text: string, fix?: { label: string, apply: () => void } }

// replace one chip's draft and rebuild its search syntax
function redraft(id: number, patch: Partial<Draft>) {
    const chip = querybox.chips.find((c) => c.id === id)
    const filter = filterById(chip?.filterId)
    if (!chip?.draft || !filter) return
    chip.draft = { ...chip.draft, ...patch }
    chip.token = buildToken(filter, chip.draft)
}

const removeChip = (id: number) => {
    const i = querybox.chips.findIndex((c) => c.id === id)
    if (i >= 0) querybox.chips.splice(i, 1)
}

// the numbers a comparison allows, as [low, high] with whether each end is included
function range(op: Compare, n: number): [number, boolean, number, boolean] {
    switch (op) {
        case '=': return [n, true, n, true]
        case '>=': return [n, true, Infinity, false]
        case '>': return [n, false, Infinity, false]
        case '<=': return [-Infinity, false, n, true]
        case '<': return [-Infinity, false, n, false]
    }
}

function overlap(a: [number, boolean, number, boolean], b: [number, boolean, number, boolean]) {
    const lo = Math.max(a[0], b[0]), hi = Math.min(a[2], b[2])
    if (lo < hi) return true
    if (lo > hi) return false
    // touching ends only count when both sides include that number
    const loIn = a[0] === lo ? a[1] : true, loIn2 = b[0] === lo ? b[1] : true
    const hiIn = a[2] === hi ? a[3] : true, hiIn2 = b[2] === hi ? b[3] : true
    return loIn && loIn2 && hiIn && hiIn2
}

// a comparable number a chip pins down, if any: mana value, power, color count…
function numeric(chip: Chip): { key: string, span: [number, boolean, number, boolean] } | null {
    const filter = filterById(chip.filterId)
    const d = chip.draft
    if (!filter || !d || d.exclude) return null
    if (filter.kind === 'number' && d.text.trim() !== '') return { key: filter.key, span: range(d.compare, Number(d.text)) }
    if (filter.kind === 'color' && d.colorBy === 'count' && d.text !== '') return { key: `${filter.key}#`, span: range(d.compare, Number(d.text)) }
    // exactly these colors also fixes how many there are
    if (filter.kind === 'color' && d.colorBy === 'colors' && d.compare === '=' && d.values.length) {
        const n = d.values[0] === 'c' ? 0 : d.values.length
        return { key: `${filter.key}#`, span: [n, true, n, true] }
    }
    return null
}

export function findProblems(chips: readonly Chip[], warnings: readonly string[]): Problem[] {
    const found: Problem[] = warnings.map((w) => ({ text: `Scryfall couldn't read part of your search: ${w}` }))

    // types that don't exist; a plural of a real one gets a one-click fix
    for (const chip of chips) {
        const filter = filterById(chip.filterId)
        if (!filter || !chip.draft || filter.kind === 'query' || filter.key !== 't') continue
        const d = chip.draft
        for (const v of [...d.values, ...(d.custom.trim() ? [d.custom.trim()] : [])]) {
            const opt = filter.kind === 'choice' ? filter.options.find((o) => o.value === v) : undefined
            if (opt?.token || isKnownType(v)) continue
            const merged = mergedType(v)
            const fixed = singular(v, allTypes()) ?? merged?.type
            const swap = (x: string) => x === v ? fixed!.toLowerCase() : x
            found.push(fixed
                ? {
                    text: merged && merged.type === fixed ? mergedNote(merged) : `“${v}” isn't a type. Types are always singular, so you probably meant ${fixed}.`,
                    fix: { label: `Use ${fixed}`, apply: () => redraft(chip.id, { values: d.values.map(swap), custom: d.custom.trim() === v ? fixed.toLowerCase() : d.custom }) },
                }
                : { text: `“${v}” isn't a card type or subtype, so no card can match it.`, fix: { label: `Remove “${chipLabel(chip)}”`, apply: () => removeChip(chip.id) } })
        }
    }

    // what's written in custom queries, the ones that have to match
    const custom = chips.filter((c) => c.filterId === 'custom' && c.draft && !c.draft.exclude)

    // a written t:word that isn't a type
    for (const chip of custom) {
        for (const [, word] of chip.draft!.text.matchAll(/(?:^|\s)-?t(?:ype)?[:=]"?([\w'-]+)/gi)) {
            if (allTypes() && !isKnownType(word) && !singular(word, allTypes()) && !mergedType(word)) {
                found.push({ text: `“${word}” isn't a card type or subtype, so no card can match it. Browse the Card type filter for the full list.` })
            }
        }
    }

    // a plain word only searches card names; one that's a creature type probably meant the type
    for (const chip of custom) {
        const text = chip.draft!.text
        if (/[:<>=()"]/.test(text)) continue
        const creature = creatureTypes()
        const words = text.trim().split(/\s+/).filter(Boolean)
        for (const word of words) {
            const merged = creature && !singular(word, creature) ? mergedType(word) : undefined
            const type = singular(word, creature) ?? merged?.type
            if (!type) continue
            found.push({
                text: `Words on their own only search card names, and no card name has “${word}”. Looking for ${type} cards?${merged ? ` ${mergedNote(merged)}` : ''}`,
                fix: {
                    label: `Search ${type} cards instead`,
                    apply: () => {
                        // the word on its own becomes a Creature type chip in its place; among other words it's
                        // written as the type, so the query keeps its shape
                        if (words.length > 1) return redraft(chip.id, { text: words.map((w) => w === word ? `t:${type.toLowerCase()}` : w).join(' ') })
                        const target = querybox.chips.find((c) => c.id === chip.id)
                        const filter = filterById('creature')!
                        const d = { ...emptyDraft(filter), values: [type] }
                        if (target) Object.assign(target, { token: buildToken(filter, d), filterId: filter.id, draft: d })
                    },
                },
            })
        }
    }

    // filters that can't both be true; only checked when everything is joined with AND, where that's certain
    if (!chips.some((c, i) => i > 0 && c.join === 'or')) {
        const seen: { chip: Chip, key: string, span: [number, boolean, number, boolean] }[] = []
        for (const chip of chips) {
            const n = numeric(chip)
            if (!n) continue
            const clash = seen.find((s) => s.key === n.key && !overlap(s.span, n.span))
            if (clash) found.push({ text: `“${chipLabel(clash.chip)}” and “${chipLabel(chip)}” can't both be true, so no card matches.` })
            seen.push({ chip, ...n })
        }
        // the same filter both wanted and ruled out
        for (const chip of chips) {
            const opposite = chips.find((c) => c.token === `-${chip.token}`)
            if (opposite) found.push({ text: `“${chipLabel(chip)}” and “${chipLabel(opposite)}” cancel each other out.` })
        }
    }
    return found
}

// every value `inner` allows, `outer` allows too
function within(inner: [number, boolean, number, boolean], outer: [number, boolean, number, boolean]) {
    const lowOk = inner[0] > outer[0] || (inner[0] === outer[0] && (outer[1] || !inner[1]))
    const highOk = inner[2] < outer[2] || (inner[2] === outer[2] && (outer[3] || !inner[3]))
    return lowOk && highOk
}

// a chip that only pins down a number, so dropping it loses nothing another chip doesn't already say
function onlyNumber(chip: Chip) {
    const filter = filterById(chip.filterId)
    return filter?.kind === 'number' || (filter?.kind === 'color' && chip.draft?.colorBy === 'count')
}

const termsOf = (s: string) => splitTerms(s).map((t) => t.term.toLowerCase())

// the terms a card must match for a chip; none for a custom query with its own `or`, which requires none of them
const required = (s: string) => {
    const terms = termsOf(s)
    return terms.includes('or') ? [] : terms
}

// the choices of an "any of" chip, e.g. (t:creature or t:elf) gives [[t:creature], [t:elf]]; null for anything else
function optionsOf(token: string): string[][] | null {
    const group = /^\((.*)\)$/s.exec(token.trim())
    if (!group) return null
    const parts = splitTerms(group[1])
    if (!parts.some((p) => p.term.toLowerCase() === 'or')) return null
    const options: string[][] = [[]]
    for (const { term } of parts) {
        if (term.toLowerCase() === 'or') options.push([])
        else options[options.length - 1].push(...termsOf(term.replace(/^\((.*)\)$/s, '$1')))
    }
    return options.every((o) => o.length) ? options : null
}

// A simpler search that finds the same cards: repeated filters, and ones another filter already covers.
// Only when everything is joined with AND, where that's certain.
export type Tidy = { reasons: string[], removeIds: number[] }

export function findRedundant(chips: readonly Chip[]): Tidy | null {
    if (chips.some((c, i) => i > 0 && c.join === 'or')) return null
    const reasons: string[] = []
    const removed = new Set<number>()
    const kept = () => chips.filter((c) => !removed.has(c.id))

    // from the last chip back, so of two copies the first one stays
    for (const chip of [...chips].reverse()) {
        const mine = termsOf(chip.token)
        const same = kept().find((c) => c.id !== chip.id && c.token.toLowerCase() === chip.token.toLowerCase())
        const wider = same ? undefined : kept().find((c) => {
            if (c.id === chip.id) return false
            const theirs = required(c.token)
            return mine.every((t) => theirs.includes(t))
        })
        if (same) reasons.push(`“${chipLabel(chip)}” is in your search twice.`)
        else if (wider) reasons.push(`“${chipLabel(chip)}” is already part of “${chipLabel(wider)}”.`)
        else continue
        removed.add(chip.id)
    }

    // an "any of" chip another chip already settles, e.g. "Creature or Elf" next to "Elf": every Elf matches it anyway
    for (const chip of chips) {
        if (removed.has(chip.id)) continue
        const options = optionsOf(chip.token)
        if (!options) continue
        const settles = kept().find((c) => {
            if (c.id === chip.id) return false
            const theirs = required(c.token)
            return options.some((o) => o.every((t) => theirs.includes(t)))
        })
        if (!settles) continue
        reasons.push(`Every card with “${chipLabel(settles)}” already matches “${chipLabel(chip)}”, so that one can go.`)
        removed.add(chip.id)
    }

    // a looser number than another chip on the same thing, e.g. mana value 2+ next to mana value 4+
    for (const chip of chips) {
        if (removed.has(chip.id) || !onlyNumber(chip)) continue
        const n = numeric(chip)
        if (!n) continue
        const tighter = kept().find((c) => {
            if (c.id === chip.id) return false
            const m = numeric(c)
            return m?.key === n.key && within(m.span, n.span)
        })
        if (!tighter) continue
        reasons.push(`“${chipLabel(tighter)}” already covers “${chipLabel(chip)}”, so that one can go.`)
        removed.add(chip.id)
    }

    return reasons.length ? { reasons, removeIds: [...removed] } : null
}
