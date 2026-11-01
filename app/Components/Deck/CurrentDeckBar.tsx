import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./CurrentDeckBar.module.css";
import { currentDeckOf, decks, loadDecks, setCurrentDeck } from "../Context/decks";
import { decksByRecent } from "~/lib/savedDecks";

// says which deck the add-to-deck buttons on search results add to, and lets people switch it.
// Shown only once decks are loaded (after hydration) and at least one exists.
export function CurrentDeckBar() {
    const { list, current } = useSnapshot(decks)
    const [ready, setReady] = useState(false)

    useEffect(() => { loadDecks(); setReady(true) }, [])

    const chosen = currentDeckOf(list, current)
    if (!ready || !chosen) return null

    const cards = chosen.deck.main.reduce((n, e) => n + e.count, 0)

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
        </div>
    )
}
