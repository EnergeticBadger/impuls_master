import { useEffect, useRef, useState } from "react";
import styles from "./PrintingPicker.module.css";
import { oracleOf } from "~/lib/carddata";
import { scryfallGet } from "~/lib/scryfall";
import type { ScryfallCard } from "~/types";

type Loaded = { state: "loading" } | { state: "error" } | { state: "done"; prints: ScryfallCard[] }

// the search for every printing of a card, newest first. Saved cards are slimmed and have no
// prints_search_uri, so it goes by oracle id (the front face's for double-faced cards). The first page
// (up to 175) is enough.
export const printingsPath = (oracleId: string) =>
  `cards/search?order=released&unique=prints&q=${encodeURIComponent(`oracleid:${oracleId}`)}`

// the list of a card's printings for a deck row; choosing one calls onChoose and the caller closes it
export function PrintingPicker({ card, onChoose, onClose }: {
  card: ScryfallCard; onChoose: (to: ScryfallCard) => void; onClose: () => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" })
  const closeButton = useRef<HTMLButtonElement>(null)
  const oracleId = oracleOf(card)

  useEffect(() => {
    if (!oracleId) { setLoaded({ state: "error" }); return }
    const abort = new AbortController()
    setLoaded({ state: "loading" })
    scryfallGet(printingsPath(oracleId), { signal: abort.signal })
      .then((res: { object?: string; data?: ScryfallCard[] }) => {
        if (res?.object === "list" && Array.isArray(res.data)) setLoaded({ state: "done", prints: res.data })
        else setLoaded({ state: "error" })
      })
      .catch(() => { if (!abort.signal.aborted) setLoaded({ state: "error" }) })
    return () => abort.abort()
  }, [oracleId])

  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={styles.picker} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose() } }}>
      <div className={styles.top}>
        <span className={styles.heading}>Printings of {card.name}</span>
        <button ref={closeButton} type="button" className={styles.close} onClick={onClose}>Close</button>
      </div>
      <p role="status" className={styles.status}>
        {loaded.state === "loading" ? "Loading printings…"
          : loaded.state === "error" ? "Couldn't load the printings. Try again later."
          : loaded.prints.length === 0 ? "No printings found." : ""}
      </p>
      {loaded.state === "done" && loaded.prints.length > 0 && (
        <ul className={styles.list}>
          {loaded.prints.map((p) => {
            const current = p.id === card.id
            const usd = p.prices?.usd ?? p.prices?.usd_foil
            return (
              <li key={p.id}>
                <button type="button" className={styles.option} aria-current={current ? "true" : undefined}
                  onClick={() => (current ? onClose() : onChoose(p))}>
                  <span className={styles.set}>{p.set_name} #{p.collector_number}</span>
                  <span className={styles.price}>{usd ? `$${usd}` : "—"}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
