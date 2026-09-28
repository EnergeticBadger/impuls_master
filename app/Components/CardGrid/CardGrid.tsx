import { memo, type CSSProperties } from 'react';
import styles from './CardGrid.module.css'
import { Card } from '../Card/Card';
import { useSnapshot } from 'valtio';
import { cardsearch } from '../Context/cards';
import { view } from '../Context/view';
import type { CardProps } from '~/types';


// recent pages stay mounted and are just hidden, so their images never reload or re-decode
const PageGrid = memo(function PageGrid({ cards, hidden, pending, perRow }: { cards: readonly CardProps[], hidden: boolean, pending: boolean, perRow: number }) {
    return (
        <div className={styles.CardGrid} hidden={hidden} data-page-grid aria-busy={pending || undefined} data-per-row={perRow || undefined}
            style={perRow ? { '--per-row': perRow } as CSSProperties : undefined}>
            {cards.map((c) => <Card key={c.image_uri} {...c} />)}
        </div>
    )
})

export function CardGrid() {
    const snap = useSnapshot(cardsearch)
    const { perRow } = useSnapshot(view)
    return (
        <>
            {snap.pages.map((p) => <PageGrid key={p.key} cards={p.cards as CardProps[]} hidden={p.key !== snap.active} pending={snap.pending && p.key === snap.active} perRow={perRow} />)}
        </>
    )
}
