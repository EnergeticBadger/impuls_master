import { useEffect } from 'react';
import { useSnapshot } from 'valtio';
import styles from './CardGrid.module.css'
import { loadView, MAX_PER_ROW, MIN_PER_ROW, view } from '../Context/view';

// columns in the grid on screen right now, so − and + start from what's showing
function shownColumns() {
    const grid = document.querySelector<HTMLElement>('[data-page-grid]:not([hidden])')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 5
}

// − / + for how many cards sit in a row: fewer makes each card bigger
export function RowSize() {
    const { perRow } = useSnapshot(view)
    useEffect(loadView, [])

    const step = (by: number) => {
        const from = perRow || shownColumns()
        view.perRow = Math.min(MAX_PER_ROW, Math.max(MIN_PER_ROW, from + by))
    }

    return (
        <div className={styles.RowSize} role="group" aria-label="Cards per row">
            <button type="button" onClick={() => step(-1)} disabled={perRow === MIN_PER_ROW} title="Fewer, bigger cards">−</button>
            <button type="button" className={styles.RowSizeLabel} onClick={() => view.perRow = 0} disabled={!perRow} title="Fit to screen">
                {perRow ? `${perRow} per row` : 'Auto size'}
            </button>
            <button type="button" onClick={() => step(1)} disabled={perRow === MAX_PER_ROW} title="More, smaller cards">+</button>
        </div>
    )
}
