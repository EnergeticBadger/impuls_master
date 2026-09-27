import { memo } from 'react';
import styles from './CardGrid.module.css'
import { Card } from '../Card/Card';
import { useSnapshot } from 'valtio';
import { cardsearch } from '../Context/cards';
import type { CardProps } from '~/types';


// recent pages stay mounted and are just hidden, so their images never reload or re-decode
const PageGrid = memo(function PageGrid({ cards, hidden }: { cards: readonly CardProps[], hidden: boolean }) {
    return (
        <div className={styles.CardGrid} hidden={hidden}>
            {cards.map((c) => <Card key={c.image_uri} {...c} />)}
        </div>
    )
})

export function CardGrid() {
    const snap = useSnapshot(cardsearch)
    return (
        <>
            {snap.pages.map((p) => <PageGrid key={p.key} cards={p.cards as CardProps[]} hidden={p.key !== snap.active} />)}
        </>
    )
}
