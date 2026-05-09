import { useState } from 'react';
import styles from './Card.module.css'
import { hasData, hasStatus, type CardProps } from "~/types";
import { setCardOverlay } from '../Context/cardoverlay';
import { all_alt_art, alternate, setAltArtList, setCurrentAlternate } from './components/alternate_arts';
import { useSnapshot } from 'valtio';
import { AlternateArts } from './components/AlternateArts';
import { PlayFormats } from './components/PlayFormats';

export function Card({ name, image_uri, card_uri, card }: CardProps) {
    const [quickView, setQuickView] = useState<boolean>(false)
    const [copied, setCopied] = useState<boolean>(false);
    const allPrints = useSnapshot(all_alt_art)

    async function FetchPrints() {
        const blob = await fetch(card.prints_search_uri, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "User-Agent": "impuls_master/1.0"
            }
        });

        const res = await blob.json();

        if (hasStatus(res) || !hasData(res)) {
            console.error(`${res.status}`, { cause: res.details });
            return
        }

        const prints = res.data.map((c) => ({ name: c.set_name, uri: c.image_uris?.large ?? '' }))
        console.log(card.prints_search_uri)
        setAltArtList(name, prints)
    }

    function handleOverlay(open: boolean, name: string) {
        if (allPrints.prints.length === 0 || allPrints.name !== name) FetchPrints()

        if (window && window.document.getElementsByName("body")) {
            const elm = window.document.getElementById("app")
            if (elm) open ? elm.style.overflow = "hidden" : elm.style.overflow = "scroll"
        }

        setCurrentAlternate(name, card.image_uris?.large ?? '')
        setCardOverlay(name)
        setQuickView(open)
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(name);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    };

    const version = useSnapshot(alternate)


    return (
        <div className={styles.Card}>

            <img
                src={image_uri}
                alt={name}
                width={"100%"}
                height={"100%"}
                loading='lazy'
            />
            <div className={styles.button_box}>
                {/* copy */}
                <button onClick={handleCopy} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" fill={copied ? "#46bd48" : "#FFFFFF"}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
                </button>

                {/* open */}
                <button onClick={() => handleOverlay(true, name)} style={{ height: '24px' }}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z" /></svg>
                </button>

                {/* Overlay */}
                <div className={quickView ? styles.overlay : styles.not_active}>
                    {/* close */}
                    <button className={styles.close} onClick={() => handleOverlay(false, 'none')}>
                        <svg height="20px" width="20px" viewBox="0 -960 960 960" fill="#FFFFFF"><path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z" /></svg>
                    </button>
                    <div className={styles.overlay_details}>

                        <img src={version.uri} alt={name} width="100%" height="100%" />

                        <div className={styles.overlay_details_info}>
                            <div className={styles.info_heading}>
                                <span className={styles.name} onClick={handleCopy} style={{ color: copied ? "#46bd48" : "#FFFFFF" }}>{name} |
                                    <button onClick={handleCopy} style={{ height: '24px' }}>
                                        <svg height="24px" viewBox="0 -1030 960 880" width="24px" fill={copied ? "#46bd48" : "#FFFFFF"}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
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