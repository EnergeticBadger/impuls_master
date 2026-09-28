import { useEffect, type ReactNode } from 'react';
import { useSnapshot } from 'valtio';
import styles from './Compare.module.css'
import { clearCompare, compare, loadCompare, removeCompare } from '../Context/compare';
import type { ScryfallCard } from '~/types';

// formats worth a glance when comparing; the quick view has the full list
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl']

const SYMBOL_COLORS: Record<string, string> = { W: 'var(--mana-w)', U: 'var(--mana-u)', B: 'var(--mana-b)', R: 'var(--mana-r)', G: 'var(--mana-g)' }

// "{2}{R/G}{U}" as little pips; hybrid symbols get both colors
function ManaCost({ cost }: { cost: string }) {
    const parts = cost.split(/(\{[^}]+\}|\s\/\/\s)/).filter(Boolean)
    return (
        <span className={styles.cost}>
            {parts.map((part, i) => {
                const symbol = part.match(/^\{([^}]+)\}$/)?.[1]
                if (!symbol) return <span key={i} className={styles.muted}>{part.trim()}</span>
                const colors = symbol.split('/').map((s) => SYMBOL_COLORS[s]).filter(Boolean)
                const background = colors.length > 1 ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)` : colors[0] ?? 'var(--mana-c)'
                return <span key={i} className={styles.pip} data-dark={symbol === 'B' || undefined} style={{ background }} title={symbol}>{symbol.replace('/', '')}</span>
            })}
        </span>
    )
}

// both faces of a double-faced card, joined like Scryfall does
const faced = (card: ScryfallCard, pick: (f: Partial<ScryfallCard>) => string | undefined, joiner = ' // ') =>
    pick(card) || card.card_faces?.map(pick).filter(Boolean).join(joiner) || ''

const stat = (card: ScryfallCard) => {
    const one = (f: Partial<ScryfallCard>) =>
        f.power !== undefined ? `${f.power}/${f.toughness}` : f.loyalty !== undefined ? `Loyalty ${f.loyalty}` : f.defense !== undefined ? `Defense ${f.defense}` : undefined
    return faced(card, one)
}

const price = (card: ScryfallCard) => {
    const { usd, eur, tix } = card.prices ?? {}
    return [usd && `$${usd}`, eur && `€${eur}`, tix && `${tix} tix`].filter(Boolean).join(' · ')
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// one row per thing worth comparing, in the order people usually scan a card
const ROWS: { label: string, value: (c: ScryfallCard) => ReactNode, empty?: boolean }[] = [
    { label: 'Mana cost', value: (c) => { const cost = faced(c, (f) => f.mana_cost); return cost ? <ManaCost cost={cost} /> : '' } },
    { label: 'Mana value', value: (c) => String(c.cmc ?? '') },
    { label: 'Type', value: (c) => c.type_line },
    { label: 'Rules text', value: (c) => <span className={styles.text}>{faced(c, (f) => f.oracle_text, '\n\n')}</span> },
    { label: 'Power / toughness', value: stat },
    { label: 'Color identity', value: (c) => c.color_identity?.length ? <ManaCost cost={c.color_identity.map((x) => `{${x}}`).join('')} /> : 'Colorless' },
    { label: 'Rarity', value: (c) => capital(c.rarity ?? '') },
    { label: 'Price', value: price },
    { label: 'EDHREC rank', value: (c) => c.edhrec_rank ? `#${c.edhrec_rank.toLocaleString()}` : '' },
    {
        label: 'Legal in', value: (c) => {
            const legal = FORMATS.filter((f) => c.legalities?.[f] === 'legal' || c.legalities?.[f] === 'restricted')
            return legal.length ? legal.map(capital).join(', ') : 'None of the main formats'
        }
    },
    { label: 'Set', value: (c) => `${c.set_name} (${c.set?.toUpperCase()})` },
    { label: 'Artist', value: (c) => c.artist },
]

// a drawer along the bottom (open, it fills the screen under the header) with the picked cards side by side, one column each
export function CompareDrawer() {
    const snap = useSnapshot(compare)
    useEffect(loadCompare, [])

    if (snap.cards.length === 0) return null
    const count = snap.cards.length

    return (
        <aside className={styles.drawer} data-collapsed={snap.collapsed || undefined} aria-label="Compare cards">
            <div className={styles.bar}>
                <button type="button" className={styles.title} aria-expanded={!snap.collapsed} onClick={() => compare.collapsed = !snap.collapsed}>
                    <span className={styles.chevron} aria-hidden>▾</span>
                    Compare <span className={styles.muted}>{count} {count === 1 ? 'card' : 'cards'}</span>
                </button>
                {count === 1 && !snap.collapsed ? <span className={styles.hint}>Add another card with its compare button</span> : null}
                <button type="button" className={styles.clear} onClick={clearCompare}>Clear all</button>
            </div>

            {snap.collapsed ? null : (
                <div className={styles.body}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.corner} aria-label="Card" />
                                {snap.cards.map(({ card, image_uri, name }) => (
                                    <th scope="col" key={card.id} className={styles.head}>
                                        <div className={styles.headInner}>
                                            <img src={card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? image_uri} alt="" width={46} height={64} loading="lazy" />
                                            <span className={styles.name}>{name}</span>
                                            <button type="button" className={styles.remove} onClick={() => removeCompare(card.id)} aria-label={`Remove ${name} from compare`} title="Remove">×</button>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ROWS.map((row) => (
                                <tr key={row.label}>
                                    <th scope="row" className={styles.label}>{row.label}</th>
                                    {snap.cards.map(({ card }) => {
                                        const value = row.value(card as ScryfallCard)
                                        return <td key={card.id}>{value === '' ? <span className={styles.muted}>—</span> : value}</td>
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </aside>
    )
}
