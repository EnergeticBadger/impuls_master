import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import styles from './SimpleSearch.module.css'
import {
    buildToken, CARD_TYPES, chipLabel, COLORS, emptyDraft, filterById, parseQuery, splitTerms, SUPERTYPES,
    type Chip, type Draft, type Filter,
} from './filters'
import { POPULAR_SUBTYPES, SUBTYPE_GROUPS, typeLabel, useSubtypeGroups, type TypeGroup } from './catalog'
import { chipId, querybox } from '../Context/query'
import { searchMode } from '../Context/mode'
import { Arrow } from '../Arrow/Arrow'

// the mana values offered as one pick each; anything else stays an Advanced chip
const MANA_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7+']
const FORMATS = (filterById('format') as Filter & { kind: 'choice' }).options

const cap = (v: string) => v[0].toUpperCase() + v.slice(1)

// The parts of the search Simple mode has a control for, each holding a draft for its Advanced filter
type Part = 'name' | 'color' | 'type' | 'subtype' | 'mv' | 'format'

// whether a chip is one Simple mode can show: a name, colors the card includes, one type, one subtype, one mana
// value (or 7+), one format, none of them left out
function partOf(chip: Chip): Part | null {
    const d = chip.draft
    if (!d || d.exclude) return null
    switch (chip.filterId) {
        case 'name':
            return 'name'
        case 'color':
            return d.colorBy === 'colors' && (d.compare === '>=' || d.values.join('') === 'c') ? 'color' : null
        case 'type':
            if (d.values.length !== 1 || d.custom.trim()) return null
            if (CARD_TYPES.includes(d.values[0])) return 'type'
            return SUPERTYPES.includes(d.values[0]) ? null : 'subtype'
        // creature types are kept as the Creature type filter's chips, as a search read from an address makes them
        case 'creature':
            return d.values.length === 1 ? 'subtype' : null
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

// Simple mode: a name box and one-tap colors, type, subtype, mana value and format, with subtypes on show to tap. It reads and writes the same chips
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
            Object.assign(querybox.chips[i], { token, draft, filterId })
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
    const subtype = parts.subtype?.draft?.values[0] ?? ''

    // the full subtype lists are only fetched once they're wanted: a type is picked, or the Subtype menu is reached for
    const [wantSubtypes, setWantSubtypes] = useState(false)
    const subtypeGroups = useSubtypeGroups(wantSubtypes || !!type || !!subtype)
    // the kind of subtype a card type has (Artifact → Equipment, Vehicle…), and which kind a subtype is
    const kindOf = (t: string) => SUBTYPE_GROUPS.find((g) => g.types.includes(t))?.label
    const kindOfSubtype = (st: string) => parts.subtype?.filterId === 'creature' && st === subtype ? 'Creature'
        : subtypeGroups?.find((g) => g.types.some((x) => x.toLowerCase() === st.toLowerCase()))?.label
        ?? POPULAR_SUBTYPES.find((p) => p.type.toLowerCase() === st.toLowerCase())?.kind
    const typeKind = type ? kindOf(type) : undefined

    // a subtype's chip: creature types are the Creature type filter's, the rest the Card type filter's
    const subtypeDraft = (st: string, kind: string | undefined): [string, Draft] => kind === 'Creature'
        ? ['creature', draftFor('creature', { values: [st] })]
        : ['type', draftFor('type', { values: [st.toLowerCase()] })]

    function pickType(v: string) {
        commitName()
        // a subtype the new type can't have (Equipment, then Creature) would find nothing, so it goes
        const kind = subtype ? kindOfSubtype(subtype) : undefined
        if (v && kind && kindOf(v) !== kind) setPart('subtype', 'type', null)
        setPart('type', 'type', v ? draftFor('type', { values: [v] }) : null)
        search()
    }

    function pickSubtype(st: string) {
        if (!st || st.toLowerCase() === subtype.toLowerCase()) return pick('subtype', 'type', null)
        const [filterId, draft] = subtypeDraft(st, kindOfSubtype(st) ?? typeKind)
        pick('subtype', filterId, draft)
    }

    // the subtypes to offer: all of the picked type's, or the popular ones of every kind while no type is
    // picked (and while the lists load). The one picked is always among them
    const typeGroup = typeKind ? subtypeGroups?.find((g) => g.label === typeKind) : undefined
    const popular = POPULAR_SUBTYPES.filter((p) => !typeKind || p.kind === typeKind).map((p) => p.type)
    const offered = typeGroup?.types ?? popular
    const subtypeLabel = subtype ? (parts.subtype?.filterId === 'creature' ? subtype : typeLabel(subtype)) : ''
    const row = subtype && !offered.some((t) => t.toLowerCase() === subtype.toLowerCase()) ? [subtypeLabel, ...offered] : offered
    // the menu lists them by kind: the picked type's kind, or every kind
    const menuGroups: TypeGroup[] = subtypeGroups
        ? subtypeGroups.filter((g) => !typeKind || g.label === typeKind)
        : [{ label: 'Popular', types: popular }]
    if (subtype && !menuGroups.some((g) => g.types.some((t) => t.toLowerCase() === subtype.toLowerCase()))) {
        menuGroups.unshift({ label: 'Picked', types: [subtypeLabel] })
    }
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
                <Pick label="Type" value={type} disabled={hasOr} options={CARD_TYPES.map((t) => ({ value: t, label: cap(t) }))}
                    onChange={pickType} />
                <Pick label="Subtype" value={subtype.toLowerCase()} disabled={hasOr} onWant={() => setWantSubtypes(true)}
                    groups={menuGroups.map((g) => ({ label: g.label, options: g.types.map((t) => ({ value: t.toLowerCase(), label: t })) }))}
                    onChange={(v) => pickSubtype(menuGroups.flatMap((g) => g.types).find((t) => t.toLowerCase() === v) ?? '')} />
                <Pick label="Mana value" value={mv} disabled={hasOr}
                    options={MANA_VALUES.map((v) => ({ value: v, label: v === '7+' ? '7 or more' : v }))}
                    onChange={(v) => pick('mv', 'mv', v ? draftFor('mv', v === '7+' ? { compare: '>=', text: '7' } : { compare: '=', text: v }) : null)} />
                <Pick label="Format" value={format} disabled={hasOr} options={FORMATS}
                    onChange={(v) => pick('format', 'format', v ? draftFor('format', { values: [v] }) : null)} />
            </div>

            {/* the subtypes on show, so there's something to come across: tap one to search it */}
            {hasOr ? null : (
                <div className={styles.subtypes}>
                    <span className={styles.muted}>{typeKind ? `${typeKind} subtypes` : 'Subtypes'}</span>
                    <div className={styles.subtypeRow}>
                        {row.map((t) => (
                            <button type="button" key={t} className={styles.subtype} aria-pressed={t.toLowerCase() === subtype.toLowerCase()}
                                onClick={() => pickSubtype(t)}>
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            )}

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

type Choice = { value: string, label: string }

// one of the menus: it reads "Type: Any" until something's picked, and the browser's own menu opens over it.
// `groups` lists the choices under headings instead; `onWant` is told when someone reaches for the menu
function Pick({ label, value, options = [], groups, disabled, onWant, onChange }: {
    label: string, value: string, options?: readonly Choice[], groups?: { label: string, options: Choice[] }[], disabled?: boolean,
    onWant?: () => void, onChange: (v: string) => void,
}): ReactNode {
    const current = [...options, ...(groups ?? []).flatMap((g) => g.options)].find((o) => o.value === value)
    return (
        <label className={styles.pick} data-set={current ? true : undefined} onPointerEnter={onWant} onFocus={onWant}>
            <select value={current ? value : ''} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>
                <option value="">Any {label.toLowerCase()}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {groups?.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                ))}
            </select>
            <span className={styles.face} aria-hidden>
                <span>{label}: {current?.label ?? 'Any'}</span>
                <Arrow to="down" />
            </span>
        </label>
    )
}
