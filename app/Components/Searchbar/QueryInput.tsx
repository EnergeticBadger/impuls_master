import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useSnapshot } from 'valtio'
import styles from './QueryInput.module.css'
import {
    buildQuery, buildToken, chipLabel, COLOR_COUNTS, COLOR_MODES, COLORS, COMPARE_WORDS, describe, emptyDraft, filterById,
    FILTER_GROUPS, FILTERS, isComplete, parseToken, pickCount, splitTerms,
    type Draft, type Filter, type Join,
} from './filters'
import {
    findTypes, isKnownType, keywordLabel, loadTypeCatalogs, mergedNote, mergedType, singular, typeLabel, useCatalog,
    useKeywordGroups, useTypeGroups,
} from './catalog'
import { chipId, querybox } from '../Context/query'
import { RulesBuilder } from './RulesBuilder'
import { findRedundant } from './problems'
import { Arrow } from '../Arrow/Arrow'

// the filters under their group headings, for the list "Add Search Filter" opens
const FILTER_LIST = FILTER_GROUPS.map((label) => ({ label, filters: FILTERS.filter((f) => f.group === label) }))

// The search box plus a panel that builds Scryfall syntax from plain choices: "Add Search Filter" lists the
// filters; pick one, fill it in, and it's added to the search as a chip. Typing in the box only ever searches.
export function QueryInput() {
    // sync, so typing into the box never jumps the cursor
    const snap = useSnapshot(querybox, { sync: true })
    const text = snap.text
    const [open, setOpen] = useState(false)
    // the filter being filled in, and `chipId` the chip it's editing
    const [editing, setEditing] = useState<{ filter: Filter, chipId?: number } | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [join, setJoin] = useState<Join>('and')
    // the last chip, once Backspace has been pressed on an empty box; a second press removes it
    const [armed, setArmed] = useState<number | null>(null)
    // creature types typed as `t:elf` become chips, and telling them from other types needs the list
    useCatalog('creature-types')
    const wrapRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listId = useId()
    // the search a suggestion was waved away for, so it stays gone until the search changes
    const [dismissed, setDismissed] = useState<string | null>(null)
    // The chips sit in a tray under the box, after "Add Search Filter", so the box keeps its width for typing. The
    // tray is open while a search is being put together and folds away to "See selected filters" once it's searched.
    const [chipsOpen, setChipsOpen] = useState(true)
    const trayOpen = chipsOpen || !snap.chips.length

    // the other type lists (lands, artifacts…) are only needed once someone starts building a search
    useEffect(() => { if (open) loadTypeCatalogs() }, [open])

    // where the search box ends on screen: the panel below it may use the rest of the screen's height
    // (the header is sticky, so this doesn't change as the page scrolls)
    useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap) return
        const set = () => wrap.style.setProperty('--wrap-bottom', `${Math.round(wrap.getBoundingClientRect().bottom)}px`)
        const observer = new ResizeObserver(set)
        observer.observe(wrap)
        window.addEventListener('resize', set)
        set()
        return () => { observer.disconnect(); window.removeEventListener('resize', set) }
    }, [open])

    // a search (not Previous/Next) folds the tray away, leaving the results more of the screen
    useEffect(() => {
        const form = inputRef.current?.form
        if (!form) return
        const onSubmit = (e: SubmitEvent) => { if ((e.submitter?.getAttribute('name') ?? 'search') === 'search') setChipsOpen(false) }
        form.addEventListener('submit', onSubmit)
        return () => form.removeEventListener('submit', onSubmit)
    }, [])

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
    }

    function refocus() {
        inputRef.current?.focus()
    }

    // "Add Search Filter" opens the list of filters (or goes back to it from a filter), and closes it again
    function toggleFilters() {
        if (open && !editing) return close()
        setEditing(null)
        setOpen(true)
    }

    function pick(filter: Filter) {
        setEditing({ filter })
        setDraft(emptyDraft(filter))
        setJoin('and')
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
        setEditing({ filter, chipId: id })
        setDraft({ ...chip.draft, values: [...chip.draft.values], blocks: chip.draft.blocks.map((b) => ({ ...b })) })
        setJoin(chip.join)
        setOpen(true)
    }

    // `search` re-runs the search without the chip; with nothing left there's nothing to search, and an empty
    // query would have Searchbar repeat the last search instead
    function removeChip(id: number, search = false) {
        const i = querybox.chips.findIndex((c) => c.id === id)
        if (i >= 0) querybox.chips.splice(i, 1)
        if (editing?.chipId === id) setEditing(null)
        if (search && buildQuery(querybox.chips, querybox.text)) {
            close()
            // wait for React to write the new query into the form before submitting it
            requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
        }
    }

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
        else querybox.chips.push({ id: chipId(), ...chip })
        setJoin('and')
        refocus()
        if (search) {
            close()
            // wait for React to write the new query into the form before submitting it
            requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
        } else {
            // back to the filter list, ready to add the next one
            setChipsOpen(true)
            setEditing(null)
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
        setChipsOpen(true)
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
            // the chip about to go should be in view
            setChipsOpen(true)
            return
        }
        setArmed(null)
        // Enter searches, so the filters panel gets out of the way of the results
        if (e.key === 'Enter') close()
    }

    const update = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch })

    // the search so far as chips, with AND / OR between them
    const chips = snap.chips.map((c, i) => (
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
                <button type="button" className={styles.tokenRemove} aria-label={`Remove ${chipLabel(c)}`} onClick={() => removeChip(c.id, true)}>×</button>
            </span>
        </span>
    ))

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <div className={styles.bar}>
                {/* clicking the empty part of the box puts the cursor in it */}
                <div className={styles.box} onPointerDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}>
                    <input
                        ref={inputRef}
                        type="text"
                        autoComplete="off"
                        className={styles.input}
                        placeholder="Search for Magic cards…"
                        aria-label="Search"
                        value={text}
                        onChange={(e) => onType(e.target.value)}
                        onKeyDown={onKeyDown}
                    />
                </div>
                {/* the search Searchbar reads: every chip plus what's typed */}
                <input type="hidden" name="query" value={query} />
                <button type="submit" className={styles.search} aria-label="Search" onClick={close}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" /></svg>
                </button>
            </div>

            <div className={styles.tray} data-open={trayOpen || undefined}>
                {/* first, so open it floats in the top corner and the chips flow around it */}
                {snap.chips.length ? (
                    <button type="button" className={styles.trayToggle} aria-expanded={chipsOpen}
                        aria-label={chipsOpen ? 'Hide selected filters' : undefined} onClick={() => setChipsOpen((o) => !o)}>
                        {chipsOpen ? null : <span>See selected filters</span>}
                        <Arrow to={chipsOpen ? 'up' : 'down'} />
                    </button>
                ) : null}
                {trayOpen ? (
                    <>
                        <button type="button" className={styles.addFilter} aria-expanded={open} aria-controls={listId}
                            onClick={toggleFilters}>
                            Add Search Filter <span aria-hidden>+</span>
                        </button>
                        {chips}
                    </>
                ) : null}
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
                        <button type="button" className={styles.sheetClose} aria-label="Close filters" onClick={close}>×</button>
                    </div>

                    <Editor filter={editing.filter} draft={draft} update={update} onDone={() => add(false)} />

                    <ShowCards filter={editing.filter} draft={draft} update={update} />

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
                                    <code>{buildQuery(nextChips, text)}</code>
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
            ) : open ? (
                <div className={styles.panel} id={listId}>
                    <div className={styles.head}>
                        <strong>Add a filter</strong>
                        <span className={styles.muted}>or just type a card name in the search box</span>
                        <button type="button" className={styles.sheetClose} aria-label="Close filters" onClick={close}>×</button>
                    </div>
                    <div className={styles.groups}>
                        {FILTER_LIST.map((group) => (
                            <ul key={group.label} className={styles.group} aria-label={group.label}>
                                <li aria-hidden className={styles.groupLabel}>{group.label}</li>
                                {group.filters.map((filter) => (
                                    <li key={filter.id}>
                                        <button type="button" className={styles.option} onClick={() => pick(filter)}>
                                            <span>{filter.label}</span>
                                            <span className={styles.muted}>{filter.hint}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ))}
                    </div>
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
                </>
            )
        case 'rules':
            return <RulesBuilder draft={draft} update={update} onDone={onDone} />
        case 'creature':
            return <CreaturePicker draft={draft} update={update} toggle={toggle} onDone={onDone} />
        case 'keyword':
            return <KeywordPicker filter={filter} draft={draft} toggle={toggle} onDone={onDone} />
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
                            <span className={styles.label}>{filter.key === 'id' ? 'Identity' : 'Colors'}</span>
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

// Whether the filter keeps or leaves out the cards it matches; once two or more things are picked, whether a card
// needs any of them, all of them, or none of them
function ShowCards({ filter, draft, update }: { filter: Filter, draft: Draft, update: (p: Partial<Draft>) => void }) {
    const several = pickCount(filter, draft) > 1
    return (
        <div className={styles.row}>
            <span className={styles.label}>Show cards that</span>
            {several ? (
                <Segmented
                    value={draft.exclude ? 'none' : draft.match}
                    options={[{ value: 'any', label: 'match any of these' }, { value: 'all', label: 'match all of these' }, { value: 'none', label: 'match none of these' }]}
                    // "none of these" leaves out a card with any one of them
                    onChange={(v) => update(v === 'none' ? { exclude: true, match: 'any' } : { exclude: false, match: v })}
                />
            ) : (
                <Segmented
                    value={draft.exclude ? 'not' : 'match'}
                    options={[{ value: 'match', label: 'match this' }, { value: 'not', label: "don't match this" }]}
                    onChange={(v) => update({ exclude: v === 'not' })}
                />
            )}
        </div>
    )
}

// the common keywords as chips, a search over all of them, and the full lists grouped by kind to browse
function KeywordPicker({ filter, draft, toggle, onDone }: {
    filter: Filter & { kind: 'keyword' }, draft: Draft, toggle: (v: string) => void, onDone: () => void,
}) {
    const groups = useKeywordGroups()
    const [q, setQ] = useState('')
    const [hi, setHi] = useState(0)
    const [browse, setBrowse] = useState(false)
    const listId = useId()
    const query = q.trim().toLowerCase()

    const all = (groups ?? []).flatMap((g) => g.types.map((k) => ({ keyword: k, group: g.label })))
    const groupOf = new Map(all.map((a) => [a.keyword.toLowerCase(), a.group]))
    // ones that start with what's typed first, then ones that contain it
    const hits = query
        ? [...all.filter((a) => a.keyword.toLowerCase().startsWith(query)), ...all.filter((a) => !a.keyword.toLowerCase().startsWith(query) && a.keyword.toLowerCase().includes(query))]
            .map((a) => a.keyword).filter((k) => !draft.values.includes(k.toLowerCase())).slice(0, 8)
        : []
    const total = all.length

    // keywords picked from the search or the list stay on show next to the common ones
    const chips = [...filter.common, ...draft.values.filter((v) => !filter.common.includes(v))]

    function choose(k: string) {
        const v = k.toLowerCase()
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
            if (query && hits[hi]) choose(hits[hi])
            else if (!query) onDone()
        }
    }

    return (
        <>
            <div className={styles.chips}>
                {chips.map((v) => (
                    <button type="button" key={v} className={styles.chip} aria-pressed={draft.values.includes(v)} onClick={() => toggle(v)}>
                        {keywordLabel(v)}
                    </button>
                ))}
            </div>
            <div className={styles.pieceWrap}>
                <input className={styles.field} autoFocus value={q} role="combobox" aria-label="Search keywords" aria-expanded={!!query} aria-controls={listId}
                    aria-activedescendant={hits[hi] ? `${listId}-${hi}` : undefined}
                    placeholder={groups ? `Search all ${total} keywords, e.g. ward, surveil, raid` : 'Loading keywords…'}
                    onChange={(e) => { setQ(e.target.value); setHi(0) }} onKeyDown={onKeyDown} />
                {query ? (
                    hits.length ? (
                        <ul className={styles.suggest} id={listId} role="listbox">
                            {hits.map((k, i) => (
                                <li key={k} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className={styles.option}
                                    onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(i)} onClick={() => choose(k)}>
                                    <span>{k}</span>
                                    <span className={styles.muted}>{groupOf.get(k.toLowerCase())?.replace(/s$/, '')}</span>
                                </li>
                            ))}
                        </ul>
                    ) : groups ? <span className={styles.muted}>No keyword matches “{q.trim()}”</span> : null
                ) : null}
            </div>
            {groups ? (
                <button type="button" className={styles.back} aria-expanded={browse} onClick={() => setBrowse((b) => !b)}>
                    {browse ? '▴ Hide the list' : `▾ Browse all ${total} keywords`}
                </button>
            ) : null}
            {browse && groups ? (
                <div className={styles.browse}>
                    {groups.map((g) => {
                        const shown = g.types.filter((k) => k.toLowerCase().includes(query))
                        return shown.length ? (
                            <div key={g.label} className={styles.typeGroup}>
                                <span className={styles.label}>{g.label}</span>
                                <div className={styles.chips}>
                                    {shown.map((k) => (
                                        <button type="button" key={k} className={styles.chip} aria-pressed={draft.values.includes(k.toLowerCase())}
                                            onClick={() => toggle(k.toLowerCase())}>{k}</button>
                                    ))}
                                </div>
                            </div>
                        ) : null
                    })}
                </div>
            ) : null}
        </>
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
