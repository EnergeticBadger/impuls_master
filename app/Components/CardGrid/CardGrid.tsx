import styles from './CardGrid.module.css'
import type { ImageUris } from "~/types";
import { Card } from '../Card/Card';



export function CardGrid({ cards }: { cards: ImageUris[] }) {
    return (
        <div className={styles.CardGrid}>
            {/* {cards.map((card) => <Image src={card.large} alt="MTG Card" w={325} h={600} />)} */}
            {cards.map((card) => <Card key={card.large} card={card} />)}
        </div>
    )
}