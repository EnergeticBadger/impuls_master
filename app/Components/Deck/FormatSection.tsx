import styles from "~/routes/DeckPage.module.css";
import { setDeckFormat } from "~/Components/Context/decks";
import { cardNamed, legalityProblems, type Deck } from "~/lib/deck";

const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander"] as const
const formatLabel = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)

// the "Format" select. It sits in the toolbar, apart from the problem list below, so it is its own export.
export function FormatPicker({ id, format }: { id: string; format?: string }) {
  return (
    <label className={styles.formatPick}>
      <span className={styles.srOnly}>Format</span>
      <select
        className={styles.select}
        value={format ?? ""}
        onChange={(e) => setDeckFormat(id, e.target.value)}
      >
        <option value="">No format</option>
        {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
      </select>
    </label>
  )
}

// "Legal in …" or the list of problems, each naming a card that links to its row (anchorOf gives the anchor)
export function FormatSection({ deck, format, anchorOf }: {
  id: string
  deck: Deck
  format?: string
  anchorOf: (name: string) => string | undefined
}) {
  const problems = format ? legalityProblems(deck, format) : []
  const names = [...(deck.commander ? [deck.commander] : []), ...(deck.partner ? [deck.partner] : []), ...deck.main, ...deck.side]
    .map((e) => e.card.name)
  return (
    <div className={styles.format}>
      {format && (problems.length === 0
        ? <p className={styles.legal}>Legal in {formatLabel(format)}</p>
        : (
          <ul className={styles.problems} aria-label={`Problems for ${formatLabel(format)}`}>
            {problems.map((p) => {
              const name = cardNamed(p, names)
              return (
                <li key={p}>
                  {name
                    ? <><a href={`#${anchorOf(name)}`} className={styles.link}>{name}</a>{p.slice(name.length)}</>
                    : p}
                </li>
              )
            })}
          </ul>
        ))}
    </div>
  )
}
