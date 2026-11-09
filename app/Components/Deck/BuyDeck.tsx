import { useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { tcgplayerDeckLink } from "~/lib/affiliate";
import { deckPrice, type Deck } from "~/lib/deck";

export function BuyDeck({ deck }: { deck: Deck }) {
  const [withSide, setWithSide] = useState(false)
  const buyEntries = [...(deck.commander ? [deck.commander] : []), ...deck.main, ...(withSide ? deck.side : [])]
  const price = deckPrice(deck, { side: withSide, currency: "usd" })

  if (buyEntries.length === 0) return null

  return (
    <section>
      {deck.side.length > 0 && (
        <label className={styles.checkLabel}>
          <input type="checkbox" className={styles.checkbox} checked={withSide} onChange={(e) => setWithSide(e.target.checked)} />
          Include the sideboard
        </label>
      )}
      <p>
        <a
          className={styles.link}
          href={tcgplayerDeckLink(buyEntries.map((e) => ({ count: e.count, name: e.card.name })))}
          target="_blank"
          rel="noopener sponsored"
        >Buy this deck on TCGplayer</a>
      </p>
      <p>
        About ${price.total.toFixed(2)}
        {price.missing.length > 0 && (
          <>{" "}<span title={price.missing.join(", ")}>({price.missing.length} {price.missing.length === 1 ? "card has" : "cards have"} no price)</span></>
        )}
      </p>
      <p className={styles.empty}>An estimate from the prices of the printings in your deck.</p>
      <p className={styles.empty}>We may earn a commission if you buy through this link. It costs you nothing extra.</p>
    </section>
  )
}
