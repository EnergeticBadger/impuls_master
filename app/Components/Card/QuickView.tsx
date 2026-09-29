import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';
import { Link } from 'react-router';
import { Image } from '@unpic/react';
import styles from './Card.module.css'
import type { CardProps, ScryfallCard } from '~/types';
import { all_alt_art, alternate, loadPrints, setCurrentAlternate } from './components/alternate_arts';
import { AlternateArts } from './components/AlternateArts';
import { PlayFormats } from './components/PlayFormats';
import { useCardLayout } from '../Hooks/useCardLayout';
import { compare, inCompare, toggleCompare } from '../Context/compare';
import { cardPath, useRulings } from '~/lib/card';
import { CardText } from '../CardDetails/CardText';
import { Rulings } from '../CardDetails/Rulings';
import { ShareButton } from '../CardDetails/ShareButton';

export const COMPARE_ICON = "M320-160 160-320l160-160 56 57-63 63h287v80H313l63 63-56 57Zm320-320-56-57 63-63H360v-80h287l-63-63 56-57 160 160-160 160Z"
export const TURN_ICON = "M627-210q17-33 26-69.5t9-75.5q0-80-35-146.5T532-612l-92 92v-320h320l-92 92q52 47 83 112t31 141q0 91-42.5 165T627-210Zm-427 90 92-92q-53-47-83.5-112T178-465q0-91 42.5-165T334-750q-17 33-26.5 69.5T298-605q0 80 35.5 146.5T428-348l92-92v320H200Z"
export const OPEN_ICON = "M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z"
const COPY_ICON = "M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"

// Which quick view is open is kept in `alternate.name` (with the big image in `alternate.uri`), so only one is
// open at a time. Each place that can open one gives it its own key: the search results use the card's name.
export function openQuickView(key: string, card: ScryfallCard, largeUri: string) {
    // always load on open: cached cards return instantly, and this supersedes any in-flight request
    loadPrints(card)
    // lock page scroll while the overlay is open; closing hands it back to the stylesheet
    const elm = document.getElementById("app")
    if (elm) elm.style.overflow = "hidden"
    setCurrentAlternate(key, largeUri)
}

export function closeQuickView() {
    const elm = document.getElementById("app")
    if (elm) elm.style.overflow = ""
    setCurrentAlternate('none', 'none')
}

type Layout = ReturnType<typeof useCardLayout>

// The quick view panel for a card, shown while `openKey` is the open one. `layout` is the flip/rotate state of
// whatever opened it, so flipping in here flips that too.
export function QuickView({ openKey, card: { name, image_uri, card_uri, card }, layout }: { openKey: string, card: CardProps, layout: Layout }) {
    const version = useSnapshot(alternate)
    const allPrints = useSnapshot(all_alt_art)
    const { cards: comparing } = useSnapshot(compare)
    const [copied, setCopied] = useState(false)
    const open = version.name === openKey
    // rulings are only fetched once the quick view opens
    const rulings = useRulings(card, open)
    // whatever opened it going away (a card taken out of compare from in here) closes it and unlocks the page
    useEffect(() => () => { if (alternate.name === openKey) closeQuickView() }, [openKey])
    if (!open) return null

    const { faces, faceIndex, canFlip, flip, canRotate, rotate, rotation } = layout
    const rotationClass = rotation === 180 ? styles.rotate_180 : rotation === 90 ? styles.rotate_90 : rotation === -90 ? styles.rotate_neg_90 : undefined
    const compared = inCompare(comparing, card.id)

    // flipping also swaps the big image to the other face
    function turn() {
        if (canFlip) {
            const next = faces[(faceIndex + 1) % faces.length]
            flip()
            setCurrentAlternate(openKey, next.large_uri)
        } else {
            rotate()
        }
    }

    // leaving for the card's page: close the quick view so it isn't open when coming back.
    // A ctrl/cmd/shift/middle click opens it in another tab, so this one stays as it is.
    function handleFullPage(e: MouseEvent<HTMLAnchorElement>) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        closeQuickView()
    }

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(name)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    // Clicking the dimmed area around the panel closes it. It's portalled to <body> so the grid's loading fade
    // (opacity) can't make the backdrop see-through or push it under the header.
    return createPortal(
        <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) closeQuickView() }}>
            <div className={styles.overlay_details}>
                <div className={styles.tools}>
                    {canFlip || canRotate ? (
                        <button className={styles.turn} onClick={turn} title={canFlip ? 'Flip' : 'Rotate'}>
                            <svg viewBox="0 -960 960 960"><path d={TURN_ICON} /></svg>
                            {canFlip ? 'Flip' : 'Rotate'}
                        </button>
                    ) : null}
                    <button className={styles.turn} onClick={() => toggleCompare({ name, image_uri, card_uri, card })} aria-pressed={compared}>
                        <svg viewBox="0 -960 960 960"><path d={COMPARE_ICON} /></svg>
                        {compared ? 'Comparing ✓' : 'Compare'}
                    </button>
                    <ShareButton path={cardPath(card)} name={card.name} className={styles.turn} />
                    <Link className={styles.turn} to={cardPath(card)} onClick={handleFullPage} title="Open the card's own page">
                        <svg viewBox="0 -960 960 960"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z" /></svg>
                        Full page
                    </Link>
                </div>

                <div className={styles.info_heading}>
                    <span className={styles.name} onClick={handleCopy} style={{ color: copied ? 'var(--success)' : 'var(--text)' }}>{name}
                        <button onClick={handleCopy} title="Copy name">
                            <svg viewBox="0 -960 960 960" style={{ fill: copied ? 'var(--success)' : 'var(--text)' }}><path d={COPY_ICON} /></svg>
                        </button>
                    </span>
                    <button className={styles.close} onClick={closeQuickView} title="Close">
                        <svg viewBox="0 -960 960 960"><path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z" /></svg>
                    </button>
                </div>

                <div className={styles.overlay_media}>
                    <Image src={version.uri} alt={name} width={393} height={550} className={rotationClass} />
                </div>

                <div className={styles.overlay_details_info}>
                    <CardText card={card} showName={false} />
                    <PlayFormats formats={card.legalities} />
                    <Rulings rulings={rulings} compact />
                    {allPrints.name === name ? <AlternateArts /> : null}
                </div>
            </div>
        </div>, document.body)
}
