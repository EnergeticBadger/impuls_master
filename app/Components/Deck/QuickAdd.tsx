import { useEffect, useRef, useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { cardByName } from "~/lib/card";
import { searchCards } from "~/lib/scryfall";
import { quickAddLine } from "~/lib/decklist";
import type { DeckZone } from "~/lib/deck";
import type { ScryfallCard } from "~/types";

export function QuickAdd({ onAdd }: { onAdd: (card: ScryfallCard, zone: DeckZone, count: number) => void }) {
  const [quickText, setQuickText] = useState("")
  const [quickZone, setQuickZone] = useState<DeckZone>("main")
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickMessage, setQuickMessage] = useState<string>()
  const quickInput = useRef<HTMLInputElement>(null)
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<string>()

  // as you type, find cards by name and show them to pick from
  const wanted = quickAddLine(quickText)?.name.trim() ?? ""
  useEffect(() => {
    if (wanted.length < 2) { setResults([]); setSearching(false); return }
    const ctl = new AbortController()
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const body = await searchCards(new URLSearchParams({ q: wanted, unique: "cards", order: "name" }), { signal: ctl.signal })
        setResults(Array.isArray(body?.data) ? body.data.slice(0, 24) : [])
      } catch {
        if (!ctl.signal.aborted) setResults([])
      }
      if (!ctl.signal.aborted) setSearching(false)
    }, 250)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [wanted])

  const pick = (card: ScryfallCard) => {
    onAdd(card, quickZone, quickAddLine(quickText)?.count ?? 1)
    setAdded(card.name)
    quickInput.current?.focus()
  }

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
      onAdd(card, quickZone, line.count)
      setQuickText("")
    } catch {
      setQuickMessage(`No card named ${line.name}.`)
    } finally {
      setQuickBusy(false)
      setTimeout(() => quickInput.current?.focus(), 0)
    }
  }

  return (
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
      {wanted.length >= 2 && (
        <div className={styles.results}>
          <p className={styles.quickMessage} role="status">
            {added ? `Added ${added}. ` : ""}{searching ? "Searching…" : results.length === 0 ? `No cards match "${wanted}".` : "Click a card to add it."}
          </p>
          {results.length > 0 && (
            <ul className={styles.resultGrid}>
              {results.map((c) => {
                const img = c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small
                return (
                  <li key={c.id}>
                    <button type="button" className={styles.result} aria-label={`Add ${c.name}`} onClick={() => pick(c)}>
                      {img ? <img src={img} alt="" width={146} height={204} loading="lazy" /> : <span>{c.name}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}
