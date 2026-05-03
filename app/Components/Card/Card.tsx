import { useState } from 'react';
import styles from './Card.module.css'
import type { CardProps } from "~/types";
import { setCardOverlay } from '../Context/cardoverlay';

export function Card({ name, image_uri, card_uri }: CardProps) {
    const [quickView, setQuickView] = useState<boolean>(false)
    const [copied, setCopied] = useState<boolean>(false);
    
    function handleOverlay(open:boolean, name:string) {
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


    return (
        <div className={styles.Card}>

            <img
                src={image_uri}
                alt={name}
                width={"100%"}
                height={"100%"}
            />
            <div className={styles.button_box}>
                {/* copy */}
                <button onClick={handleCopy}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" fill={copied ? "#46bd48" : "#FFFFFF"}><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
                </button>
                
                {/* open */}
                <button onClick={() => handleOverlay(true, name)}>
                    <svg height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z" /></svg>
                </button>

                {/* Overlay */}
                <div className={styles.overlay} style={{ display: quickView ? 'flex' : 'none' }}>
                    

                    {/* close */}
                    <button onClick={() => handleOverlay(false, 'none')}>
                        <svg height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z" /></svg>
                    </button>
                </div>
            </div>
        </div>
    );
}