import type { Legalities } from "~/types";
import styles from '../Card.module.css'



export function PlayFormats({ formats }: { formats: Legalities }) {


    const format_names = [
        "standard",
        "historic",
        "timeless",
        "pioneer",
        "modern",
        "legacy",
        "pauper",
        "vintage",
        "penny",
        "commander",
        "oathbreaker",
        "brawl",
        "alchemy"
    ]

    return (
        <div className={styles.play_formats_wrap}>
            <span>Formats</span>
            <div className={styles.play_formats}>
                {Object.entries(formats).filter(([k, val]) => !!format_names.includes(k)).map((keys) => {
                    const [key, value] = keys

                    return (
                        <div key={key} className={styles.play_format_item}>
                            <span style={{ backgroundColor: value === "legal" ? 'green' : 'gray' }}>{value.replace('_', ' ').replace(/(^\w|\s\w)/g, m => m.toUpperCase())}</span>
                            <span>{key}</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}