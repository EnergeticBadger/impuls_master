import { useState } from "react";
import styles from "./DeckNotes.module.css";
import { setDeckNotes } from "~/Components/Context/decks";

export const NOTES_MAX = 2000

// free-text notes on a deck; saved when the box loses focus, not on every keystroke
export function DeckNotes({ id, notes }: { id: string; notes?: string }) {
  const [draft, setDraft] = useState<string>()
  const save = () => {
    if (draft !== undefined && draft !== (notes ?? "")) setDeckNotes(id, draft)
    setDraft(undefined)
  }
  return (
    <section className={styles.notes}>
      <h2 className={styles.heading}>Notes</h2>
      <textarea
        className={styles.textarea}
        aria-label="Deck notes"
        placeholder="The deck's plan, a sideboard guide, cards to buy…"
        maxLength={NOTES_MAX}
        value={draft ?? notes ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
      />
    </section>
  )
}
