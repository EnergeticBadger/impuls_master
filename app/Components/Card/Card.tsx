import { useState, type SyntheticEvent } from 'react';
import styles from './Card.module.css'
import { type CardProps } from "~/types";
import { all_alt_art, alternate, loadPrints, setCurrentAlternate } from './components/alternate_arts';
import { useSnapshot } from 'valtio';
import { AlternateArts } from './components/AlternateArts';
import { PlayFormats } from './components/PlayFormats';
import { Image } from '@unpic/react';
import { useCardLayout } from '../Hooks/useCardLayout';

export function Card({ name, image_uri, card_uri, card }: CardProps) {

    const version = useSnapshot(alternate)
    const [copied, setCopied] = useState<boolean>(false);
    const allPrints = useSnapshot(all_alt_art)
    const { currentFace, canFlip, flip, canRotate, rotate, rotation } = useCardLayout(card)


    async function handleOverlay(e: SyntheticEvent, open: boolean, name: string) {
        e.preventDefault()

        // always load on open: cached cards return instantly, and this supersedes any in-flight request
        if (open) loadPrints(name, card.prints_search_uri)

        // lock page scroll while the overlay is open, then hand it back to the stylesheet
        const elm = document.getElementById("app")
        if (elm) elm.style.overflow = open ? "hidden" : ""

        await setCurrentAlternate(name, currentFace.large_uri)
    }

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
                src={currentFace.image_uri || image_uri}
                alt={currentFace.name}
                width={250}
                height={350}
                className={rotation === 180 ? styles.rotate_180 : rotation === 90 ? styles.rotate_90 : rotation === -90 ? styles.rotate_neg_90 : undefined}
            />
            <div className={styles.button_box}>
                {/* copy */}
                <button onClick={handleCopy} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: copied ? 'var(--success)' : 'var(--text)' }}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
                </button>

                {/* open */}
                <button onClick={(e) => handleOverlay(e, true, name)} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: 'var(--text)' }}><path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z" /></svg>
                </button>

                {/* rotate */}
                {canFlip || canRotate ? (<button onClick={canFlip ? flip : rotate} title={canFlip ? 'Flip' : 'Rotate'} style={{ height: '24px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" style={{ fill: 'var(--text)' }}><path d="M627-210q17-33 26-69.5t9-75.5q0-80-35-146.5T532-612l-92 92v-320h320l-92 92q52 47 83 112t31 141q0 91-42.5 165T627-210Zm-427 90 92-92q-53-47-83.5-112T178-465q0-91 42.5-165T334-750q-17 33-26.5 69.5T298-605q0 80 35.5 146.5T428-348l92-92v320H200Z" /></svg>
                </button>) : null }

                {/* Overlay */}
                <div className={version.name === name ? styles.overlay : styles.not_active}>
                    {/* close */}
                    <button className={styles.close} onClick={(e) => handleOverlay(e, false, 'none')}>
                        <svg height="20px" width="20px" viewBox="0 -960 960 960" style={{ fill: 'var(--text)' }}><path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z" /></svg>
                    </button>
                    <div className={styles.overlay_details}>

                        {version.name === 'none' ? null : (
                            <Image src={version.uri} alt={name} width={393} height={550} />
                        )}

                        <div className={styles.overlay_details_info}>
                            <div className={styles.info_heading}>
                                <span className={styles.name} onClick={handleCopy} style={{ color: copied ? 'var(--success)' : 'var(--text)' }}>{name} |
                                    <button onClick={handleCopy} style={{ height: '24px' }}>
                                        <svg height="24px" viewBox="0 -1030 960 880" width="24px" style={{ fill: copied ? 'var(--success)' : 'var(--text)' }}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
                                    </button>
                                </span>
                            </div>
                            <PlayFormats formats={card.legalities} />
                            {allPrints.name === name ? <AlternateArts /> : null}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}