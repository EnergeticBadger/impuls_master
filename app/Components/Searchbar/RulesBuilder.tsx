import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import styles from './QueryInput.module.css'
import type { Draft } from './filters'
import { blockSentence, blockToken, EFFECTS, emptyBlock, findPieces, findTags, loadTags, ROLES, roleLabel, TARGETS, TRIGGERS, type Piece, type RuleBlock } from './rules'

// "What it does": pick what a card is for, snap together abilities from pieces, or look for exact words.
export function RulesBuilder({ draft, update, onDone }: { draft: Draft, update: (p: Partial<Draft>) => void, onDone: () => void }) {
    const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); onDone() }
    }
    const toggleRole = (v: string) =>
        update({ values: draft.values.includes(v) ? draft.values.filter((x) => x !== v) : [...draft.values, v] })
    const setBlock = (i: number, patch: Partial<RuleBlock>) =>
        update({ blocks: draft.blocks.map((b, j) => j === i ? { ...b, ...patch } : b) })
    const addBlock = () => update({ blocks: [...draft.blocks, emptyBlock()] })
    const removeBlock = (i: number) => update({ blocks: draft.blocks.filter((_, j) => j !== i) })
    // tags picked from the search stay on show next to the common ones
    const chips = [...ROLES.map((r) => r.value), ...draft.values.filter((v) => !ROLES.some((r) => r.value === v))]

    return (
        <>
            <section className={styles.section}>
                <span className={styles.label}>What it's for</span>
                <TagSearch picked={draft.values} onPick={toggleRole} onDone={onDone} />
                <div className={styles.chips}>
                    {chips.map((v) => (
                        <button type="button" key={v} className={styles.chip} aria-pressed={draft.values.includes(v)} onClick={() => toggleRole(v)}>
                            {roleLabel(v)}
                        </button>
                    ))}
                </div>
                <span className={styles.muted}>
                    These come from Scryfall's Tagger, where players label what each card does. There are thousands; search for any of them above.
                </span>
            </section>

            <section className={styles.section}>
                <span className={styles.label}>Build an ability</span>
                <span className={styles.muted}>
                    Most abilities read “when something happens, do something to someone”. Fill in any of the three; the card needs all the parts you pick in one sentence.
                </span>
                {draft.blocks.map((b, i) => (
                    <div key={i} className={styles.block}>
                        <div className={styles.blockParts}>
                            <PiecePicker part="when" label="When" pieces={TRIGGERS} value={b.trigger} empty="Any time"
                                placeholder="Search, e.g. enters, dies, attacks…" onChange={(trigger) => setBlock(i, { trigger })} />
                            <PiecePicker part="does" label="Does" pieces={EFFECTS} value={b.effect} empty="Anything"
                                placeholder="Search, e.g. draw, destroy, treasure…" onChange={(effect) => setBlock(i, { effect })} />
                            <PiecePicker part="with" label="To who or what" pieces={TARGETS} value={b.words} empty="Anyone or anything" free
                                placeholder="Search or type words, e.g. creature, opponent" onChange={(words) => setBlock(i, { words })} />
                            <button type="button" className={styles.tokenRemove} aria-label="Remove this ability" title="Remove this ability" onClick={() => removeBlock(i)}>×</button>
                        </div>
                        <span className={styles.blockSentence}>
                            {blockToken(b) ? blockSentence(b) : <span className={styles.muted}>Pick at least one part</span>}
                        </span>
                    </div>
                ))}
                <button type="button" className={styles.back} onClick={addBlock}>+ {draft.blocks.length ? 'Add another ability' : 'Add an ability'}</button>
            </section>

            <section className={styles.section}>
                <span className={styles.label}>Exact words on the card</span>
                <input className={styles.field} placeholder='e.g. "draw a card"' value={draft.text}
                    onChange={(e) => update({ text: e.target.value })} onKeyDown={onEnter} />
            </section>
        </>
    )
}

