import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useSnapshot } from 'valtio'
import styles from './QueryInput.module.css'
import {
    buildQuery, buildToken, chipLabel, COLOR_COUNTS, COLOR_MODES, COLORS, COMPARE_WORDS, describe, emptyDraft, filterById,
    isComplete, lastFragment, matchFilters, parseToken, splitTerms,
    type Draft, type Filter, type Join, type Match,
} from './filters'
import { findTypes, isKnownType, loadTypeCatalogs, mergedNote, mergedType, singular, typeLabel, useCatalog, useTypeGroups } from './catalog'
import { chipId, querybox } from '../Context/query'
import { RulesBuilder } from './RulesBuilder'
import { blockToken } from './rules'
import { findRedundant } from './problems'

// what the dropdown list offers: a creature type that matches the typed word, or a filter to fill in
type Item = { type: string } | { filter: Filter }

// The search box plus a dropdown that builds Scryfall syntax from plain choices:
// pick a filter (or start typing its name), fill it in, and it's added to the search as a chip.
export function QueryInput() {
    // sync, so typing into the box never jumps the cursor
    const snap = useSnapshot(querybox, { sync: true })
    const text = snap.text
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(-1)
    // the filter being filled in; `fragment` is the typed word it replaces, `chipId` the chip it's editing
    const [editing, setEditing] = useState<{ filter: Filter, fragment: string, chipId?: number } | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [join, setJoin] = useState<Join>('and')
    // the last chip, once Backspace has been pressed on an empty box; a second press removes it
    const [armed, setArmed] = useState<number | null>(null)
    const creatures = useCatalog('creature-types')
    const wrapRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    // set while focus goes back to the box after adding a filter, so the dropdown doesn't pop straight back open
    const refocusing = useRef(false)
    const listId = useId()
    // the search a suggestion was waved away for, so it stays gone until the search changes
    const [dismissed, setDismissed] = useState<string | null>(null)

    const fragment = lastFragment(text)
    // a typed word that names a creature type (plurals too) can be added straight away, like an @-mention
    const typeHits = /^[a-z][a-z' -]{2,}$/i.test(fragment) ? findTypes(fragment, creatures, 3) : []
    const items: Item[] = [...typeHits.map((type) => ({ type })), ...matchFilters(fragment).map((filter) => ({ filter }))]

    // the other type lists (lands, artifacts…) are only needed once someone starts building a search
    useEffect(() => { if (open) loadTypeCatalogs() }, [open])

    // clicking anywhere else closes the dropdown
    useEffect(() => {
        if (!open) return
        const onDown = (e: PointerEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) close()
        }
        document.addEventListener('pointerdown', onDown)
        return () => document.removeEventListener('pointerdown', onDown)
    }, [open])

    function close() {
        setOpen(false)
        setEditing(null)
        setActive(-1)
    }

    function refocus() {
        refocusing.current = true
        inputRef.current?.focus()
        refocusing.current = false
    }

    function pick(item: Item) {
        if ('type' in item) {
            // straight in as a chip, replacing the word that found it
            const filter = filterById('creature')!
            const d = { ...emptyDraft(filter), values: [item.type] }
            querybox.chips.push({ id: chipId(), token: buildToken(filter, d), join: 'and', filterId: filter.id, draft: d })
            querybox.text = text.slice(0, text.length - fragment.length)
            setActive(-1)
            refocus()
            return
        }
        // the typed word was what found this filter, so the filter replaces it
        setEditing({ filter: item.filter, fragment })
        setDraft(emptyDraft(item.filter))
        setJoin('and')
        setActive(-1)
    }

    // open a chip in its filter's editor, or hand a chip we can't edit back to the box as text
    function editChip(id: number) {
        const i = querybox.chips.findIndex((c) => c.id === id)
        const chip = querybox.chips[i]
        const filter = filterById(chip?.filterId)
        if (!chip) return
        if (!filter || !chip.draft) {
            querybox.chips.splice(i, 1)
            querybox.text = `${text.trimEnd()} ${chip.token} `.trimStart()
            refocus()
            return
        }
        setEditing({ filter, fragment: '', chipId: id })
        setDraft({ ...chip.draft, values: [...chip.draft.values], blocks: chip.draft.blocks.map((b) => ({ ...b })) })
        setJoin(chip.join)
        setOpen(true)
    }

    function removeChip(id: number) {
        const i = querybox.chips.findIndex((c) => c.id === id)
        if (i >= 0) querybox.chips.splice(i, 1)
        if (editing?.chipId === id) setEditing(null)
    }

    const base = editing ? text.slice(0, text.length - editing.fragment.length) : text
    const token = editing && draft ? buildToken(editing.filter, draft) : ''
    const editIndex = editing?.chipId ? snap.chips.findIndex((c) => c.id === editing.chipId) : -1
    // what the chips would be once this filter is added or updated
    const nextChips = editing && token
        ? editIndex >= 0
            ? snap.chips.map((c, i) => i === editIndex ? { ...c, token, join } : c)
            : [...snap.chips, { token, join }]
        : snap.chips
    // and/or only means something when there's a chip before this one
    const hasBefore = editIndex >= 0 ? editIndex > 0 : snap.chips.length > 0

    function add(search: boolean) {
        if (!token || !editing || !draft) return
        const chip = { token, join, filterId: editing.filter.id, draft: { ...draft, values: [...draft.values], blocks: draft.blocks.map((b) => ({ ...b })) } }
        const i = editing.chipId ? querybox.chips.findIndex((c) => c.id === editing.chipId) : -1
        if (i >= 0) Object.assign(querybox.chips[i], chip)
        else {
            querybox.chips.push({ id: chipId(), ...chip })
            querybox.text = base
        }
        setJoin('and')
        refocus()
        if (search) {
            close()
            // wait for React to write the new query into the form before submitting it
            requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
        } else {
            // back to the filter list, ready to add the next one
            setEditing(null)
            setActive(-1)
        }
    }

    // a simpler search that finds the same cards, offered under the box
    const query = buildQuery(snap.chips, text)
    const tidy = findRedundant(snap.chips, text)

    function applyTidy(search: boolean) {
        if (!tidy) return
        querybox.chips = querybox.chips.filter((c) => !tidy.removeIds.includes(c.id))
        querybox.text = tidy.text
        if (editing?.chipId && tidy.removeIds.includes(editing.chipId)) setEditing(null)
        if (search) {
            close()
            requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
        } else refocus()
    }

    // typed syntax like `t:elf` becomes a chip as soon as it's finished with a space
    function onType(value: string) {
        setOpen(true)
        setEditing(null)
        setActive(-1)
        setArmed(null)
        querybox.text = value
        querybox.notice = null
        if (!value.endsWith(' ')) return
        const terms = splitTerms(value)
        const last = terms.at(-1)
        if (!last || !isComplete(last.term)) return
        const parsed = parseToken(last.term)
        if (!parsed) return
        const before = terms.slice(0, -1)
        let joinWith: Join = 'and'
        let keep = value.slice(0, last.start)
        // `or` right before it, with nothing else typed, means "or" against the chips so far
        if (before.at(-1)?.term.toLowerCase() === 'or') {
            if (before.length > 1 || !querybox.chips.length) return
            joinWith = 'or'
            keep = ''
        } else if (before.some((t) => /^or$/i.test(t.term))) return
        querybox.chips.push({ id: chipId(), token: buildToken(parsed.filter, parsed.draft), join: joinWith, filterId: parsed.filter.id, draft: parsed.draft })
        querybox.text = keep
        // an old creature type was swapped for the one it became; say so, since the chip shows the new name
        const typed = last.term.match(/^-?(?:t|type)[:=]"?([^"]+)"?$/i)?.[1]
        const merged = typed ? mergedType(typed) : undefined
        if (merged && parsed.filter.id === 'creature') querybox.notice = `${mergedNote(merged)} Searching ${merged.type} instead.`
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Escape') return close()
        if (e.key === 'Backspace' && !text && snap.chips.length) {
            const last = snap.chips.at(-1)!.id
            if (armed === last) removeChip(last)
            else setArmed(last)
            return
        }
        setArmed(null)
        if (editing) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (i + step + items.length) % items.length)
        } else if (e.key === 'Enter') {
            // Enter only picks from the list after arrowing to something; otherwise it searches as usual
            if (open && active >= 0 && items[active]) {
                e.preventDefault()
                pick(items[active])
            } else close()
        }
    }

    const update = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch })

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <div className={styles.bar}>
                {/* clicking the empty part of the box puts the cursor in it */}
                <div className={styles.box} onPointerDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}>
                    {snap.chips.map((c, i) => (
                        <span key={c.id} className={styles.chipGroup}>
                            {i > 0 ? (
                                <button type="button" className={styles.join} title="Switch between AND and OR"
                                    onClick={() => { querybox.chips[i].join = c.join === 'and' ? 'or' : 'and' }}>
                                    {c.join}
                                </button>
                            ) : null}
                            <span className={styles.token} data-armed={armed === c.id || undefined} data-editing={editing?.chipId === c.id || undefined}>
                                <button type="button" className={styles.tokenLabel} title={c.token} onClick={() => editChip(c.id)}>
                                    {chipLabel(c)}
                                </button>
                                <button type="button" className={styles.tokenRemove} aria-label={`Remove ${chipLabel(c)}`} onClick={() => removeChip(c.id)}>×</button>
                            </span>
                        </span>
                    ))}
                    <input
                        ref={inputRef}
                        type="text"
                        autoComplete="off"
                        className={styles.input}
                        placeholder={snap.chips.length ? 'Add more, or type a card name…' : 'Search for Magic cards…'}
                        aria-label="Search"
                        value={text}
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listId}
                        aria-activedescendant={!editing && active >= 0 ? `${listId}-${active}` : undefined}
                        onChange={(e) => onType(e.target.value)}
                        onFocus={() => { if (!refocusing.current) setOpen(true) }}
                        onKeyDown={onKeyDown}
                    />
                </div>
                {/* the search Searchbar reads: every chip plus what's typed */}
                <input type="hidden" name="query" value={query} />
                <button type="button" className={styles.toggle} aria-expanded={open} aria-label={open ? 'Hide filters' : 'Show filters'}
                    onClick={() => open ? close() : (setOpen(true), refocus())}>
                    <span className={styles.wide}>{open ? 'Collapse' : 'Filters'}</span>
                    <span className={styles.chevron} aria-hidden>▾</span>
                </button>
                <button type="submit" className={styles.search} aria-label="Search" onClick={close}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" /></svg>
                    <span className={styles.wide}>Search</span>
                </button>
            </div>

            {tidy && dismissed !== query ? (
                <div className={styles.suggest} role="status">
                    <div className={styles.suggestHead}>
                        <strong>Your search can be simpler</strong>
                        <button type="button" className={styles.tokenRemove} aria-label="Dismiss" onClick={() => { setDismissed(query); refocus() }}>×</button>
                    </div>
                    <ul>{tidy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <div className={styles.suggestFoot}>
                        <span className={styles.muted}>Same cards with</span>
                        <code>{buildQuery(snap.chips.filter((c) => !tidy.removeIds.includes(c.id)), tidy.text) || 'nothing'}</code>
                        <span className={styles.suggestButtons}>
                            <button type="button" className={styles.secondary} onClick={() => applyTidy(false)}>Update</button>
                            <button type="button" className={styles.primary} onClick={() => applyTidy(true)}>Update &amp; search</button>
                        </span>
                    </div>
                </div>
            ) : null}

            {snap.notice ? (
                <div className={styles.notice} role="status">
                    <span>{snap.notice}</span>
                    <button type="button" className={styles.tokenRemove} aria-label="Dismiss" onClick={() => { querybox.notice = null }}>×</button>
                </div>
            ) : null}

            {open && editing && draft ? (
                <div className={styles.panel}>
                    <div className={styles.head}>
                        <button type="button" className={styles.back} onClick={() => setEditing(null)}>‹ All filters</button>
                        <strong>{editing.filter.label}</strong>
                        <span className={styles.muted}>{editing.filter.hint}</span>
                    </div>

                    <Editor filter={editing.filter} draft={draft} update={update} onDone={() => add(false)} />

                    <div className={styles.row}>
                        <span className={styles.label}>Show cards that</span>
                        <Segmented
                            value={draft.exclude ? 'not' : 'match'}
                            options={[{ value: 'match', label: 'match this' }, { value: 'not', label: "don't match this" }]}
                            onChange={(v) => update({ exclude: v === 'not' })}
                        />
                    </div>

                    {hasBefore ? (
                        <div className={styles.row}>
                            <span className={styles.label}>Combine with the filters before it</span>
                            <Segmented
                                value={join}
                                options={[{ value: 'and', label: 'AND — must match both' }, { value: 'or', label: 'OR — either is fine' }]}
                                onChange={setJoin}
                            />
                        </div>
                    ) : null}

                    <div className={styles.foot}>
                        <div className={styles.preview}>
                            {token ? (
                                <>
                                    <span>{describe(editing.filter, draft)}</span>
                                    <code>{buildQuery(nextChips, base)}</code>
                                </>
                            ) : <span className={styles.muted}>Fill this in to see what gets added</span>}
                        </div>
                        {editing.chipId ? (
                            <button type="button" className={styles.secondary} onClick={() => { removeChip(editing.chipId!); refocus() }}>Remove</button>
                        ) : null}
                        <button type="button" className={styles.secondary} disabled={!token} onClick={() => add(false)}>{editing.chipId ? 'Update' : 'Add'}</button>
                        <button type="button" className={styles.primary} disabled={!token} onClick={() => add(true)}>{editing.chipId ? 'Update' : 'Add'} &amp; search</button>
                    </div>
                </div>
            ) : open && items.length ? (
                <div className={styles.panel}>
                    <div className={styles.head}>
                        <strong>Add a filter</strong>
                        <span className={styles.muted}>or just type a card name and press Enter</span>
                    </div>
                    <ul className={styles.list} id={listId} role="listbox">
                        {items.map((item, i) => {
                            const plural = 'type' in item && singular(fragment, creatures) === item.type && item.type.toLowerCase() !== fragment.toLowerCase()
                            const merged = 'type' in item && !singular(fragment, creatures) ? mergedType(fragment) : undefined
                            const mergedHere = merged && 'type' in item && merged.type === item.type ? merged : undefined
                            return (
                                <li
                                    key={'type' in item ? `type-${item.type}` : item.filter.id}
                                    id={`${listId}-${i}`}
                                    role="option"
                                    aria-selected={i === active}
                                    className={styles.option}
                                    data-type={'type' in item || undefined}
                                    onPointerDown={(e) => e.preventDefault()}
                                    onClick={() => pick(item)}
                                    onPointerEnter={() => setActive(i)}
                                >
                                    {'type' in item ? (
                                        <>
                                            <span>Creature type: <strong>{item.type}</strong></span>
                                            <span className={styles.muted}>
                                                {mergedHere ? mergedNote(mergedHere)
                                                    : plural ? `Types are singular, so “${fragment}” means ${item.type}` : `Add ${item.type} cards to your search`}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span>{item.filter.label}</span>
                                            <span className={styles.muted}>{item.filter.hint}</span>
                                        </>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}

function Editor({ filter, draft, update, onDone }: { filter: Filter, draft: Draft, update: (p: Partial<Draft>) => void, onDone: () => void }) {
    // Enter in a field adds the filter rather than submitting the whole search
    const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); onDone() }
    }
    const toggle = (v: string) =>
        update({ values: draft.values.includes(v) ? draft.values.filter((x) => x !== v) : [...draft.values, v] })

    switch (filter.kind) {
        case 'choice':
            if (filter.id === 'type') return <TypePicker filter={filter} draft={draft} update={update} toggle={toggle} onDone={onDone} />
            return (
                <>
                    <div className={styles.chips}>
                        {filter.options.map((o) => (
                            <button type="button" key={o.value} className={styles.chip} aria-pressed={draft.values.includes(o.value)} onClick={() => toggle(o.value)}>
                                {o.label}
                            </button>
                        ))}
                    </div>
                    {filter.customPlaceholder ? (
                        <input className={styles.field} placeholder={filter.customPlaceholder} value={draft.custom}
                            onChange={(e) => update({ custom: e.target.value })} onKeyDown={onEnter} />
                    ) : null}
                    {(() => {
                        const merged = draft.custom.trim() && !isKnownType(draft.custom.trim()) ? mergedType(draft.custom) : undefined
                        return merged ? <span className={styles.noteLine}>{mergedNote(merged)} This will search {merged.type}.</span> : null
                    })()}
                    <MatchPicker count={draft.values.length + (draft.custom.trim() ? 1 : 0)} value={draft.match} onChange={(match) => update({ match })} />
                </>
            )
        case 'rules':
            return (
                <>
                    <RulesBuilder draft={draft} update={update} onDone={onDone} />
                    <MatchPicker count={draft.values.length + draft.blocks.filter((b) => blockToken(b)).length + (draft.text.trim() ? 1 : 0)}
                        value={draft.match} onChange={(match) => update({ match })} />
                </>
            )
        case 'creature':
            return <CreaturePicker draft={draft} update={update} toggle={toggle} onDone={onDone} />
        case 'color': {
            const colorless = draft.values.includes('c')
            const by = (
                <div className={styles.row}>
                    <span className={styles.label}>Search by</span>
                    <Segmented
                        value={draft.colorBy}
                        options={[{ value: 'colors', label: 'which colors' }, { value: 'count', label: 'how many colors' }]}
                        // each mode has its own sensible starting comparison
                        onChange={(colorBy) => update({ colorBy, compare: colorBy === 'count' ? '=' : emptyDraft(filter).compare })}
                    />
                </div>
            )
            if (draft.colorBy === 'count') return (
                <>
                    {by}
                    <div className={styles.row}>
                        <Segmented value={draft.compare} options={COMPARE_WORDS} onChange={(compare) => update({ compare })} />
                    </div>
                    <div className={styles.chips}>
                        {COLOR_COUNTS.map((n) => (
                            <button type="button" key={n} className={styles.chip} aria-pressed={draft.text === n}
                                onClick={() => update({ text: draft.text === n ? '' : n })}>
                                {n === '0' ? '0 (colorless)' : n}
                            </button>
                        ))}
                    </div>
                </>
            )
            return (
                <>
                    {by}
                    <div className={styles.chips}>
                        {COLORS.map((c) => (
                            <button type="button" key={c.value} className={styles.chip} aria-pressed={draft.values.includes(c.value)}
                                // colorless and real colors can't be mixed
                                onClick={() => update({ values: c.value === 'c' ? (colorless ? [] : ['c']) : [...draft.values.filter((v) => v !== 'c' && v !== c.value), ...(draft.values.includes(c.value) ? [] : [c.value])] })}>
                                <span className={styles.pip} data-color={c.value} />{c.label}
                            </button>
                        ))}
                    </div>
                    {!(colorless && filter.key === 'c') ? (
                        <div className={styles.row}>
                            <span className={styles.label}>Colors</span>
                            <Segmented value={draft.compare} options={COLOR_MODES[filter.key]} onChange={(compare) => update({ compare })} />
                        </div>
                    ) : null}
                </>
            )
        }
        case 'number':
            return (
                <div className={styles.row}>
                    <Segmented value={draft.compare} options={COMPARE_WORDS} onChange={(compare) => update({ compare })} />
                    <input className={`${styles.field} ${styles.number}`} type="number" inputMode="decimal" autoFocus
                        placeholder={filter.placeholder} value={draft.text}
                        onChange={(e) => update({ text: e.target.value })} onKeyDown={onEnter} />
                </div>
            )
        case 'text':
            return (
                <>
                    <input className={styles.field} autoFocus placeholder={filter.placeholder} value={draft.text}
                        onChange={(e) => update({ text: e.target.value })} onKeyDown={onEnter} />
                    {filter.suggestions ? (
                        <div className={styles.chips}>
                            {filter.suggestions.map((s) => (
                                <button type="button" key={s} className={styles.chip} aria-pressed={draft.text === s} onClick={() => update({ text: s })}>{s}</button>
                            ))}
                        </div>
                    ) : null}
                </>
            )
    }
}

// with two or more picked, whether a card needs one of them or all of them
function MatchPicker({ count, value, onChange }: { count: number, value: Match, onChange: (m: Match) => void }) {
    if (count < 2) return null
    return (
        <div className={styles.row}>
            <span className={styles.label}>Cards can be</span>
            <Segmented value={value} onChange={onChange}
                options={[{ value: 'any', label: 'any one of these' }, { value: 'all', label: 'all of these at once' }]} />
        </div>
    )
}

// search every creature type by name (plurals work too) and pick them like @-mentions, or browse the whole list
function CreaturePicker({ draft, update, toggle, onDone }: { draft: Draft, update: (p: Partial<Draft>) => void, toggle: (v: string) => void, onDone: () => void }) {
    const types = useCatalog('creature-types')
    const [q, setQ] = useState('')
    const [hi, setHi] = useState(0)
    const [browse, setBrowse] = useState(false)
    const listId = useId()
    const hits = findTypes(q, types).filter((t) => !draft.values.includes(t))
    const plural = singular(q, types)
    const merged = q.trim() && !plural ? mergedType(q) : undefined

    function choose(t: string) {
        toggle(t)
        setQ('')
        setHi(0)
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (hits.length) setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (q.trim() && hits[hi]) choose(hits[hi])
            else if (!q.trim()) onDone()
        } else if (e.key === 'Backspace' && !q && draft.values.length) {
            update({ values: draft.values.slice(0, -1) })
        }
    }

    // A–Z groups for browsing, narrowed by what's typed
    const shown = (types ?? []).filter((t) => t.toLowerCase().includes(q.trim().toLowerCase()) || t === plural || t === merged?.type)
    const groups = new Map<string, string[]>()
    for (const t of shown) groups.set(t[0], [...(groups.get(t[0]) ?? []), t])

    return (
        <>
            <div className={styles.mention}>
                {draft.values.map((t) => (
                    <span key={t} className={styles.token}>
                        <span className={styles.tokenLabel}>{t}</span>
                        <button type="button" className={styles.tokenRemove} aria-label={`Remove ${t}`} onClick={() => toggle(t)}>×</button>
                    </span>
                ))}
                <input className={styles.mentionInput} autoFocus value={q} role="combobox" aria-expanded={!!q.trim()} aria-controls={listId}
                    aria-activedescendant={hits[hi] ? `${listId}-${hi}` : undefined}
                    placeholder={types ? (draft.values.length ? 'Add another…' : 'Search creature types, e.g. dragons or elf') : 'Loading creature types…'}
                    onChange={(e) => { setQ(e.target.value); setHi(0) }} onKeyDown={onKeyDown} />
            </div>
            {q.trim() ? (
                hits.length ? (
                    <ul className={styles.suggest} id={listId} role="listbox">
                        {hits.map((t, i) => (
                            <li key={t} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className={styles.option}
                                onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(i)} onClick={() => choose(t)}>
                                <span>{t}</span>
                                {t === plural && t.toLowerCase() !== q.trim().toLowerCase()
                                    ? <span className={styles.muted}>Types are singular, so “{q.trim()}” means {t}</span>
                                    : merged && t === merged.type ? <span className={styles.muted}>{mergedNote(merged)}</span> : null}
                            </li>
                        ))}
                    </ul>
                ) : types ? <span className={styles.muted}>No creature type matches “{q.trim()}”</span> : null
            ) : null}
            <MatchPicker count={draft.values.length} value={draft.match} onChange={(match) => update({ match })} />
            <p className={styles.muted}>
                Creature types are the words after the dash on a creature's type line, like “Legendary Creature — Dragon Wizard”. A card can have several.
            </p>
            {types ? (
                <button type="button" className={styles.back} aria-expanded={browse} onClick={() => setBrowse((b) => !b)}>
                    {browse ? '▴ Hide the list' : `▾ Browse all ${types.length} creature types`}
                </button>
            ) : null}
            {browse ? (
                <div className={styles.browse}>
                    {[...groups].map(([letter, list]) => (
                        <div key={letter} className={styles.letter}>
                            <span className={styles.letterMark}>{letter}</span>
                            <div className={styles.chips}>
                                {list.map((t) => (
                                    <button type="button" key={t} className={styles.chip} aria-pressed={draft.values.includes(t)} onClick={() => toggle(t)}>{t}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                    {!shown.length ? <span className={styles.muted}>No creature type matches “{q.trim()}”</span> : null}
                </div>
            ) : null}
        </>
    )
}

// the common card types as chips, a search over every type word, and the full list grouped by kind to browse
function TypePicker({ filter, draft, update, toggle, onDone }: {
    filter: Filter & { kind: 'choice' }, draft: Draft, update: (p: Partial<Draft>) => void, toggle: (v: string) => void, onDone: () => void,
}) {
    const groups = useTypeGroups()
    const creatures = useCatalog('creature-types')
    const [q, setQ] = useState('')
    const [hi, setHi] = useState(0)
    const [browse, setBrowse] = useState(false)
    const listId = useId()
    const query = q.trim().toLowerCase()

    // every type word with the group it's from; creature types too, so "elf" still works here
    const all = [
        ...(groups ?? []).flatMap((g) => g.types.map((t) => ({ type: t, group: g.label }))),
        ...(creatures ?? []).map((t) => ({ type: t, group: 'Creature type' })),
    ]
    const groupOf = new Map(all.map((a) => [a.type, a.group]))
    const hits = findTypes(q, all.map((a) => a.type)).filter((t) => !draft.values.includes(t.toLowerCase()))
    const merged = query && !singular(query, all.map((a) => a.type)) ? mergedType(query) : undefined
    const total = (groups ?? []).reduce((n, g) => n + g.types.length, 0)

    // types picked from the search or the list stay on show next to the common ones
    const chips = [...filter.options.map((o) => o.value), ...draft.values.filter((v) => !filter.options.some((o) => o.value === v))]
    const label = (v: string) => filter.options.find((o) => o.value === v)?.label ?? typeLabel(v)

    function choose(t: string) {
        const v = t.toLowerCase()
        if (!draft.values.includes(v)) toggle(v)
        setQ('')
        setHi(0)
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (hits.length) setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            // only real types can be picked; a word that isn't one stays in the box with a note below
            if (query && hits[hi]) choose(hits[hi])
            else if (!query) onDone()
        }
    }

    return (
        <>
            <div className={styles.chips}>
                {chips.map((v) => (
                    <button type="button" key={v} className={styles.chip} aria-pressed={draft.values.includes(v)} onClick={() => toggle(v)}>
                        {label(v)}
                    </button>
                ))}
                {draft.custom.trim() ? (
                    <button type="button" className={styles.chip} aria-pressed="true" title="Remove" onClick={() => update({ custom: '' })}>
                        {draft.custom.trim()}
                    </button>
                ) : null}
            </div>
            <div className={styles.pieceWrap}>
                <input className={styles.field} value={q} role="combobox" aria-label="Search card types" aria-expanded={!!query} aria-controls={listId}
                    aria-activedescendant={hits[hi] ? `${listId}-${hi}` : undefined}
                    placeholder={groups ? 'Search every type, e.g. saga, equipment, snow, Jace' : 'Loading types…'}
                    onChange={(e) => { setQ(e.target.value); setHi(0) }} onKeyDown={onKeyDown} />
                {query ? (
                    hits.length ? (
                        <ul className={styles.suggest} id={listId} role="listbox">
                            {hits.map((t, i) => (
                                <li key={t} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className={styles.option}
                                    onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(i)} onClick={() => choose(t)}>
                                    <span>{t}</span>
                                    {merged && t === merged.type
                                        ? <span className={styles.muted}>{mergedNote(merged)}</span>
                                        : <span className={styles.muted}>{groupOf.get(t)?.replace(/s$/, '')}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : groups ? <span className={styles.muted}>“{q.trim()}” isn't a card type. Check the spelling or browse the list below.</span> : null
                ) : null}
            </div>
            {(() => {
                const m = draft.custom.trim() && !isKnownType(draft.custom.trim()) ? mergedType(draft.custom) : undefined
                return m ? <span className={styles.noteLine}>{mergedNote(m)} This will search {m.type}.</span> : null
            })()}
            <MatchPicker count={draft.values.length + (draft.custom.trim() ? 1 : 0)} value={draft.match} onChange={(match) => update({ match })} />
            {groups ? (
                <button type="button" className={styles.back} aria-expanded={browse} onClick={() => setBrowse((b) => !b)}>
                    {browse ? '▴ Hide the list' : `▾ Browse all ${total} card types`}
                </button>
            ) : null}
            {browse && groups ? (
                <div className={styles.browse}>
                    {groups.map((g) => {
                        const shown = g.types.filter((t) => t.toLowerCase().includes(query))
                        return shown.length ? (
                            <div key={g.label} className={styles.typeGroup}>
                                <span className={styles.label}>{g.label}</span>
                                <div className={styles.chips}>
                                    {shown.map((t) => (
                                        <button type="button" key={t} className={styles.chip} aria-pressed={draft.values.includes(t.toLowerCase())}
                                            onClick={() => toggle(t.toLowerCase())}>{t}</button>
                                    ))}
                                </div>
                            </div>
                        ) : null
                    })}
                    <span className={styles.muted}>Creature types like Elf or Dragon have their own list under the Creature type filter.</span>
                </div>
            ) : null}
        </>
    )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T, options: { value: T, label: string }[], onChange: (v: T) => void }) {
    return (
        <div className={styles.segmented} role="radiogroup">
            {options.map((o) => (
                <button type="button" key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    )
}
