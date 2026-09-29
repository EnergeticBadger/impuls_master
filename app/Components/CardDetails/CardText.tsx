import type { CardFace, ScryfallCard } from '~/types'
import styles from './CardDetails.module.css'
import { ManaText, OracleText } from './ManaText'

// the text-level faces: split, adventure, flip and double-faced cards list each half; everything else is one face
export function textFaces(card: ScryfallCard): CardFace[] {
    return card.card_faces?.length ? card.card_faces : [card]
}

function stats(face: CardFace) {
    if (face.power !== undefined && face.toughness !== undefined) return `${face.power}/${face.toughness}`
    if (face.loyalty !== undefined) return `Loyalty ${face.loyalty}`
    if (face.defense !== undefined) return `Defense ${face.defense}`
    return null
}

// name, cost, type line, rules text, P/T and flavor for each face of the card
export function CardText({ card, showName = true, showFlavor = true }: { card: ScryfallCard, showName?: boolean, showFlavor?: boolean }) {
    const faces = textFaces(card)
    return (
        <div className={styles.faces}>
            {faces.map((face, i) => {
                const pt = stats(face)
                return (
                    <section key={i} className={styles.face}>
                        {showName || faces.length > 1 ? (
                            <div className={styles.face_title}>
                                <span className={styles.face_name}>{face.name}</span>
                                {face.mana_cost ? <span className={styles.cost}><ManaText text={face.mana_cost} /></span> : null}
                            </div>
                        ) : face.mana_cost ? (
                            <div className={styles.face_title}><span className={styles.cost}><ManaText text={face.mana_cost} /></span></div>
                        ) : null}
                        {face.type_line ? <div className={styles.type_line}>{face.type_line}</div> : null}
                        <OracleText text={face.oracle_text} />
                        {showFlavor && face.flavor_text ? <p className={styles.flavor}>{face.flavor_text}</p> : null}
                        {pt ? <div className={styles.stats}>{pt}</div> : null}
                    </section>
                )
            })}
        </div>
    )
}
