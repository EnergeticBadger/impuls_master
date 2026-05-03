import styles from './Card.module.css'
import type { ImageUris } from "~/types";

export function Card({ card }: { card: ImageUris }) {
    return (
        <div className={styles.Card}>
            <img
                src={card.normal}
                alt="MTG_CARD"
                width={"100%"}
                height={"100%"}
             />
             {/* open */}
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></svg>
            {/* close */}
            <svg height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z"/></svg>
        </div>
    );
}