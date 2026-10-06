import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./Site.module.css";

// the header of the pages other than the search: the logo home, and a way back (children) or to the search
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} to="/" aria-label="Impulse Caster home">
        <img src="/logo.svg" alt="" width={40} height={40} />
        <span>Impulse Caster</span>
      </Link>
      {children ?? <Link to="/" className={styles.back}>Search cards</Link>}
    </header>
  )
}

export const backLinkClass = styles.back
