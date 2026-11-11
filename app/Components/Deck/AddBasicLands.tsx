import { useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { ManaText } from "~/Components/CardDetails/ManaText";
import { cardByName } from "~/lib/card";
import { basicLandSplit, deckSummary, type Deck } from "~/lib/deck";
import type { ScryfallCard } from "~/types";

const BASIC_NAMES = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" } as const

export function AddBasicLands({ deck, isCommander, onAdd }: {
  deck: Deck
  isCommander: boolean
  onAdd: (found: { card: ScryfallCard; count: number }[]) => void
}) {
  const [basicsOpen, setBasicsOpen] = useState(false)
  const [basicsText, setBasicsText] = useState<string>() // undefined: show the suggested number
  const [basicsBusy, setBasicsBusy] = useState(false)
  const [basicsMessage, setBasicsMessage] = useState<string>()

  // basic lands: 40% of the deck's size by default, less the lands it already has
  const suggestedBasics = Math.max(0, Math.round((isCommander ? 100 : 60) * 0.4) - deckSummary(deck).lands)
  const basicsCount = Math.max(0, Math.floor(Number(basicsText ?? suggestedBasics)) || 0)
  const basicsSplit = basicLandSplit(deck, basicsCount)

  const addBasics = async () => {
    if (basicsBusy || basicsSplit.length === 0) return
    setBasicsBusy(true)
    setBasicsMessage(undefined)
    try {
      const looked = await Promise.all(basicsSplit.map(async (p) => ({ count: p.count, card: await cardByName({ name: BASIC_NAMES[p.color] }) })))
      const found: { card: ScryfallCard; count: number }[] = []
      for (const f of looked) {
        if (!f.card) { setBasicsMessage("Couldn't look up the basic lands. Nothing was added."); return }
        found.push({ card: f.card, count: f.count })
      }
      onAdd(found)
      setBasicsOpen(false)
      setBasicsText(undefined)
    } catch {
      setBasicsMessage("Couldn't look up the basic lands. Nothing was added.")
    } finally {
      setBasicsBusy(false)
    }
  }

  return (
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
  )
}
