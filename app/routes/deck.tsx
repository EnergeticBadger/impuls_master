import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./DeckPage.module.css";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { SaveWarning } from "~/Components/Deck/SaveWarning";
import { ManaText } from "~/Components/CardDetails/ManaText";
import { DeckStats } from "~/Components/Deck/DeckStats";
import { decks, loadDecks, renameDeck, setCurrentDeck, setDeckFormat, updateDeck } from "~/Components/Context/decks";
import { SampleHand } from "~/Components/Deck/SampleHand";
import { DrawOdds } from "~/Components/Deck/DrawOdds";
import { DeckNotes } from "~/Components/Deck/DeckNotes";
import { deckGrouping, loadDeckGrouping } from "~/Components/Context/deckGrouping";
import { loadPriceCurrency } from "~/Components/Context/priceCurrency";
import { PrintingPicker } from "~/Components/Deck/PrintingPicker";
import { cardByName, cardPath } from "~/lib/card";
import { lookUpDeckList } from "~/Components/Deck/lookUpDeckList";
import { formatDeckList, quickAddLine } from "~/lib/decklist";
import { ExportSection } from "~/Components/Deck/ExportSection";
import { BuyDeck } from "~/Components/Deck/BuyDeck";
import { canUndo, record, undo, type History } from "~/lib/history";
import { addCard, basicLandSplit, canBeCommander, deckSummary, groupByManaValue, groupByType, legalityProblems, manaCostOf, removeCard, replacePrinting, setCommander, sortEntries, type Deck, type DeckEntry, type DeckZone } from "~/lib/deck";
import type { ScryfallCard } from "~/types";

export function meta() {
  return [
    { title: "Deck | Impulse Caster" },
    { name: "theme-color", content: "#1a1515" },
  ]
}

type Section = "main" | "side" | "commander"

const total = (entries: DeckEntry[]) => entries.reduce((n, e) => n + e.count, 0)

const smallImage = (entry: DeckEntry) => entry.card.image_uris?.small ?? entry.card.card_faces?.[0]?.image_uris?.small

// out of one zone and into the other
const move = (deck: Deck, entry: DeckEntry, from: Section): Deck => {
  const to: DeckZone = from === "main" ? "side" : "main"
  const without = from === "commander" ? { ...deck, commander: undefined } : removeCard(deck, entry.card, from, entry.count)
  return addCard(without, entry.card, to, entry.count)
}

const removeAsCommander = (deck: Deck): Deck => {
  if (!deck.commander) return deck
  return addCard({ ...deck, commander: undefined }, deck.commander.card, "main", deck.commander.count)
}

const BASIC_NAMES = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" } as const

const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander"] as const
const formatLabel = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)

const anchorOf = (name: string) => `card-${name.replace(/[^a-z0-9]+/gi, "-")}`

