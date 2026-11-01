import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./Decks.module.css";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { createDeck, createDeckWith, decks, deleteDeck, duplicateDeck, loadDecks, renameDeck } from "~/Components/Context/decks";
import { cardsByName } from "~/lib/card";
import { emptyDeck, type Deck } from "~/lib/deck";
import { deckFromLines, parseDeckList, type Line, type Zone } from "~/lib/decklist";

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
  const [importing, setImporting] = useState<{ name: string, text: string }>()
  const [progress, setProgress] = useState<{ done: number, total: number }>()
  const [review, setReview] = useState<{ deck: Deck, notes: string[] }>()
  const navigate = useNavigate()

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

  const closeImport = () => { setImporting(undefined); setReview(undefined); setProgress(undefined) }

  const saveImport = (name: string, deck: Deck) => {
    const made = createDeckWith(name.trim() || DEFAULT_NAME, deck)
    navigate(`/decks/${made.id}`)
  }

  const runImport = async () => {
    if (!importing || progress) return
    const parsed = parseDeckList(importing.text)
    const lines: (Line & { zone: Zone })[] = [
      ...(parsed.commander ? [{ ...parsed.commander, zone: "commander" as const }] : []),
      ...parsed.main.map((l) => ({ ...l, zone: "main" as const })),
      ...parsed.side.map((l) => ({ ...l, zone: "side" as const })),
    ]
    if (lines.length === 0 && parsed.problems.length === 0) return
    setProgress({ done: 0, total: lines.length })
    try {
      const { found, missing } = await cardsByName(lines, (done, total) => setProgress({ done, total }))
      const deck = deckFromLines(found)
      const notes = [...parsed.problems, ...missing.map((l) => `Card not found: ${l.count} ${l.name}`)]
      if (notes.length === 0) saveImport(importing.name, deck)
      else setReview({ deck, notes })
    } catch (e) {
      console.error("Could not import the deck", e)
      setReview({ deck: emptyDeck(), notes: ["Something went wrong looking up the cards."] })
    }
    setProgress(undefined)
  }

  const importForm = importing === undefined ? (
    <button type="button" className={styles.button} onClick={() => setImporting({ name: "", text: "" })}>Import</button>
  ) : review ? (
    <div className={styles.importer}>
      <p>These need a look before the deck is saved:</p>
      <ul className={styles.problems}>
        {review.notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => saveImport(importing.name, review.deck)}>Import anyway</button>
        <button type="button" className={styles.button} onClick={() => setReview(undefined)}>Back to the list</button>
      </div>
    </div>
  ) : (
    <form className={styles.importer} onSubmit={(e) => { e.preventDefault(); runImport() }}>
      <input
        className={styles.input}
        value={importing.name}
        onChange={(e) => setImporting({ ...importing, name: e.target.value })}
        placeholder={DEFAULT_NAME}
        aria-label="Deck name"
        disabled={!!progress}
      />
      <textarea
        className={styles.textarea}
        value={importing.text}
        onChange={(e) => setImporting({ ...importing, text: e.target.value })}
        placeholder={"Paste a deck list from Arena, MTGO or another site\n4 Opt\n20 Island"}
        aria-label="Deck list"
        disabled={!!progress}
        autoFocus
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.button} disabled={!!progress}>Import</button>
        <button type="button" className={styles.button} onClick={closeImport} disabled={!!progress}>Cancel</button>
        {progress && <span className={styles.meta} role="status">Finding cards… {progress.done} / {progress.total}</span>}
      </div>
    </form>
  )

  const newDeckForm =naming === undefined ? (
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
        <div className={styles.actions}>{importing === undefined && newDeckForm}{importing === undefined && importForm}</div>
        {importing !== undefined && importForm}
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
                            <button type="button" className={styles.button} onClick={() => duplicateDeck(d.id)}>Copy</button>
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
