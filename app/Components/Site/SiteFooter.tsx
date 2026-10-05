import { Link } from "react-router";
import { setPath, type Browse } from "~/lib/carddata";
import styles from "./Site.module.css";

// On every page: ways into the sets and the most played cards, so people (and search engines) can get from
// any page to the rest of the site. The lists come from the card data files; without them only the first
// column shows.
export function SiteFooter({ browse }: { browse: Browse | null }) {
  return (
    <footer className={styles.footer}>
      <nav className={styles.columns} aria-label="Browse">
        <div>
          <h2 className={styles.heading}>Impulse Caster</h2>
          <ul className={styles.list}>
            <li><Link to="/">Card search</Link></li>
            <li><Link to="/sets">All sets</Link></li>
            <li><Link to="/syntax">Search syntax guide</Link></li>
          </ul>
        </div>
        {browse?.latest.length ? (
          <div>
            <h2 className={styles.heading}>Latest sets</h2>
            <ul className={styles.list}>
              {browse.latest.map((s) => <li key={s.code}><Link to={setPath(s.code)}>{s.name}</Link></li>)}
            </ul>
          </div>
        ) : null}
        {browse?.popular.length ? (
          <div className={styles.wide}>
            <h2 className={styles.heading}>Popular cards</h2>
            <ul className={`${styles.list} ${styles.flow}`}>
              {browse.popular.map(([slug, name]) => <li key={slug}><Link to={`/card/${slug}`}>{name}</Link></li>)}
            </ul>
          </div>
        ) : null}
      </nav>
      <p className={styles.legal}>
        Card data and images come from Scryfall; prices are daily estimates. Impulse Caster is unofficial Fan Content
        permitted under the Wizards of the Coast Fan Content Policy. Magic: The Gathering and its card text and images
        are © Wizards of the Coast, which doesn't produce or endorse this site.
      </p>
    </footer>
  )
}
