import { useState } from "react";
import styles from "./DrawOdds.module.css";
import type { Deck } from "~/lib/deck";
import { atLeastOneChance, cardsSeen, libraryOf } from "~/lib/sampleHand";

const TURNS = Array.from({ length: 10 }, (_, i) => i + 1)

// "how likely am I to see my 4-of by turn 3?", with exact odds for one main-deck card
export function DrawOdds({ deck }: { deck: Deck }) {
  const [picked, setPicked] = useState<string>()
  const [turn, setTurn] = useState(1)
  const [onThePlay, setOnThePlay] = useState(true)

  const deckSize = libraryOf(deck).length
  if (deckSize === 0) return null

  // rows by name, so two printings of one card count together
  const counts = new Map<string, number>()
  for (const e of deck.main) counts.set(e.card.name, (counts.get(e.card.name) ?? 0) + e.count)
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b))
  const name = picked !== undefined && counts.has(picked) ? picked : names[0]
  const copies = counts.get(name) ?? 0
  const chance = atLeastOneChance(deckSize, copies, cardsSeen(turn, onThePlay))

  return (
    <section className={styles.wrap}>
      <h2>Draw odds</h2>
      <div className={styles.controls}>
        <select className={styles.select} aria-label="Card" value={name} onChange={(e) => setPicked(e.target.value)}>
          {names.map((n) => <option key={n} value={n}>{n} ({counts.get(n)})</option>)}
        </select>
        <select className={styles.select} aria-label="By turn" value={turn} onChange={(e) => setTurn(Number(e.target.value))}>
          {TURNS.map((t) => <option key={t} value={t}>Turn {t}</option>)}
        </select>
        <select className={styles.select} aria-label="On the play or on the draw" value={onThePlay ? "play" : "draw"}
          onChange={(e) => setOnThePlay(e.target.value === "play")}>
          <option value="play">On the play</option>
          <option value="draw">On the draw</option>
        </select>
      </div>
      <p className={styles.result}>
        {(chance * 100).toFixed(1)}% to draw at least one {name} ({copies} of {deckSize}) by turn {turn} {onThePlay ? "on the play" : "on the draw"}.
      </p>
    </section>
  )
}
