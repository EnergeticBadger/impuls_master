import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import styles from './SimpleSearch.module.css'
import { buildToken, chipLabel, COLORS, emptyDraft, filterById, parseQuery, splitTerms, type Chip, type Draft, type Filter } from './filters'
import { chipId, querybox } from '../Context/query'
import { searchMode } from '../Context/mode'
import { Arrow } from '../Arrow/Arrow'

// the types and mana values offered as one pick each; anything else stays an Advanced chip
const TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle']
const MANA_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7+']
const FORMATS = (filterById('format') as Filter & { kind: 'choice' }).options

const cap = (v: string) => v[0].toUpperCase() + v.slice(1)

// The parts of the search Simple mode has a control for, each holding a draft for its Advanced filter
type Part = 'name' | 'color' | 'type' | 'mv' | 'format'

// whether a chip is one Simple mode can show: a name, colors the card includes, one type, one mana value
// (or 7+), one format, none of them left out
function partOf(chip: Chip): Part | null {
    const d = chip.draft
    if (!d || d.exclude) return null
    switch (chip.filterId) {
        case 'name':
            return 'name'
        case 'color':
            return d.colorBy === 'colors' && (d.compare === '>=' || d.values.join('') === 'c') ? 'color' : null
        case 'type':
            return d.values.length === 1 && !d.custom.trim() && TYPES.includes(d.values[0]) ? 'type' : null
        case 'mv':
            return (d.compare === '=' && /^[0-6]$/.test(d.text)) || (d.compare === '>=' && d.text === '7') ? 'mv' : null
        case 'format':
            return d.values.length === 1 && !d.custom.trim() ? 'format' : null
        default:
            return null
    }
}

// the search split into Simple mode's parts and the rest, which it shows as chips it can only remove.
// Chips joined with OR mean something the simple controls can't say, so then it's all left to Advanced.
function splitChips(chips: readonly Chip[]) {
    const parts: Partial<Record<Part, Chip>> = {}
    const others: Chip[] = []
    const hasOr = chips.some((c, i) => i > 0 && c.join === 'or')
    for (const chip of chips) {
        const part = hasOr ? null : partOf(chip)
        if (part && !parts[part]) parts[part] = chip
        else others.push(chip)
    }
    return { parts, others, hasOr }
}

// typed syntax like `t:elf mv<=2`, which is turned into chips rather than searched as a name
const looksLikeSyntax = (text: string) => splitTerms(text).some((t) => /^-?[a-z]+(>=|<=|!=|:|=|>|<)./i.test(t.term))

