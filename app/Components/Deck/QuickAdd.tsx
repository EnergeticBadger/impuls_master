import { useRef, useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { cardByName } from "~/lib/card";
import { quickAddLine } from "~/lib/decklist";
import type { DeckZone } from "~/lib/deck";
import type { ScryfallCard } from "~/types";

export function QuickAdd({ onAdd }: { onAdd: (card: ScryfallCard, zone: DeckZone, count: number) => void }) {
  const [quickText, setQuickText] = useState("")
  const [quickZone, setQuickZone] = useState<DeckZone>("main")
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickMessage, setQuickMessage] = useState<string>()
  const quickInput = useRef<HTMLInputElement>(null)

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
    </form>
  )
}
