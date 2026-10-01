import { useEffect } from 'react';
import { useSnapshot } from 'valtio';
import styles from './Searchbar.module.css'
import { loadSort, sort, SORT_ORDERS, type SortDir, type SortOrder } from '../Context/sort';
import { Arrow } from '../Arrow/Arrow';

// "Sort by [what] [direction]", like Scryfall's two sort menus; changing either re-runs the search.
// Phones show each menu as a button reading "Sort by: Name" and "Order: Default", with the menu itself over it.
export function SortControl({ onChange }: { onChange: () => void }) {
    const snap = useSnapshot(sort)
    useEffect(loadSort, [])
    const current = SORT_ORDERS.find((o) => o.value === snap.order) ?? SORT_ORDERS[0]
    const direction = snap.dir === 'asc' ? current.asc : snap.dir === 'desc' ? current.desc : 'Default'
    const face = (text: string) => (
        <span className={styles.sortFace} aria-hidden>
            <span>{text}</span>
            <Arrow to="down" />
        </span>
    )

    return (
        <div className={styles.sort} role="group" aria-label="Sort results">
            <label className={styles.sortPick}>
                <span className={styles.sortLabel}>Sort by</span>
                <select value={snap.order} onChange={(e) => { sort.order = e.target.value as SortOrder; onChange() }}>
                    {SORT_ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {face(`Sort by: ${current.label}`)}
            </label>
            <label className={styles.sortPick}>
                <select value={snap.dir} aria-label="Sort direction" onChange={(e) => { sort.dir = e.target.value as SortDir; onChange() }}>
                    <option value="auto">Default order</option>
                    <option value="asc">{current.asc}</option>
                    <option value="desc">{current.desc}</option>
                </select>
                {face(`Order: ${direction}`)}
            </label>
        </div>
    )
}
