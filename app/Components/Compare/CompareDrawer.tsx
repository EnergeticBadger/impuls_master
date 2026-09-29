import { Fragment, useEffect, type ReactNode } from 'react';
import { useSnapshot } from 'valtio';
import styles from './Compare.module.css'
import cardStyles from '../Card/Card.module.css'
import { clearCompare, compare, loadCompare, removeCompare } from '../Context/compare';
import type { CardProps, ScryfallCard } from '~/types';
import { useCardLayout } from '../Hooks/useCardLayout';
import { OPEN_ICON, QuickView, openQuickView } from '../Card/QuickView';
import { ShareButton } from '../CardDetails/ShareButton';
import { ManaText, OracleText } from '../CardDetails/ManaText';
import { cardPath } from '~/lib/card';

// formats worth a glance when comparing; the quick view has the full list
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl']

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

// a list of colors as mana symbols; none is colorless
const colorSymbols = (colors: readonly string[] | undefined) =>
    colors?.length ? <ManaText text={colors.map((x) => `{${x}}`).join('')} /> : 'Colorless'

// double-faced cards keep their colors on the faces
const cardColors = (c: ScryfallCard) =>
    c.colors ?? [...new Set(c.card_faces?.flatMap((f) => (f as { colors?: string[] }).colors ?? []))]

// each face's rules text, headed by its name when the card has more than one
function RulesText({ card }: { card: ScryfallCard }) {
    const faces = card.card_faces?.filter((f) => f.oracle_text !== undefined)
    if (!faces?.length || card.oracle_text) return <OracleText text={card.oracle_text} />
    return faces.map((f, i) => (
        <Fragment key={i}>
            <p className={styles.faceName}>{f.name}</p>
            <OracleText text={f.oracle_text} />
        </Fragment>
    ))
}

// One row per thing worth comparing. Desktop and tablet keep to what the cards do; phones keep the fuller
// list they had (`phone`), and a few rows are only for the wider layout (`wide`).
const ROWS: { label: string, value: (c: ScryfallCard) => ReactNode, only?: 'wide' | 'phone' }[] = [
    { label: 'Mana cost', value: (c) => { const cost = faced(c, (f) => f.mana_cost); return cost ? <ManaText text={cost} /> : '' } },
    { label: 'Mana value', value: (c) => String(c.cmc ?? '') },
    { label: 'Color', value: (c) => colorSymbols(cardColors(c)), only: 'wide' },
    { label: 'Color identity', value: (c) => colorSymbols(c.color_identity) },
    { label: 'Type', value: (c) => c.type_line },
    { label: 'Rules text', value: (c) => <RulesText card={c} /> },
    { label: 'Power / toughness', value: stat },
    { label: 'Rarity', value: (c) => capital(c.rarity ?? ''), only: 'phone' },
    { label: 'Price', value: price, only: 'phone' },
    { label: 'EDHREC rank', value: (c) => c.edhrec_rank ? `#${c.edhrec_rank.toLocaleString()}` : '', only: 'phone' },
    {
        label: 'Legal in', only: 'phone', value: (c) => {
            const legal = FORMATS.filter((f) => c.legalities?.[f] === 'legal' || c.legalities?.[f] === 'restricted')
            return legal.length ? legal.map(capital).join(', ') : 'None of the main formats'
        }
    },
    { label: 'Set', value: (c) => `${c.set_name} (${c.set?.toUpperCase()})`, only: 'phone' },
    { label: 'Artist', value: (c) => c.artist, only: 'phone' },
]

const rowClass = (only?: 'wide' | 'phone') => only === 'wide' ? styles.wideOnly : only === 'phone' ? styles.phoneOnly : undefined

// a card's column heading, pinned while the rows scroll
function CardHead({ name, id }: { name: string, id: string }) {
    return (
        <th scope="col" className={styles.head}>
            <div className={styles.headInner}>
                <span className={styles.name}>{name}</span>
                <button type="button" className={styles.remove} onClick={() => removeCompare(id)} aria-label={`Remove ${name} from compare`} title="Remove">×</button>
            </div>
        </th>
    )
}

// the card's image with quick view and share, under its name on desktop and tablet
function CardPicture({ props }: { props: CardProps }) {
    const { card, name } = props
    const layout = useCardLayout(card as ScryfallCard)
    const { currentFace } = layout
    // the drawer's quick views are keyed apart from the search results', which may show the same card
    const key = `compare:${card.id}`
    const open = () => openQuickView(key, card as ScryfallCard, currentFace.large_uri)

    return (
        <td className={styles.picture}>
            <button type="button" className={styles.art} onClick={open} aria-label={`Quick view of ${name}`}>
                <img src={currentFace.image_uri || props.image_uri} alt="" width={244} height={340} loading="lazy" />
            </button>
            <div className={styles.actions}>
                <button type="button" className={cardStyles.turn} onClick={open}>
                    <svg viewBox="0 -960 960 960"><path d={OPEN_ICON} /></svg>
                    Quick view
                </button>
                <ShareButton path={cardPath(card)} name={card.name} className={cardStyles.turn} />
            </div>
            <QuickView openKey={key} card={props} layout={layout} />
        </td>
    )
}

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
                {count === 1 ? <span className={styles.hint}>Add another card with its compare button</span> : null}
                <button type="button" className={styles.clear} onClick={clearCompare}>Clear all</button>
            </div>

            {snap.collapsed ? null : (
                <div className={styles.body}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.corner} aria-label="Card" />
                                {snap.cards.map(({ card, name }) => <CardHead key={card.id} name={name} id={card.id} />)}
                            </tr>
                        </thead>
                        <tbody>
                            <tr className={styles.wideOnly}>
                                <th scope="row" className={styles.label}><span className={styles.visuallyHidden}>Image</span></th>
                                {snap.cards.map((c) => <CardPicture key={c.card.id} props={c as CardProps} />)}
                            </tr>
                            {ROWS.map((row) => (
                                <tr key={row.label} className={rowClass(row.only)}>
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
