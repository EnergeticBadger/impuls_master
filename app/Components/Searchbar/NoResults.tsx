import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import styles from './NoResults.module.css'
import { querybox } from '../Context/query'
import { buildQuery, chipLabel } from './filters'
import { loadTypeCatalogs } from './catalog'
import { findProblems } from './problems'

// the most filters we'll test one by one; each test is a real Scryfall search
const MAX_TRIES = 8

// Pop-up for a search with no results: what's certainly wrong with it, and which filter is holding it back.
// `count` returns how many cards a query finds; `research` runs the search again after a fix.
export function NoResults({ count, research }: { count: (q: string) => Promise<number>, research: () => void }) {
    const snap = useSnapshot(querybox)
    const problem = snap.noResults
    const ref = useRef<HTMLDialogElement>(null)
    // the type lists, so plural and unknown-type checks can run
    const [typesReady, setTypesReady] = useState(false)
    // cards found with each part taken out, by position; undefined while checking
    const [without, setWithout] = useState<(number | undefined)[]>([])

    // the parts a card has to match: each chip, then any typed words
    const parts = [
        ...snap.chips.map((c) => ({ label: chipLabel(c), query: buildQuery(snap.chips.filter((x) => x !== c), snap.text), remove: () => { querybox.chips.splice(querybox.chips.findIndex((x) => x.id === c.id), 1) } })),
        ...(snap.text.trim() ? [{ label: /[:<>=]/.test(snap.text) ? `“${snap.text.trim()}”` : `Card name has “${snap.text.trim()}”`, query: buildQuery(snap.chips, ''), remove: () => { querybox.text = '' } }] : []),
    ]
    const key = parts.map((p) => p.query).join('\u0000')

    useEffect(() => {
        const dialog = ref.current
        if (!dialog) return
        if (problem && !dialog.open) dialog.showModal()
        if (!problem && dialog.open) dialog.close()
    }, [problem])

    useEffect(() => {
        if (!problem) return
        loadTypeCatalogs().then(() => setTypesReady(true))
    }, [problem])

    // try the search without each part, one at a time so Scryfall isn't flooded
    useEffect(() => {
        setWithout([])
        if (!problem || parts.length < 2) return
        let live = true
        ;(async () => {
            for (const [i, p] of parts.slice(0, MAX_TRIES).entries()) {
                const n = p.query ? await count(p.query).catch(() => 0) : 0
                if (!live) return
                setWithout((w) => { const next = [...w]; next[i] = n; return next })
            }
        })()
        return () => { live = false }
    }, [problem, key])

    const close = () => { querybox.noResults = null }
    const apply = (fn: () => void) => { fn(); close(); research() }

    const problems = problem && typesReady ? findProblems(snap.chips, snap.text, problem.warnings) : []

    return (
        <dialog ref={ref} className={styles.dialog} onClose={close} aria-labelledby="no-results-title"
            onClick={(e) => { if (e.target === e.currentTarget) close() }}>
            {problem ? (
                <div className={styles.body}>
                    <h2 id="no-results-title">No cards found</h2>
                    <code className={styles.query}>{problem.query}</code>

                    {problems.length ? (
                        <section className={styles.section}>
                            <h3>What's wrong</h3>
                            <ul className={styles.list}>
                                {problems.map((p, i) => (
                                    <li key={i} className={styles.item}>
                                        <span>{p.text}</span>
                                        {p.fix ? <button type="button" className={styles.primary} onClick={() => apply(p.fix!.apply)}>{p.fix.label}</button> : null}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {parts.length >= 2 ? (
                        <section className={styles.section}>
                            <h3>{problems.length ? 'It might also be too specific' : 'It might be too specific'}</h3>
                            <p className={styles.muted}>A card has to match all of these at once. Here's what taking each one out would find:</p>
                            <ul className={styles.list}>
                                {parts.slice(0, MAX_TRIES).map((p, i) => {
                                    const n = without[i]
                                    return (
                                        <li key={p.query + i} className={styles.item}>
                                            <span className={styles.part}>{p.label}</span>
                                            <span className={styles.muted}>
                                                {n === undefined ? 'Checking…' : n ? `Without it: ${n.toLocaleString()} ${n === 1 ? 'card' : 'cards'}` : 'Still nothing without it'}
                                            </span>
                                            {n ? <button type="button" className={styles.secondary} onClick={() => apply(p.remove)}>Remove &amp; search</button> : null}
                                        </li>
                                    )
                                })}
                            </ul>
                        </section>
                    ) : !problems.length && typesReady ? (
                        <p className={styles.muted}>
                            Nothing on Scryfall matches this. Check the spelling, or try fewer or more general words.
                        </p>
                    ) : null}

                    {!typesReady ? <p className={styles.muted}>Checking your search…</p> : null}

                    <div className={styles.foot}>
                        <button type="button" className={styles.secondary} onClick={close}>Close</button>
                    </div>
                </div>
            ) : null}
        </dialog>
    )
}
