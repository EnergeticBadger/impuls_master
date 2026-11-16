import { useState } from "react";
import styles from "~/routes/DeckPage.module.css";
import { tcgplayerDeckLink } from "~/lib/affiliate";
import { useSnapshot } from "valtio";
import { priceCurrency, type PriceCurrency } from "~/Components/Context/priceCurrency";
import { buyEntries, deckPrice, formatPrice, priciestCards, type Deck } from "~/lib/deck";

export function BuyDeck({ deck }: { deck: Deck }) {
  const [withSide, setWithSide] = useState(false)
  const entries = buyEntries(deck, { side: withSide })
  const currency = useSnapshot(priceCurrency).currency
  const price = deckPrice(deck, { side: withSide, currency })
  const priciest = priciestCards(deck, { side: withSide, currency })

  if (entries.length === 0) return null

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
          href={tcgplayerDeckLink(entries.map((e) => ({ count: e.count, name: e.card.name })))}
          target="_blank"
          rel="noopener sponsored"
        >Buy this deck on TCGplayer</a>
      </p>
      <p>
        <select
          className={styles.select}
          aria-label="Currency"
          value={currency}
          onChange={(e) => { priceCurrency.currency = e.target.value as PriceCurrency }}
        >
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
          <option value="tix">MTGO tix</option>
        </select>{" "}
        About {formatPrice(price.total, currency)}
        {price.missing.length > 0 && (
          <>{" "}<span title={price.missing.join(", ")}>({price.missing.length} {price.missing.length === 1 ? "card has" : "cards have"} no price)</span></>
        )}
      </p>
      {priciest.length > 0 && (
        <div>
          <p>Most expensive</p>
          <ul>
            {priciest.map((c) => (
              <li key={c.name} style={{ overflowWrap: "anywhere" }}>{c.count} × {c.name} — {formatPrice(c.total, currency)}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.empty}>An estimate from the prices of the printings in your deck.</p>
      <p className={styles.empty}>We may earn a commission if you buy through this link. It costs you nothing extra.</p>
    </section>
  )
}
