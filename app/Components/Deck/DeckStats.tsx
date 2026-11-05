import styles from "./DeckStats.module.css";
import { ManaText } from "~/Components/CardDetails/ManaText";
import { colorCounts, manaCurve, type Deck } from "~/lib/deck";
import { curveBars } from "./deckStats";

const CHIPS = ["W", "U", "B", "R", "G", "C"] as const

export function DeckStats({ deck }: { deck: Deck }) {
  const bars = curveBars(manaCurve(deck))
  const counts = colorCounts(deck)
  const chips = CHIPS.filter((c) => counts[c] > 0)

  return (
    <section className={styles.stats}>
      <h2 className={styles.heading}>Mana curve</h2>
      <div className={styles.curve} role="img" aria-label={`Mana curve: ${bars.map((b) => `${b.count} at ${b.label}`).join(", ")}`}>
        {bars.map((b) => (
          <div key={b.label} className={styles.column}>
            <span className={styles.value}>{b.count}</span>
            <div className={styles.track}>
              <div className={styles.bar} style={{ height: `${b.pct}%` }} />
            </div>
            <span className={styles.label}>{b.label}</span>
          </div>
        ))}
      </div>

      <h2 className={styles.heading}>Colors</h2>
      {chips.length === 0 ? (
        <p className={styles.none}>No spells yet.</p>
      ) : (
        <ul className={styles.chips}>
          {chips.map((c) => (
            <li key={c} className={styles.chip}>
              {c === "C" ? <span>Colorless</span> : <ManaText text={`{${c}}`} />}
              <span>{counts[c]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