export default function DeckPage() {
  const { id = "" } = useParams()
  useSnapshot(decks) // re-render on change; the decks themselves are ref()s, so they're read unwrapped
  const [ready, setReady] = useState(false)
  const [name, setName] = useState<string>()
  const [preview, setPreview] = useState<string>()
  // the row whose printing list is open: "<section>:<card id>"
  const [printingsOf, setPrintingsOf] = useState<string>()
  const [past, setPast] = useState<{ id: string; past: Deck[] }>({ id, past: [] })
  const [status, setStatus] = useState("")
  const [quickText, setQuickText] = useState("")
  const [quickZone, setQuickZone] = useState<DeckZone>("main")
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickMessage, setQuickMessage] = useState<string>()
  const quickInput = useRef<HTMLInputElement>(null)
  const [basicsOpen, setBasicsOpen] = useState(false)
  const [basicsText, setBasicsText] = useState<string>() // undefined: show the suggested number
  const [basicsBusy, setBasicsBusy] = useState(false)
  const [basicsMessage, setBasicsMessage] = useState<string>()
  const [editing, setEditing] = useState<{ text: string; notes?: string[]; next?: Deck }>()
  const [editProgress, setEditProgress] = useState<{ done: number; total: number }>()
  const latest = useRef<{ id: string; deck: Deck; past: Deck[] }>({ id, deck: undefined as unknown as Deck, past: [] })

  useEffect(() => { loadDecks(); loadDeckGrouping(); loadPriceCurrency(); setReady(true) }, [])
  const grouping = useSnapshot(deckGrouping).by
  useEffect(() => { setStatus("") }, [id])

  const saved = decks.list.find((d) => d.id === id)
  // opening another deck starts a fresh history
  const earlier = past.id === id ? past.past : []

  useEffect(() => { if (ready && saved) setCurrentDeck(id) }, [ready, saved?.id, id])

  // meta() can't see localStorage, so the tab title follows the deck name once it's loaded
  useEffect(() => {
    if (!ready) return
    document.title = saved ? `${saved.name} | Impulse Caster` : "No deck here | Impulse Caster"
  }, [ready, saved?.name])

  if (!ready) return <div><SiteHeader /></div>

  if (!saved) {
    return (
      <div>
        <SiteHeader />
        <main className={styles.page}>
          <h1 className={styles.title}>No deck here</h1>
          <p><Link to="/decks" className={styles.link}>Back to my decks</Link></p>
        </main>
      </div>
    )
  }

  const deck = saved.deck
  const history: History<Deck> = { past: earlier, present: deck }

  // every change made on this page goes through here, so it can be undone
  // (reads the latest deck and past from a ref, so a call after an await isn't working from a stale render)
  latest.current = { id, deck, past: earlier }
  const change = (fn: (d: Deck) => Deck) => {
    const cur = latest.current
    const next = fn(cur.deck)
    const recorded = record({ past: cur.past, present: cur.deck }, next).past
    latest.current = { id: cur.id, deck: next, past: recorded }
    setPast({ id: cur.id, past: recorded })
    setStatus("")
    updateDeck(cur.id, fn)
  }
  const undoChange = () => {
    const cur = latest.current
    const h: History<Deck> = { past: cur.past, present: cur.deck }
    if (!canUndo(h)) return
    const previous = undo(h)
    latest.current = { id: cur.id, deck: previous.present, past: previous.past }
    setPast({ id, past: previous.past })
    updateDeck(id, () => previous.present)
    setStatus("Undone")
  }

  const commit = () => {
    const trimmed = name?.trim()
    if (trimmed && trimmed !== saved.name) renameDeck(id, trimmed)
    setName(undefined)
  }

  const format = saved.format
  const isCommander = format === "commander"
  const problems = format ? legalityProblems(deck, format) : []
  // a card's row is the first one it appears in (commander, then main, then sideboard)
  const rowOrder = [...(deck.commander ? [deck.commander] : []), ...deck.main, ...deck.side]
  const anchored = new Map<string, string>()
  for (const e of rowOrder) if (!anchored.has(e.card.name)) anchored.set(e.card.name, anchorOf(e.card.name))
  const cardNamed = (problem: string) =>
    [...anchored.keys()].filter((n) => problem.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0]
  const rowSeen = new Set<string>()

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (quickBusy) return
    const line = quickAddLine(quickText)
    if (!line) { setQuickMessage("Type a card name, like 4 Lightning Bolt."); return }
    setQuickBusy(true)
    setQuickMessage(undefined)
    try {
      const card = await cardByName(line)
      if (!card) { setQuickMessage(`No card named ${line.name}.`); return }
      change((d) => addCard(d, card, quickZone, line.count))
      setQuickText("")
    } catch {
      setQuickMessage(`No card named ${line.name}.`)
    } finally {
      setQuickBusy(false)
      setTimeout(() => quickInput.current?.focus(), 0)
    }
  }

  // basic lands: 40% of the deck's size by default, less the lands it already has
  const suggestedBasics = Math.max(0, Math.round((isCommander ? 100 : 60) * 0.4) - deckSummary(deck).lands)
  const basicsCount = Math.max(0, Math.floor(Number(basicsText ?? suggestedBasics)) || 0)
  const basicsSplit = basicLandSplit(deck, basicsCount)

  const addBasics = async () => {
    if (basicsBusy || basicsSplit.length === 0) return
    setBasicsBusy(true)
    setBasicsMessage(undefined)
    try {
      const found = await Promise.all(basicsSplit.map(async (p) => ({ count: p.count, card: await cardByName({ name: BASIC_NAMES[p.color] }) })))
      const missing = found.find((f) => !f.card)
      if (missing) { setBasicsMessage("Couldn't look up the basic lands. Nothing was added."); return }
      change((d) => found.reduce((acc, f) => (f.card ? addCard(acc, f.card, "main", f.count) : acc), d))
      setBasicsOpen(false)
      setBasicsText(undefined)
    } catch {
      setBasicsMessage("Couldn't look up the basic lands. Nothing was added.")
    } finally {
      setBasicsBusy(false)
    }
  }

  const saveText = async () => {
    if (!editing || editProgress) return
    setEditProgress({ done: 0, total: 0 })
    try {
      const { deck: next, notes } = await lookUpDeckList(editing.text, (done, total) => setEditProgress({ done, total }), latest.current.deck)
      if (notes.length === 0) { change(() => next); setEditing(undefined) }
      else setEditing({ ...editing, next, notes })
    } catch (e) {
      console.error("Could not look up the deck list", e)
      setEditing({ ...editing, next: undefined, notes: ["Something went wrong looking up the cards."] })
    }
    setEditProgress(undefined)
  }

  const row = (entry: DeckEntry, section: Section) => {
    const key = `${section}:${entry.card.name}`
    const pickerKey = `${section}:${entry.card.id}`
    const image = smallImage(entry)
    const cost = manaCostOf(entry.card)
    const rowId = rowSeen.has(entry.card.name) ? undefined : anchorOf(entry.card.name)
    rowSeen.add(entry.card.name)
    return (
      <li key={key} id={rowId} className={styles.row}>
        <div className={styles.line}>
          <span className={styles.count}>{entry.count}</span>
          <span className={styles.cardName}>
            <Link
              to={cardPath(entry.card)}
              className={styles.link}
              onMouseEnter={() => setPreview(key)}
              onMouseLeave={() => setPreview((p) => (p === key ? undefined : p))}
              onFocus={() => setPreview(key)}
              onBlur={() => setPreview((p) => (p === key ? undefined : p))}
            >{entry.card.name}</Link>
            {image && (
              <button
                type="button"
                className={styles.peek}
                aria-label={`Show image of ${entry.card.name}`}
                aria-pressed={preview === key}
                onClick={() => setPreview((p) => (p === key ? undefined : key))}
              >img</button>
            )}
          </span>
          <span className={styles.cost}>{cost && <ManaText text={cost} />}</span>
        </div>
        <div className={styles.buttons}>
          {section !== "commander" && (
            <>
              <button type="button" className={styles.step} aria-label={`Remove one ${entry.card.name}`}
                onClick={() => change((d) => removeCard(d, entry.card, section))}>−</button>
              <button type="button" className={styles.step} aria-label={`Add one ${entry.card.name}`}
                onClick={() => change((d) => addCard(d, entry.card, section))}>+</button>
            </>
          )}
          {section === "commander" ? (
            <button type="button" className={styles.button}
              onClick={() => change(removeAsCommander)}>Remove as commander</button>
          ) : (
            <button type="button" className={styles.button}
              onClick={() => change((d) => move(d, entry, section))}>
              {section === "main" ? "To sideboard" : "To main"}
            </button>
          )}
          {isCommander && section === "main" && canBeCommander(entry.card) && (
            <button type="button" className={styles.button} aria-label={`Make ${entry.card.name} the commander`}
              onClick={() => change((d) => setCommander(d, entry.card))}>Make commander</button>
          )}
          <button type="button" className={styles.button} aria-label={`Change printing of ${entry.card.name}`}
            aria-expanded={printingsOf === pickerKey}
            onClick={() => setPrintingsOf((p) => (p === pickerKey ? undefined : pickerKey))}>Printing</button>
          {section !== "commander" && (
            <button type="button" className={styles.button} aria-label={`Remove all ${entry.card.name}`}
              onClick={() => change((d) => removeCard(d, entry.card, section, entry.count))}>Remove</button>
          )}
        </div>
        {printingsOf === pickerKey && (
          <PrintingPicker
            card={entry.card}
            onClose={() => setPrintingsOf(undefined)}
            onChoose={(to) => {
              change((d) => replacePrinting(d, section, entry.card, to))
              setPrintingsOf(undefined)
            }}
          />
        )}
        {preview === key && image && <img className={styles.preview} src={image} alt={entry.card.name} width={146} height={204} />}
      </li>
    )
  }

  // the main deck's sections, by type or by mana value (the toggle above them)
  const groups = grouping === "manaValue"
    ? groupByManaValue(deck).map((g) => ({ key: g.group, heading: g.group === "Lands" ? "Lands" : `Mana value ${g.group}`, entries: g.entries }))
    : groupByType({ ...deck, commander: undefined }).map((g) => ({ key: g.group, heading: g.group, entries: g.entries }))
  const mainCount = total(deck.main) + (deck.commander?.count ?? 0)

  return (
    <div>
      <SiteHeader />
      <main className={styles.page}>
        <SaveWarning />
        <input
          className={styles.nameInput}
          value={name ?? saved.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
          aria-label="Deck name"
        />
        <form className={styles.quickAdd} onSubmit={quickAdd}>
          <input
            ref={quickInput}
            className={styles.quickInput}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder="4 Lightning Bolt"
            aria-label="Add a card"
          />
          <select
            className={styles.quickZone}
            value={quickZone}
            onChange={(e) => setQuickZone(e.target.value as DeckZone)}
            aria-label="Add to"
          >
            <option value="main">Main</option>
            <option value="side">Sideboard</option>
          </select>
          <button type="submit" className={styles.button} disabled={quickBusy}>{quickBusy ? "Adding…" : "Add"}</button>
          {quickMessage && <p className={styles.quickMessage} role="status">{quickMessage}</p>}
        </form>
        <div className={styles.basics}>
          <button type="button" className={styles.button} aria-expanded={basicsOpen} onClick={() => setBasicsOpen(!basicsOpen)}>Add basic lands</button>
          {basicsOpen && (
            <form className={styles.basicsForm} onSubmit={(e) => { e.preventDefault(); addBasics() }}>
              <input
                className={styles.basicsInput}
                type="number"
                min={0}
                inputMode="numeric"
                value={basicsText ?? String(suggestedBasics)}
                onChange={(e) => setBasicsText(e.target.value)}
                aria-label="Number of basic lands"
              />
              <span className={styles.basicsSplit}>
                {basicsSplit.length === 0
                  ? "No colored mana symbols in the deck yet."
                  : basicsSplit.map((p, i) => (
                    <span key={p.color}>{i > 0 && " · "}<ManaText text={`{${p.color}}`} /> {p.count}</span>
                  ))}
              </span>
              <button type="submit" className={styles.button} disabled={basicsBusy || basicsSplit.length === 0}>{basicsBusy ? "Adding…" : "Add"}</button>
              {basicsMessage && <p className={styles.quickMessage} role="status">{basicsMessage}</p>}
            </form>
          )}
        </div>
        <p className={styles.totals}>
          <span>Main deck: {mainCount}</span>
          <span>Sideboard: {total(deck.side)}</span>
          <button type="button" className={styles.button} disabled={!canUndo(history)} onClick={undoChange}>Undo</button>
          {!editing && (
            <button type="button" className={styles.button} onClick={() => setEditing({ text: formatDeckList(deck, "text") })}>Edit as text</button>
          )}
          <Link to="/decks" className={styles.link}>All decks</Link>
        </p>
        <p role="status" className={styles.empty}>{status}</p>

        {editing ? (
          <section className={styles.editor}>
            {editing.notes ? (
              <>
                <p>These need a look before the deck is saved:</p>
                <ul>{editing.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                <div className={styles.buttons}>
                  {editing.next && (
                    <button type="button" className={styles.button}
                      onClick={() => { const next = editing.next as Deck; change(() => next); setEditing(undefined) }}>Save anyway</button>
                  )}
                  <button type="button" className={styles.button} onClick={() => setEditing({ text: editing.text })}>Back to the list</button>
                </div>
              </>
            ) : (
              <>
                <textarea
                  className={styles.editText}
                  value={editing.text}
                  onChange={(e) => setEditing({ text: e.target.value })}
                  aria-label="Deck list"
                  rows={Math.min(24, editing.text.split("\n").length + 2)}
                  disabled={!!editProgress}
                  autoFocus
                />
                <div className={styles.buttons}>
                  <button type="button" className={styles.button} onClick={saveText} disabled={!!editProgress}>Save</button>
                  <button type="button" className={styles.button} onClick={() => setEditing(undefined)} disabled={!!editProgress}>Cancel</button>
                  {editProgress && <span className={styles.empty} role="status">Finding cards… {editProgress.done} / {editProgress.total}</span>}
                </div>
              </>
            )}
          </section>
        ) : (
        <>
        <DeckStats deck={deck} />

        <div className={styles.format}>
          <label>
            Format{" "}
            <select
              className={styles.select}
              value={format ?? ""}
              onChange={(e) => setDeckFormat(id, e.target.value)}
            >
              <option value="">No format</option>
              {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
          </label>
          {format && (problems.length === 0
            ? <p className={styles.legal}>Legal in {formatLabel(format)}</p>
            : (
              <ul className={styles.problems} aria-label={`Problems for ${formatLabel(format)}`}>
                {problems.map((p) => {
                  const name = cardNamed(p)
                  return (
                    <li key={p}>
                      {name
                        ? <><a href={`#${anchored.get(name)}`} className={styles.link}>{name}</a>{p.slice(name.length)}</>
                        : p}
                    </li>
                  )
                })}
              </ul>
            ))}
        </div>

        {deck.commander && (
          <section>
            <h2 className={styles.heading}>Commander</h2>
            <ul className={styles.rows}>{row(deck.commander, "commander")}</ul>
          </section>
        )}

        {groups.length === 0 && (
          <p className={styles.empty}>
            No cards yet. <Link to="/" className={styles.link}>Search for cards</Link> and press Add to deck.
          </p>
        )}
        {groups.length > 0 && (
          <div className={styles.grouping} role="group" aria-label="Group the main deck by">
            <span>Group by:</span>
            <button type="button" className={styles.button} aria-pressed={grouping === "type"}
              onClick={() => { deckGrouping.by = "type" }}>Type</button>
            <button type="button" className={styles.button} aria-pressed={grouping === "manaValue"}
              onClick={() => { deckGrouping.by = "manaValue" }}>Mana value</button>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className={styles.heading}>{g.heading} ({total(g.entries)})</h2>
            <ul className={styles.rows}>{g.entries.map((e) => row(e, "main"))}</ul>
          </section>
        ))}

        <SampleHand deck={deck} />
        <DrawOdds deck={deck} />

        {deck.side.length > 0 && (
          <section>
            <h2 className={styles.heading}>Sideboard ({total(deck.side)})</h2>
            <ul className={styles.rows}>{sortEntries(deck.side).map((e) => row(e, "side"))}</ul>
          </section>
        )}

        <DeckNotes key={saved.id} id={saved.id} notes={saved.notes} />

        <ExportSection deck={deck} name={saved.name} />

        <BuyDeck deck={deck} />
        </>
        )}
      </main>
    </div>
  )
}
