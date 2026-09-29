import type { Ruling } from '~/types'
import styles from './CardDetails.module.css'
import { ManaText } from './ManaText'

const dateFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

// undefined rulings means they're still loading, null that they couldn't be loaded
export function Rulings({ rulings, compact = false }: { rulings: readonly Ruling[] | null | undefined, compact?: boolean }) {
    return (
        <div className={styles.section}>
            <span className={styles.label}>Rulings{rulings?.length ? ` (${rulings.length})` : ''}</span>
            {rulings === undefined ? (
                <p className={styles.muted}>Loading rulings…</p>
            ) : rulings === null ? (
                <p className={styles.muted}>Rulings couldn't be loaded right now.</p>
            ) : rulings.length === 0 ? (
                <p className={styles.muted}>No rulings for this card.</p>
            ) : (
                <ul className={compact ? `${styles.rulings} ${styles.rulings_compact}` : styles.rulings}>
                    {rulings.map((r, i) => (
                        <li key={i}>
                            <p><ManaText text={r.comment} /></p>
                            <span className={styles.ruling_meta}>
                                {dateFormat.format(new Date(r.published_at))} · {r.source === 'wotc' ? 'Wizards of the Coast' : 'Scryfall'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
