import { useEffect } from 'react';
import { useSnapshot } from 'valtio';
import styles from './Searchbar.module.css'
import { loadSort, sort, SORT_ORDERS, type SortDir, type SortOrder } from '../Context/sort';

// "Sort by [what] [direction]", like Scryfall's two sort menus; changing either re-runs the search
export function SortControl({ onChange }: { onChange: () => void }) {
    const snap = useSnapshot(sort)
    useEffect(loadSort, [])
    const current = SORT_ORDERS.find((o) => o.value === snap.order) ?? SORT_ORDERS[0]

    return (
        <div className={styles.sort} role="group" aria-label="Sort results">
            <label>
                <span className={styles.sortLabel}>Sort by</span>
                <select value={snap.order} onChange={(e) => { sort.order = e.target.value as SortOrder; onChange() }}>
                    {SORT_ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </label>
            <select value={snap.dir} aria-label="Sort direction" onChange={(e) => { sort.dir = e.target.value as SortDir; onChange() }}>
                <option value="auto">Default order</option>
                <option value="asc">{current.asc}</option>
                <option value="desc">{current.desc}</option>
            </select>
        </div>
    )
}
