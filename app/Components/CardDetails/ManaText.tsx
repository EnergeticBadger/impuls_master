import { Fragment } from 'react'
import styles from './CardDetails.module.css'

const SYMBOL = /\{[^}]+\}/g

// Scryfall's symbol files: {W/U} -> WU.svg, {T} -> T.svg, {∞} -> INFINITY.svg
function symbolSrc(symbol: string) {
    const code = symbol.slice(1, -1).replace(/\//g, '').replace('∞', 'INFINITY').replace('½', 'HALF')
    return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code.toUpperCase())}.svg`
}

// text with {R}, {T}, {2/W} etc. drawn as the symbols
export function ManaText({ text }: { text: string }) {
    const parts = text.split(SYMBOL)
    const symbols = text.match(SYMBOL) ?? []
    return (
        <>
            {parts.map((part, i) => (
                <Fragment key={i}>
                    {part}
                    {symbols[i] ? <img className={styles.symbol} src={symbolSrc(symbols[i])} alt={symbols[i]} title={symbols[i]} loading="lazy" /> : null}
                </Fragment>
            ))}
        </>
    )
}

// one paragraph of rules text, with reminder text (in parentheses) set in italics
function OracleLine({ line }: { line: string }) {
    const pieces = line.split(/(\([^)]*\))/g)
    return (
        <p>
            {pieces.map((piece, i) => piece.startsWith('(')
                ? <i key={i} className={styles.reminder}><ManaText text={piece} /></i>
                : <ManaText key={i} text={piece} />)}
        </p>
    )
}

export function OracleText({ text }: { text?: string }) {
    if (!text) return null
    return (
        <div className={styles.oracle}>
            {text.split('\n').map((line, i) => <OracleLine key={i} line={line} />)}
        </div>
    )
}
