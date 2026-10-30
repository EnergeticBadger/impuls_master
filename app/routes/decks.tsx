import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./Decks.module.css";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { createDeck, decks, deleteDeck, loadDecks, renameDeck } from "~/Components/Context/decks";

const DEFAULT_NAME = "Untitled deck";

export function meta() {
  return [
    { title: "My decks | Impulse Caster" },
    { name: "theme-color", content: "#1a1515" },
  ]
}

export default function Decks() {
  const snap = useSnapshot(decks)
  const [naming, setNaming] = useState<string>()
  const [renaming, setRenaming] = useState<{ id: string, name: string }>()
  const [deleting, setDeleting] = useState<string>()

  // the decks are read from localStorage after the first render; don't flash the empty state before that
  const [ready, setReady] = useState(false)

  useEffect(() => { loadDecks(); setReady(true) }, [])

  const list = [...snap.list].sort((a, b) => b.updated - a.updated)

  const create = () => {
    createDeck(naming?.trim() || DEFAULT_NAME)
    setNaming(undefined)
  }

  const rename = () => {
    if (renaming && renaming.name.trim()) renameDeck(renaming.id, renaming.name.trim())
    setRenaming(undefined)
  }

  const newDeckForm = naming === undefined ? (
    <button type="button" className={styles.button} onClick={() => setNaming(DEFAULT_NAME)}>New deck</button>
  ) : (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); create() }}>
      <input
        className={styles.input}
        value={naming}
        onChange={(e) => setNaming(e.target.value)}
        aria-label="Deck name"
        autoFocus
        onFocus={(e) => e.target.select()}
      />
      <button type="submit" className={styles.button}>Create</button>
      <button type="button" className={styles.button} onClick={() => setNaming(undefined)}>Cancel</button>
    </form>
  )

  return (
    <div>
      <SiteHeader />
      <main className={styles.page}>
        <h1 className={styles.title}>My decks</h1>
        {ready && list.length === 0 && <p className={styles.intro}>Decks are saved in this browser.</p>}
        <div>{newDeckForm}</div>
        {list.length > 0 && (
          <ul className={styles.list}>
            {list.map((d) => {
              const cards = d.deck.main.reduce((n, e) => n + e.count, 0)
              return (
                <li key={d.id} className={styles.deck}>
                  {renaming?.id === d.id ? (
                    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); rename() }}>
                      <input
                        className={styles.input}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: d.id, name: e.target.value })}
                        aria-label="Deck name"
                        autoFocus
                      />
                      <button type="submit" className={styles.button}>Save</button>
                      <button type="button" className={styles.button} onClick={() => setRenaming(undefined)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <div className={styles.info}>
                        <Link to={`/decks/${d.id}`} className={styles.name}>{d.name}</Link>
                        <span className={styles.meta}>
                          {cards} {cards === 1 ? "card" : "cards"}
                          {snap.current === d.id && <span className={styles.current}>Current deck</span>}
                        </span>
                      </div>
                      <div className={styles.actions}>
                        {deleting === d.id ? (
                          <>
                            <button type="button" className={styles.danger} onClick={() => { deleteDeck(d.id); setDeleting(undefined) }}>Delete {d.name}?</button>
                            <button type="button" className={styles.button} onClick={() => setDeleting(undefined)}>Keep</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className={styles.button} onClick={() => setRenaming({ id: d.id, name: d.name })}>Rename</button>
                            <button type="button" className={styles.button} onClick={() => setDeleting(d.id)}>Delete</button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
