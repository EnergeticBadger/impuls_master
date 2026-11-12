import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./CurrentDeckBar.module.css";
import { currentDeckOf, decks, loadDecks, setCurrentDeck } from "../Context/decks";
import { querybox } from "../Context/query";
import { buildQuery } from "../Searchbar/filters";
import { hasTerm, toggleTerm } from "../Searchbar/queryTerms";
import { readSearchUrl, searchUrl } from "../Searchbar/searchUrl";
import { commanderIdentity, identityTerm } from "~/lib/deck";
import { decksByRecent } from "~/lib/savedDecks";

// says which deck the add-to-deck buttons on search results add to, and lets people switch it.
// Shown only once decks are loaded (after hydration) and at least one exists.
export function CurrentDeckBar() {
    const { list, current } = useSnapshot(decks)
    const { chips } = useSnapshot(querybox)
    const navigate = useNavigate()
    const location = useLocation()
    const [ready, setReady] = useState(false)

    useEffect(() => { loadDecks(); setReady(true) }, [])

    const chosen = currentDeckOf(list, current)
    if (!ready || !chosen) return null

    const cards = chosen.deck.main.reduce((n, e) => n + e.count, 0)
    const commander = chosen.deck.commander
    const partner = chosen.deck.partner
    const term = commander ? identityTerm(commanderIdentity(chosen.deck)) : ""
    const query = buildQuery(chips)
    const pressed = !!commander && hasTerm(query, term)

    // searches again with the commander's colors added to the query, or taken out of it; the search bar
    // reads the new address and shows it as chips
    function toggle() {
        const q = toggleTerm(query, term)
        const by = readSearchUrl(location.search)
        navigate({ search: searchUrl({ q, order: by?.order ?? "name", dir: by?.dir ?? "auto", page: 1 }) }, { preventScrollReset: true })
    }

    return (
        <div className={styles.bar}>
            <label className={styles.label} htmlFor="current-deck">Adding to</label>
            <select
                id="current-deck"
                className={styles.select}
                value={chosen.id}
                onChange={(e) => setCurrentDeck(e.target.value)}
            >
                {decksByRecent(list).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className={styles.count}>{cards} {cards === 1 ? "card" : "cards"}</span>
            <Link to={`/decks/${chosen.id}`} className={styles.open}>Open</Link>
            {commander && (
                <button type="button" className={styles.identity} aria-pressed={pressed} onClick={toggle}>
                    In {commander.card.name}{partner ? ` and ${partner.card.name}` : ""}'s colors
                </button>
            )}
        </div>
    )
}
