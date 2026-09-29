import { useState } from 'react';
import styles from './Card.module.css'
import { type CardProps } from "~/types";
import { useSnapshot } from 'valtio';
import { Image } from '@unpic/react';
import { useCardLayout } from '../Hooks/useCardLayout';
import { view } from '../Context/view';
import { compare, inCompare, toggleCompare } from '../Context/compare';
import { COMPARE_ICON, OPEN_ICON, TURN_ICON, QuickView, openQuickView } from './QuickView';

// at this many per row or fewer, cards are wide enough that the normal image would look soft
const LARGE_IMAGE_PER_ROW = 3

export function Card({ name, image_uri, card_uri, card }: CardProps) {

    const [copied, setCopied] = useState<boolean>(false);
    const { perRow } = useSnapshot(view)
    const { cards: comparing } = useSnapshot(compare)
    const compared = inCompare(comparing, card.id)
    const handleCompare = () => toggleCompare({ name, image_uri, card_uri, card })
    const layout = useCardLayout(card)
    const { currentFace, canFlip, flip, canRotate, rotate, rotation } = layout
    const rotationClass = rotation === 180 ? styles.rotate_180 : rotation === 90 ? styles.rotate_90 : rotation === -90 ? styles.rotate_neg_90 : undefined

    // the search results' quick view is keyed by the card's name
    const openOverlay = () => openQuickView(name, card, currentFace.large_uri)

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(name);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    };

    return (
        <div className={styles.Card}>

            <Image
                src={(perRow && perRow <= LARGE_IMAGE_PER_ROW && currentFace.large_uri) || currentFace.image_uri || image_uri}
                alt={currentFace.name}
                width={250}
                height={350}
                className={rotationClass}
                onClick={openOverlay}
            />
            <div className={styles.button_box}>
                {/* copy */}
                <button onClick={handleCopy} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: copied ? 'var(--success)' : 'var(--text)' }}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
                </button>

                {/* open */}
                <button onClick={openOverlay} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: 'var(--text)' }}><path d={OPEN_ICON} /></svg>
                </button>

                {/* compare */}
                <button onClick={handleCompare} aria-pressed={compared} title={compared ? 'Remove from compare' : 'Compare'} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: 'var(--text)' }}><path d={COMPARE_ICON} /></svg>
                </button>

                {/* rotate */}
                {canFlip || canRotate ? (<button onClick={canFlip ? flip : rotate} title={canFlip ? 'Flip' : 'Rotate'} style={{ height: '24px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: 'var(--text)' }}><path d={TURN_ICON} /></svg>
                </button>) : null }

                <QuickView openKey={name} card={{ name, image_uri, card_uri, card }} layout={layout} />
            </div>
        </div>
    );
}