import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useSnapshot } from "valtio";
import styles from "./DeckPage.module.css";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { ManaText } from "~/Components/CardDetails/ManaText";
import { decks, loadDecks, renameDeck, setCurrentDeck, updateDeck } from "~/Components/Context/decks";
import { cardPath } from "~/lib/card";
import { addCard, groupByType, removeCard, type Deck, type DeckEntry, type DeckZone } from "~/lib/deck";

export function meta() {
  return [
    { title: "Deck | Impulse Caster" },
    { name: "theme-color", content: "#1a1515" },
  ]
}

type Section = "main" | "side" | "commander"

const total = (entries: DeckEntry[]) => entries.reduce((n, e) => n + e.count, 0)

const manaCostOf = (entry: DeckEntry) => entry.card.mana_cost ?? entry.card.card_faces?.map(f => f.mana_cost).filter(Boolean).join(" // ") ?? ""

const smallImage = (entry: DeckEntry) => entry.card.image_uris?.small ?? entry.card.card_faces?.[0]?.image_uris?.small

// out of one zone and into the other
const move = (deck: Deck, entry: DeckEntry, from: Section): Deck => {
  const to: DeckZone = from === "main" ? "side" : "main"
  const without = from === "commander" ? { ...deck, commander: undefined } : removeCard(deck, entry.card, from, entry.count)
  return addCard(without, entry.card, to, entry.count)
}

export default function DeckPage() {
  const { id = "" } = useParams()
  useSnapshot(decks) // re-render on change; the decks themselves are ref()s, so they're read unwrapped
  const [ready, setReady] = useState(false)
  const [name, setName] = useState<string>()
  const [preview, setPreview] = useState<string>()

  useEffect(() => { loadDecks(); setReady(true) }, [])

  const saved = decks.list.find((d) => d.id === id)

  useEffect(() => { if (ready && saved) setCurrentDeck(id) }, [ready, saved?.id, id])

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
  const commit = () => {
    const trimmed = name?.trim()
    if (trimmed && trimmed !== saved.name) renameDeck(id, trimmed)
    setName(undefined)
  }

  const row = (entry: DeckEntry, section: Section) => {
    const key = `${section}:${entry.card.name}`
    const image = smallImage(entry)
    const cost = manaCostOf(entry)
    return (
      <li key={key} className={styles.row}>
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
                onClick={() => updateDeck(id, (d) => removeCard(d, entry.card, section))}>−</button>
              <button type="button" className={styles.step} aria-label={`Add one ${entry.card.name}`}
                onClick={() => updateDeck(id, (d) => addCard(d, entry.card, section))}>+</button>
            </>
          )}
          <button type="button" className={styles.button}
            onClick={() => updateDeck(id, (d) => move(d, entry, section))}>
            {section === "main" ? "To sideboard" : "To main"}
          </button>
        </div>
        {preview === key && image && <img className={styles.preview} src={image} alt={entry.card.name} width={146} height={204} />}
      </li>
    )
  }

  const groups = groupByType({ ...deck, commander: undefined })
  const mainCount = total(deck.main) + (deck.commander?.count ?? 0)

  return (
    <div>
      <SiteHeader />
      <main className={styles.page}>
        <input
          className={styles.nameInput}
          value={name ?? saved.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
          aria-label="Deck name"
        />
        <p className={styles.totals}>
          <span>Main deck: {mainCount}</span>
          <span>Sideboard: {total(deck.side)}</span>
          <Link to="/decks" className={styles.link}>All decks</Link>
        </p>

        {deck.commander && (
          <section>
            <h2 className={styles.heading}>Commander</h2>
            <ul className={styles.rows}>{row(deck.commander, "commander")}</ul>
          </section>
        )}

        {groups.length === 0 && <p className={styles.empty}>No cards yet. Add some from a card page.</p>}
        {groups.map((g) => (
          <section key={g.group}>
            <h2 className={styles.heading}>{g.group} ({total(g.entries)})</h2>
            <ul className={styles.rows}>{g.entries.map((e) => row(e, "main"))}</ul>
          </section>
        ))}

        {deck.side.length > 0 && (
          <section>
            <h2 className={styles.heading}>Sideboard ({total(deck.side)})</h2>
            <ul className={styles.rows}>{deck.side.map((e) => row(e, "side"))}</ul>
          </section>
        )}
      </main>
    </div>
  )
}
