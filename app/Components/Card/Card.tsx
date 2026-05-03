import styles from './Card.module.css'
import type { ImageUris } from "~/types";

export function Card({ card }: { card: ImageUris }) {
    return (
        <div className={styles.Card}>
            <img
                src={card.normal}
                alt="MTG_CARD"
                width={"100%"}
                height={"100%"} />
        </div>
    );
}