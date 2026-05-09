import styles from '../Card.module.css'
import { all_alt_art, setCurrentAlternate } from "./alternate_arts";
import { useSnapshot } from "valtio";


export function AlternateArts() {

    const allPrints = useSnapshot(all_alt_art)


    if (allPrints.prints.length === 0) null

    return (
        <div className={styles.alt_art_block}>
            <span>Alternate Arts</span>
            <div className={styles.alt_art_list}>
                {allPrints.prints.map((print) => (
                    <span key={print.uri} className={styles.alt_art_item} onClick={() => setCurrentAlternate(print.name, print.uri)}>
                        {print.name}
                    </span>
                ))}
            </div>
        </div>
    )
}