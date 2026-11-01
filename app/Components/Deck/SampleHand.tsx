import { useState } from "react";
import styles from "./SampleHand.module.css";
import type { Deck } from "~/lib/deck";
import { drawHand, libraryOf } from "~/lib/sampleHand";
import type { ScryfallCard } from "~/types";

const HAND_SIZE = 7

const imageOf = (card: ScryfallCard) => card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small

type Dealt = { hand: ScryfallCard[]; rest: ScryfallCard[]; size: number }

export function SampleHand({ deck }: { deck: Deck }) {
  const [dealt, setDealt] = useState<Dealt>()
  const library = libraryOf(deck)
  const empty = library.length === 0

  const deal = (size: number) => {
    const { hand, rest } = drawHand(library, size, Math.random)
    setDealt({ hand, rest, size })
  }

  const drawOne = () => setDealt((d) => d && d.rest.length > 0
    ? { ...d, hand: [...d.hand, d.rest[0]], rest: d.rest.slice(1) }
    : d)

  return (
    <section className={styles.wrap}>
      <h2>Sample hand</h2>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} disabled={empty} onClick={() => deal(HAND_SIZE)}>Draw 7</button>
        <button type="button" className={styles.button} disabled={empty || !dealt || dealt.size <= 1}
          onClick={() => dealt && deal(dealt.size - 1)}>Mulligan</button>
        <button type="button" className={styles.button} disabled={empty || !dealt || dealt.rest.length === 0}
          onClick={drawOne}>Draw a card</button>
      </div>
      {empty && <p className={styles.note}>Add cards to the main deck to draw a practice hand.</p>}
      {dealt && (
        <ul className={styles.hand}>
          {dealt.hand.map((card, i) => {
            const image = imageOf(card)
            return (
              <li key={`${i}:${card.name}`} className={styles.card}>
                {image
                  ? <img className={styles.image} src={image} alt={card.name} width={146} height={204} />
                  : <span className={styles.fallback}>{card.name}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
