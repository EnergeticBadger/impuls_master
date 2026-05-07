import styles from './CardGrid.module.css'
import { Card } from '../Card/Card';
import { useSnapshot } from 'valtio';
import { cardsearch } from '../Context/cards';



export function CardGrid() {
    const cards = useSnapshot(cardsearch) as typeof cardsearch
    return (
        <div className={styles.CardGrid}>
            {/* {cards.map((card) => <Image src={card.large} alt="MTG Card" w={325} h={600} />)} */}
            {cards.list.map((c) => <Card key={c.image_uri} {...c} />)}
        </div>
    )
}