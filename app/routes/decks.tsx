import { useEffect, useState, type ChangeEvent } from "react";
import { backupJson, readBackup } from "~/lib/savedDecks";
import { Link, useNavigate } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./Decks.module.css";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { SaveWarning } from "~/Components/Deck/SaveWarning";
import { createDeck, createDeckWith, decks, deleteDeck, duplicateDeck, loadDecks, renameDeck, restoreDecks } from "~/Components/Context/decks";
import { lookUpDeckList } from "~/Components/Deck/lookUpDeckList";
import { deckColors, emptyDeck, guessFormat, type Deck } from "~/lib/deck";
import { ManaText } from "~/Components/CardDetails/ManaText";
import { decksByName, decksByRecent, filterDecks } from "~/lib/savedDecks";
import { readDeckLinkHash } from "~/lib/decklist";

const DEFAULT_NAME = "Untitled deck";
const FILTER_FROM = 6;

// "commander" -> "Commander", as the deck page's format picker shows it
const formatLabel = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

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
  const [backupNote, setBackupNote] = useState<string>()
  const [filter, setFilter] = useState("")
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent")
  const navigate = useNavigate()

  // the decks are read from localStorage after the first render; don't flash the empty state before that
  const [ready, setReady] = useState(false)

  useEffect(() => { loadDecks(); setReady(true) }, [])

  // a shared deck link opens the importer filled in (it doesn't import by itself); then the hash goes
  useEffect(() => {
    if (!ready) return
    const shared = readDeckLinkHash(window.location.hash)
    if (!shared) return
    setImporting(shared)
    history.replaceState(null, "", window.location.pathname + window.location.search)
  }, [ready])

  // re-rendered by the snapshot above; the decks themselves are ref()s, so they are read unwrapped (as on the deck page)
  const list = decksByRecent(decks.list)
  const sorted = sortBy === "name" ? decksByName(list) : list
  // a name filter once the list is long enough to scroll on a phone
  const filtering = list.length >= FILTER_FROM
  const shown = filtering ? filterDecks(sorted, filter) : sorted

  const create = () => {
    createDeck(naming?.trim() || DEFAULT_NAME)
    setNaming(undefined)
  }

  const rename = () => {
    if (renaming && renaming.name.trim()) renameDeck(renaming.id, renaming.name.trim())
    setRenaming(undefined)
  }

  const backUp = () => {
    const blob = new Blob([backupJson(decks.list)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `impulse-caster-decks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const read = readBackup(await file.text())
      if (read.error) { setBackupNote(read.error); return }
      restoreDecks(read.decks)
      setBackupNote(`Restored ${read.decks.length} ${read.decks.length === 1 ? "deck" : "decks"}`)
    } catch (err) {
      console.error("Could not read the backup file", err)
      setBackupNote("Could not read that file.")
    }
  }

  const closeImport =() => { setImporting(undefined); setReview(undefined); setProgress(undefined) }

  const saveImport = (name: string, deck: Deck) => {
    const made = createDeckWith(name.trim() || DEFAULT_NAME, deck, guessFormat(deck))
    navigate(`/decks/${made.id}`)
  }

  const runImport = async () => {
    if (!importing || progress) return
    setProgress({ done: 0, total: 0 })
    try {
      const { deck, notes } = await lookUpDeckList(importing.text, (done, total) => setProgress({ done, total }))
      const empty = deck.main.length === 0 && deck.side.length === 0 && !deck.commander
      if (empty && notes.length === 0) { /* nothing to import */ }
      else if (notes.length === 0) saveImport(importing.name, deck)
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
        <SaveWarning />
        <h1 className={styles.title}>My decks</h1>
        {ready && list.length === 0 && <p className={styles.intro}>Decks are saved in this browser.</p>}
        <div className={styles.actions}>{importing === undefined && newDeckForm}{importing === undefined && importForm}</div>
        {importing !== undefined && importForm}
        {list.length >= 2 && (
          <div className={styles.sorting} role="group" aria-label="Sort decks by">
            <span>Sort:</span>
            <button type="button" className={styles.button} aria-pressed={sortBy === "recent"}
              onClick={() => setSortBy("recent")}>Recent</button>
            <button type="button" className={styles.button} aria-pressed={sortBy === "name"}
              onClick={() => setSortBy("name")}>Name</button>
          </div>
        )}
        {filtering && (
          <input
            type="search"
            className={styles.filter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter decks"
            aria-label="Filter decks"
          />
        )}
        {filtering && shown.length === 0 && <p className={styles.intro}>No decks match "{filter.trim()}".</p>}
        {shown.length > 0 && (
          <ul className={styles.list}>
            {shown.map((d) => {
              const cards = d.deck.main.reduce((n, e) => n + e.count, 0) + (d.deck.commander?.count ?? 0)
              const colors = deckColors(d.deck)
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
                        <Link to={`/decks/${d.id}`} className={styles.name} title={d.name}>{d.name}</Link>
                        <span className={styles.meta}>
                          {cards} {cards === 1 ? "card" : "cards"}
                          <span className={styles.colors} aria-label={colors.length ? `Colors: ${colors.join("")}` : "Colorless"}>
                            <ManaText text={colors.length ? colors.map((c) => `{${c}}`).join("") : "{C}"} />
                          </span>
                          {d.format && <span>{formatLabel(d.format)}</span>}
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
        <div className={styles.actions}>
          {list.length > 0 && (
            <button type="button" className={styles.button} onClick={backUp}>Back up decks</button>
          )}
          <label className={styles.button}>
            Restore from file
            <input type="file" accept=".json,application/json" onChange={restore} hidden />
          </label>
        </div>
        {backupNote && <p className={styles.meta} role="status">{backupNote}</p>}
      </main>
    </div>
  )
}
