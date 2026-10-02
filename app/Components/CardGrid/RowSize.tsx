import { useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';
import styles from './CardGrid.module.css'
import { loadView, MAX_PER_ROW, MIN_PER_ROW, view } from '../Context/view';

// columns in the grid on screen right now, so − and + start from what's showing
function shownColumns() {
    const grid = document.querySelector<HTMLElement>('[data-page-grid]:not([hidden])')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 5
}

// the most cards that fit in a row before each would drop under --card-floor (where its buttons stop fitting)
function fittingColumns() {
    const area = document.querySelector<HTMLElement>('[data-card-area]')
    if (!area) return MAX_PER_ROW
    const style = getComputedStyle(area)
    const width = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const floor = parseFloat(style.getPropertyValue('--card-floor')) || 150
    // the gap between columns lives on the grid, which isn't there before the first search
    const grid = area.querySelector<HTMLElement>('[data-page-grid]')
    const gap = (grid && parseFloat(getComputedStyle(grid).columnGap)) || 20
    return Math.min(MAX_PER_ROW, Math.max(MIN_PER_ROW, Math.floor((width + gap) / (floor + gap))))
}

// the most per row the screen has room for, kept up to date as the window is resized
function useMaxPerRow() {
    const [max, setMax] = useState(MAX_PER_ROW)
    useEffect(() => {
        const area = document.querySelector<HTMLElement>('[data-card-area]')
        if (!area) return
        const observer = new ResizeObserver(() => setMax(fittingColumns()))
        observer.observe(area)
        return () => observer.disconnect()
    }, [])
    return max
}

// − / + for how many cards sit in a row: fewer makes each card bigger
export function RowSize() {
    const { perRow } = useSnapshot(view)
    useEffect(loadView, [])
    const max = useMaxPerRow()
    // a number saved on a wider screen shows as what fits here, and is kept for when there's room again
    const shown = perRow && Math.min(perRow, max)

    const step = (by: number) => {
        const from = shown || shownColumns()
        view.perRow = Math.min(max, Math.max(MIN_PER_ROW, from + by))
    }

    return (
        <div className={styles.RowSize} role="group" aria-label="Cards per row">
            <button type="button" onClick={() => step(-1)} disabled={shown === MIN_PER_ROW} title="Fewer, bigger cards">−</button>
            <button type="button" className={styles.RowSizeLabel} onClick={() => view.perRow = 0} disabled={!perRow} title="Fit to screen">
                {shown ? `${shown} per row` : 'Auto size'}
            </button>
            <button type="button" onClick={() => step(1)} disabled={shown >= max} title={shown >= max ? 'No room for more on this screen' : 'More, smaller cards'}>+</button>
        </div>
    )
}
