import styels from './CardGrid.module.css'
import type { ImageUris } from "~/types";
import { Image } from "../Image/Image";



export function CardGrid({ cards }: { cards: ImageUris[] }) {
    return (
        <div className={styels.CardGrid}>
            {cards.map((card) => <Image src={card.large} alt="MTG Card" w={325} h={600} />)}
        </div>
    )
}