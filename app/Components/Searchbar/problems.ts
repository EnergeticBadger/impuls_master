// Works out why a search found nothing. Only reports what's certainly wrong; "too specific" is left to the pop-up's counts.

import { allTypes, creatureTypes, isKnownType, singular } from './catalog'
import { buildToken, chipLabel, emptyDraft, filterById, type Chip, type Compare, type Draft } from './filters'
import { chipId, querybox } from '../Context/query'

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

export function findProblems(chips: readonly Chip[], text: string, warnings: readonly string[]): Problem[] {
    const found: Problem[] = warnings.map((w) => ({ text: `Scryfall couldn't read part of your search: ${w}` }))

    // types that don't exist; a plural of a real one gets a one-click fix
    for (const chip of chips) {
        const filter = filterById(chip.filterId)
        if (!filter || !chip.draft || filter.key !== 't') continue
        const d = chip.draft
        for (const v of [...d.values, ...(d.custom.trim() ? [d.custom.trim()] : [])]) {
            const opt = filter.kind === 'choice' ? filter.options.find((o) => o.value === v) : undefined
            if (opt?.token || isKnownType(v)) continue
            const fixed = singular(v, allTypes())
            const swap = (x: string) => x === v ? fixed!.toLowerCase() : x
            found.push(fixed
                ? {
                    text: `“${v}” isn't a type. Types are always singular, so you probably meant ${fixed}.`,
                    fix: { label: `Use ${fixed}`, apply: () => redraft(chip.id, { values: d.values.map(swap), custom: d.custom.trim() === v ? fixed.toLowerCase() : d.custom }) },
                }
                : { text: `“${v}” isn't a card type or subtype, so no card can match it.`, fix: { label: `Remove “${chipLabel(chip)}”`, apply: () => removeChip(chip.id) } })
        }
    }

    // a plain word only searches card names; one that's a creature type probably meant the type
    if (!/[:<>=()"]/.test(text)) {
        const creature = creatureTypes()
        for (const word of text.trim().split(/\s+/).filter(Boolean)) {
            const type = singular(word, creature)
            if (!type) continue
            found.push({
                text: `Words typed on their own only search card names, and no card name has “${word}”. Looking for ${type} cards?`,
                fix: {
                    label: `Search ${type} cards instead`,
                    apply: () => {
                        const filter = filterById('creature')!
                        const d = { ...emptyDraft(filter), values: [type] }
                        querybox.text = text.split(/\s+/).filter((w) => w && w !== word).join(' ')
                        querybox.chips.push({ id: chipId(), token: buildToken(filter, d), join: 'and', filterId: filter.id, draft: d })
                    },
                },
            })
        }
    }

    // filters that can't both be true; only checked when everything is joined with AND, where that's certain
    if (!chips.some((c, i) => i > 0 && c.join === 'or') && !/\bor\b/i.test(text)) {
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
