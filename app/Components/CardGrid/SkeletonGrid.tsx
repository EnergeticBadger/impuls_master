import styles from './CardGrid.module.css'


export function SkeletonGrid({ numOfCards }: { numOfCards: number }) {
    let i = 0;
    return (<div className={styles.CardGrid}>

        {[...Array(numOfCards)].map((_, i) => (
           <div className={styles.Card}></div>
        ))}
    </div>
    )
}