// Simple mode: a name box and one-tap colors, type, mana value and format. It reads and writes the same chips
// as Advanced, so a search started in one carries on in the other. A change searches straight away; the name
// searches on Enter or Search.
export function SimpleSearch() {
    const snap = useSnapshot(querybox)
    const { parts, others, hasOr } = splitChips(snap.chips as Chip[])
    const wrapRef = useRef<HTMLDivElement>(null)

    // the name as typed; it follows the search when that changes from elsewhere (an address, Back, Advanced)
    const searchedName = parts.name?.draft?.text ?? ''
    const [name, setName] = useState(searchedName)
    useEffect(() => setName(searchedName), [searchedName])

    function search() {
        wrapRef.current?.closest('form')?.requestSubmit()
    }

    // set one part of the search to `draft`, or take it out with null; the live chips are found again by id
    function setPart(part: Part, filterId: string, draft: Draft | null) {
        const filter = filterById(filterId)!
        const current = splitChips(querybox.chips).parts[part]
        const i = current ? querybox.chips.findIndex((c) => c.id === current.id) : -1
        const token = draft ? buildToken(filter, draft) : ''
        if (!token || !draft) {
            if (i >= 0) querybox.chips.splice(i, 1)
        } else if (i >= 0) {
            Object.assign(querybox.chips[i], { token, draft })
        } else {
            querybox.chips.push({ id: chipId(), token, join: 'and', filterId, draft })
        }
    }

    // the name box into the search: plain words are a name, typed syntax becomes chips of its own
    function commitName() {
        // with an OR in the search there's no name part to put it in (the box is off then)
        if (splitChips(querybox.chips).hasOr) return
        const text = name.trim()
        if (text && looksLikeSyntax(text)) {
            setPart('name', 'name', null)
            querybox.chips.push(...parseQuery(text).map((c) => ({ ...c, id: chipId() })))
            setName('')
            return
        }
        setPart('name', 'name', text ? { ...emptyDraft(filterById('name')!), text } : null)
    }

    // a pick searches now, with whatever is in the name box too
    function pick(part: Part, filterId: string, draft: Draft | null) {
        commitName()
        setPart(part, filterId, draft)
        search()
    }

    const draftFor = (filterId: string, patch: Partial<Draft>): Draft => ({ ...emptyDraft(filterById(filterId)!), ...patch })

    const colors = parts.color?.draft?.values ?? []
    function toggleColor(v: string) {
        // colorless is a card with no colors, so it doesn't go with the others
        const next = colors.includes(v) ? colors.filter((c) => c !== v) : v === 'c' ? ['c'] : [...colors.filter((c) => c !== 'c'), v]
        pick('color', 'color', next.length ? draftFor('color', { values: next, compare: '>=' }) : null)
    }

    const type = parts.type?.draft?.values[0] ?? ''
    const mv = parts.mv?.draft ? (parts.mv.draft.compare === '>=' ? '7+' : parts.mv.draft.text) : ''
    const format = parts.format?.draft?.values[0] ?? ''

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <div className={styles.searchRow}>
                <input type="search" className={styles.name} value={name} aria-label="Card name" disabled={hasOr}
                    placeholder="Card name, e.g. lightning bolt" enterKeyHint="search" autoComplete="off" spellCheck={false}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); search() } }} />
                <button type="button" className={styles.search} onClick={() => { commitName(); search() }}>Search</button>
            </div>

            <div className={styles.quick} data-locked={hasOr || undefined}>
                <div className={styles.colors} role="group" aria-label="Colors (the card includes all of them)">
                    {COLORS.map((c) => (
                        <button key={c.value} type="button" className={styles.pip} data-color={c.value} disabled={hasOr}
                            aria-pressed={colors.includes(c.value)} aria-label={c.label} title={c.label}
                            onClick={() => toggleColor(c.value)} />
                    ))}
                </div>
                <Pick label="Type" value={type} disabled={hasOr} options={TYPES.map((t) => ({ value: t, label: cap(t) }))}
                    onChange={(v) => pick('type', 'type', v ? draftFor('type', { values: [v] }) : null)} />
                <Pick label="Mana value" value={mv} disabled={hasOr}
                    options={MANA_VALUES.map((v) => ({ value: v, label: v === '7+' ? '7 or more' : v }))}
                    onChange={(v) => pick('mv', 'mv', v ? draftFor('mv', v === '7+' ? { compare: '>=', text: '7' } : { compare: '=', text: v }) : null)} />
                <Pick label="Format" value={format} disabled={hasOr} options={FORMATS}
                    onChange={(v) => pick('format', 'format', v ? draftFor('format', { values: [v] }) : null)} />
            </div>

            {others.length ? (
                <div className={styles.others}>
                    <span className={styles.muted}>
                        {hasOr ? 'This search joins filters with OR, which only Advanced can change.' : 'Also searching for'}
                    </span>
                    {hasOr ? null : others.map((c) => (
                        <span key={c.id} className={styles.chip}>
                            <span className={styles.chipLabel} title={c.token}>{chipLabel(c)}</span>
                            <button type="button" className={styles.chipRemove} aria-label={`Remove ${chipLabel(c)}`}
                                onClick={() => {
                                    const i = querybox.chips.findIndex((x) => x.id === c.id)
                                    if (i >= 0) querybox.chips.splice(i, 1)
                                    commitName()
                                    search()
                                }}>×</button>
                        </span>
                    ))}
                    <button type="button" className={styles.toAdvanced} onClick={() => { commitName(); searchMode.mode = 'advanced' }}>
                        Edit in Advanced
                    </button>
                </div>
            ) : null}
        </div>
    )
}

// one of the menus: it reads "Type: Any" until something's picked, and the browser's own menu opens over it
function Pick({ label, value, options, disabled, onChange }: {
    label: string, value: string, options: readonly { value: string, label: string }[], disabled?: boolean, onChange: (v: string) => void,
}): ReactNode {
    const current = options.find((o) => o.value === value)
    return (
        <label className={styles.pick} data-set={current ? true : undefined}>
            <select value={current ? value : ''} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>
                <option value="">Any {label.toLowerCase()}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className={styles.face} aria-hidden>
                <span>{label}: {current?.label ?? 'Any'}</span>
                <Arrow to="down" />
            </span>
        </label>
    )
}