// search every Tagger tag by name; picking one toggles it like the chips below
function TagSearch({ picked, onPick, onDone }: { picked: readonly string[], onPick: (v: string) => void, onDone: () => void }) {
    const [tags, setTags] = useState<string[]>()
    const [q, setQ] = useState('')
    const [hi, setHi] = useState(0)
    const listId = useId()
    useEffect(() => { loadTags().then(setTags, () => setTags([])) }, [])
    const hits = findTags(q, tags ?? [], 8)

    function choose(v: string) {
        if (!picked.includes(v)) onPick(v)
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
        }
    }

    return (
        <div className={styles.pieceWrap}>
            <input className={styles.field} value={q} role="combobox" aria-label="Search Scryfall tags" aria-expanded={!!q.trim()} aria-controls={listId}
                aria-activedescendant={hits[hi] ? `${listId}-${hi}` : undefined}
                placeholder={tags ? `Search ${tags.length.toLocaleString()} tags, e.g. sacrifice, lifegain, treasure` : 'Search tags, e.g. sacrifice, lifegain, treasure'}
                onChange={(e) => { setQ(e.target.value); setHi(0) }} onKeyDown={onKeyDown} />
            {q.trim() ? (
                hits.length ? (
                    <ul className={styles.suggest} id={listId} role="listbox">
                        {hits.map((t, i) => (
                            <li key={t} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className={styles.option}
                                onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(i)} onClick={() => choose(t)}>
                                <span>{roleLabel(t)}{picked.includes(t) ? ' ✓' : ''}</span>
                            </li>
                        ))}
                    </ul>
                ) : <span className={styles.muted}>{tags ? `No tag matches “${q.trim()}”` : 'Loading tags…'}</span>
            ) : null}
        </div>
    )
}

// one part of an ability: a box you can type in to narrow a grouped list, or (free) type your own words
function PiecePicker({ part, label, pieces, value, empty, placeholder, free, onChange }: {
    part: string, label: string, pieces: readonly Piece[], value: string, empty: string, placeholder: string, free?: boolean,
    onChange: (v: string) => void,
}) {
    // what's typed while the list is open (null when closed), and whether the person has typed since opening it
    const [q, setQ] = useState<string | null>(null)
    const [typed, setTyped] = useState(false)
    const [hi, setHi] = useState(0)
    const listId = useId()
    const labelId = useId()
    const open = q !== null
    const chosen = pieces.find((p) => p.value === value)
    const hits = open ? findPieces(typed ? q : '', pieces) : []
    // the "any" choice leads the list, so a pick can be undone
    const items: (Piece | null)[] = [null, ...hits]

    function choose(p: Piece | null) {
        onChange(p?.value ?? '')
        setQ(null)
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setQ('')
            setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (!open) return
            // free text keeps what was typed unless something in the list was arrowed to
            if (free && hi === 0 && typed && q.trim()) { onChange(q.trim()); setQ(null) }
            else choose(items[hi] ?? null)
        } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setQ(null)
        }
    }

    // browsing shows the pieces under their group headings; a search lists the best matches first, without headings
    const searching = typed && !!q?.trim()
    const groups: [string, { p: Piece, i: number }[]][] = []
    hits.forEach((p, n) => {
        const last = groups.at(-1)
        const entry = { p, i: n + 1 }
        const group = searching ? '' : p.group
        if (last && last[0] === group) last[1].push(entry)
        else groups.push([group, [entry]])
    })

    const own = free && typed && q?.trim() ? q.trim() : ''
    const shown = open ? q : chosen?.label ?? value
    return (
        <div className={styles.blockPart}>
            <span className={styles.blockTag} data-part={part} id={labelId}>{label}</span>
            <input className={styles.field} value={shown} role="combobox" aria-labelledby={labelId} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={open ? `${listId}-${hi}` : undefined}
                placeholder={chosen || value ? '' : open ? placeholder : `${empty} ▾`}
                onFocus={() => { setQ(free && !chosen ? value : ''); setTyped(false); setHi(0) }}
                onBlur={() => {
                    // typed words count as the answer for who/what; elsewhere leaving the box keeps the last pick
                    if (free && typed && q !== null) onChange(q.trim())
                    setQ(null)
                }}
                // typing highlights the best match, or for who/what the typed words themselves
                onChange={(e) => { setQ(e.target.value); setTyped(true); setHi(free || !e.target.value.trim() ? 0 : 1) }}
                onKeyDown={onKeyDown} />
            {open ? (
                <ul className={styles.pieceList} id={listId} role="listbox" aria-label={label}>
                    <li id={`${listId}-0`} role="option" aria-selected={hi === 0} className={styles.option}
                        onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(0)}
                        onClick={() => own ? (onChange(own), setQ(null)) : choose(null)}>
                        <span>{own ? `Use my words: “${own}”` : empty}</span>
                    </li>
                    {groups.map(([group, list]) => (
                        <li key={group} role="presentation">
                            {group ? <span className={styles.pieceGroup}>{group}</span> : null}
                            <ul role="presentation">
                                {list.map(({ p, i }) => (
                                    <li key={p.value} id={`${listId}-${i}`} role="option" aria-selected={hi === i} className={styles.option}
                                        onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setHi(i)} onClick={() => choose(p)}>
                                        <span>{p.label}</span>
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                    {!hits.length && !free ? <li role="presentation" className={styles.muted}>Nothing matches “{q}”</li> : null}
                </ul>
            ) : null}
        </div>
    )
}
