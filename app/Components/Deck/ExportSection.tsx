import { useEffect, useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { shareLink } from "~/lib/card";
import { deckLinkHash, formatDeckList, type DeckListStyle } from "~/lib/decklist";
import type { Deck } from "~/lib/deck";

const EXPORT_BUTTONS: { style: DeckListStyle; label: string }[] = [
  { style: "text", label: "Copy as text" },
  { style: "arena", label: "Copy for Arena" },
  { style: "mtgo", label: "Copy for MTGO" },
]

const SHARE_LABELS = { idle: "Share link", shared: "Shared", copied: "Link copied", failed: "Couldn't share" }

// a file name from the deck name: letters, digits, dashes and underscores only
const fileNameOf = (name: string) => `${name.trim().replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-") || "deck"}.txt`

// the Export section: copy the list in each style, or download the MTGO one. Holds its own state and
// hooks, so it stays out of DeckPage's early returns.
export function ExportSection({ deck, name }: { deck: Deck; name: string }) {
  const [copied, setCopied] = useState<DeckListStyle>()
  const [fallback, setFallback] = useState<{ style: DeckListStyle; text: string }>()
  const [url, setUrl] = useState<string>()
  const [shared, setShared] = useState<"shared" | "copied" | "failed">()

  const mtgoText = formatDeckList(deck, "mtgo")

  // the download is a Blob URL, made for the current list and released when it changes
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([mtgoText], { type: "text/plain" }))
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [mtgoText])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(undefined), 2000) // "Copied" shows for 2 seconds
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!shared) return
    const timer = setTimeout(() => setShared(undefined), 2000)
    return () => clearTimeout(timer)
  }, [shared])

  async function share() {
    setShared(await shareLink(`/decks${deckLinkHash(name, deck)}`, name))
  }

  async function copy(style: DeckListStyle) {
    const text = formatDeckList(deck, style)
    try {
      await navigator.clipboard.writeText(text)
      setFallback(undefined)
      setCopied(style)
    } catch (err) {
      console.error("Failed to copy: ", err)
      setFallback({ style, text })
    }
  }

  return (
    <section>
      <h2 className={styles.heading}>Export</h2>
      <div className={styles.buttons}>
        {EXPORT_BUTTONS.map(({ style, label }) => (
          <button key={style} type="button" className={styles.button} onClick={() => copy(style)}>
            {copied === style ? "Copied" : label}
          </button>
        ))}
        {url && (
          <a href={url} download={fileNameOf(name)} className={styles.button}>Download .txt</a>
        )}
        <button type="button" className={styles.button} onClick={share} title="Share a link that imports this deck" aria-live="polite">
          {SHARE_LABELS[shared ?? "idle"]}
        </button>
      </div>
      {fallback && (
        <div className={styles.fallback}>
          <p>Copying didn't work. Select the list below and copy it by hand.</p>
          <textarea
            className={styles.fallbackText}
            readOnly
            value={fallback.text}
            aria-label={`Deck list, ${EXPORT_BUTTONS.find((b) => b.style === fallback.style)?.label ?? ""}`}
            onFocus={(e) => e.currentTarget.select()}
            rows={Math.min(20, fallback.text.split("\n").length + 1)}
          />
        </div>
      )}
    </section>
  )
}
