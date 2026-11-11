// ---- the deck model: pure functions over plain data, no state, no UI ----

import type { ScryfallCard } from "~/types";
import { oracleOf } from "./carddata.ts";

export type DeckEntry = { card: ScryfallCard; count: number }
// partner: the second commander (partners, backgrounds, ...), count 1; only with a commander
export type Deck = { main: DeckEntry[]; side: DeckEntry[]; commander?: DeckEntry; partner?: DeckEntry }
export type DeckZone = "main" | "side"

export const TYPE_GROUPS = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"] as const
export type TypeGroup = (typeof TYPE_GROUPS)[number]

export const COLORS = ["W", "U", "B", "R", "G"] as const

// the search term for "inside these colors": `id<=ub` (WUBRG order), or `id<=c` for colorless. Always `id<=`, the
// form the search bar's chips write it back in (they turn `id:c` into `id<=c`), so the deck bar's toggle can find it
export function identityTerm(colors: readonly string[]): string {
  const kept = COLORS.filter((c) => colors.some((x) => x.toUpperCase() === c))
  return `id<=${kept.length ? kept.join("").toLowerCase() : "c"}`
}

// The mana cost to show. Scryfall leaves it off transform and modal cards, and our card data turns that
// into "", so an empty top-level cost falls through to the faces' costs.
export function manaCostOf(card: ScryfallCard): string {
  if (card.mana_cost) return card.mana_cost
  return (card.card_faces ?? []).map((f) => f.mana_cost).filter(Boolean).join(" // ")
}

export const emptyDeck =(): Deck => ({ main: [], side: [] })

// copies are told apart by name, so any printing of a card counts as the same card
function addTo(entries: DeckEntry[], card: ScryfallCard, count: number): DeckEntry[] {
    const i = entries.findIndex(e => e.card.name === card.name)
    if (i < 0) return [...entries, { card, count }]
    return entries.map((e, j) => (j === i ? { ...e, count: e.count + count } : e))
}

export function addCard(deck: Deck, card: ScryfallCard, zone: DeckZone = "main", count = 1): Deck {
    if (count < 1) return deck
    return { ...deck, [zone]: addTo(deck[zone], card, count) }
}

// same card by oracle id like copiesIn, falling back to the name when either has no oracle id
const sameCard = (a: ScryfallCard, b: ScryfallCard) => {
    const x = oracleOf(a)
    const y = oracleOf(b)
    return x && y ? x === y : a.name === b.name
}

// takes `count` copies out (default one) of the entry with the card's name, else of the first entry with
// the same oracle id; an entry with none left disappears
export function removeCard(deck: Deck, card: ScryfallCard, zone: DeckZone = "main", count = 1): Deck {
    const byName = deck[zone].findIndex(e => e.card.name === card.name)
    const i = byName >= 0 ? byName : deck[zone].findIndex(e => sameCard(e.card, card))
    if (i < 0) return deck
    const entries = deck[zone]
        .map((e, j) => (j === i ? { ...e, count: e.count - count } : e))
        .filter(e => e.count > 0)
    return { ...deck, [zone]: entries }
}

// moves one copy of the card from the main deck to the commander slot; a commander already there goes
// back to the main deck. A card that isn't in the main deck leaves the deck as it was.
export function setCommander(deck: Deck, card: ScryfallCard): Deck {
    const entry = deck.main.find(e => sameCard(e.card, card))
    if (!entry) return deck
    const taken = removeCard(deck, card, "main")
    const main = deck.commander ? addTo(taken.main, deck.commander.card, deck.commander.count) : taken.main
    return { ...taken, main, commander: { card: entry.card, count: 1 } }
}

// like setCommander, for the second commander slot; a partner already there goes back to the main deck
export function setPartner(deck: Deck, card: ScryfallCard): Deck {
    if (!deck.commander) return deck
    const entry = deck.main.find(e => sameCard(e.card, card))
    if (!entry) return deck
    const taken = removeCard(deck, card, "main")
    const main = deck.partner ? addTo(taken.main, deck.partner.card, deck.partner.count) : taken.main
    return { ...taken, main, partner: { card: entry.card, count: 1 } }
}

// the commander goes back to the main deck (merging with copies there) and a partner, if any, moves up to the
// commander slot. No commander: the deck comes back unchanged. The input is never changed.
export function removeCommander(deck: Deck): Deck {
    if (!deck.commander) return deck
    const { commander, partner, ...rest } = deck
    const next: Deck = { ...rest, main: addTo(deck.main, commander.card, commander.count) }
    if (partner) next.commander = partner
    return next
}

// the partner goes back to the main deck; the commander stays. No partner: unchanged.
export function removePartner(deck: Deck): Deck {
    if (!deck.partner) return deck
    const { partner, ...rest } = deck
    return { ...rest, main: addTo(deck.main, partner.card, partner.count) }
}

// the deck with `from`'s entry in `zone` holding the `to` printing instead, same count and place. When another
// entry in the zone already holds `to`, the two merge into one at whichever comes first. An unknown `from`
// gives the deck back unchanged; the input is never changed.
export function replacePrinting(deck: Deck, zone: DeckZone | "commander", from: ScryfallCard, to: ScryfallCard): Deck {
    if (zone === "commander") {
        if (deck.commander?.card.id !== from.id) return deck
        return { ...deck, commander: { ...deck.commander, card: to } }
    }
    const entries = deck[zone]
    const at = entries.findIndex(e => e.card.id === from.id)
    if (at < 0) return deck
    const other = entries.findIndex((e, i) => i !== at && e.card.id === to.id)
    if (other < 0) return { ...deck, [zone]: entries.map((e, i) => (i === at ? { ...e, card: to } : e)) }
    const first = Math.min(at, other)
    const merged = { card: to, count: entries[at].count + entries[other].count }
    return {
        ...deck,
        [zone]: entries.flatMap((e, i) => (i === first ? [merged] : i === at || i === other ? [] : [e])),
    }
}

// copies of a card in the main deck, whatever the printing (counted by oracle id)
export function copiesIn(deck: Deck, oracleId: string | undefined): number {
    if (!oracleId) return 0
    return deck.main.reduce((n, e) => (oracleOf(e.card) === oracleId ? n + e.count : n), 0)
}

const cardsOf = (deck: Deck): DeckEntry[] =>
    [...deck.main, ...(deck.commander ? [deck.commander] : []), ...(deck.partner ? [deck.partner] : [])]

// the commander's and partner's color identities together, in WUBRG order
export function commanderIdentity(deck: Deck): string[] {
    const identity = [...(deck.commander?.card.color_identity ?? []), ...(deck.partner?.card.color_identity ?? [])]
    return COLORS.filter(c => identity.includes(c))
}

const oracleLines = (card: ScryfallCard): string[] =>
    [card.oracle_text, ...(card.card_faces ?? []).map(f => f.oracle_text)]
        .flatMap(t => (t ?? "").split("\n").map(l => l.trim()))

const typeLines = (card: ScryfallCard): string[] =>
    [card.type_line, ...(card.card_faces ?? []).map(f => f.type_line)].flatMap(t => (t ?? "").split(" // "))

const hasLine = (card: ScryfallCard, re: RegExp) => oracleLines(card).some(l => re.test(l))

const partnersWith = (a: ScryfallCard, b: ScryfallCard) => {
    const want = `partner with ${b.name}`.toLowerCase()
    return oracleLines(a).some(l => l.toLowerCase().startsWith(want))
}

// whether two cards can be a deck's two commanders, by their oracle text on any face
export function canPartner(a: ScryfallCard, b: ScryfallCard): boolean {
    const plainPartner = /^Partner(\s*\(.*)?$/i
    if (hasLine(a, plainPartner) && hasLine(b, plainPartner)) return true
    if (partnersWith(a, b) || partnersWith(b, a)) return true
    const friends = /^Friends forever\b/i
    if (hasLine(a, friends) && hasLine(b, friends)) return true
    const background = (c: ScryfallCard) => typeLines(c).some(t => /\bBackground\b/.test(t))
    const chooses = /^Choose a Background\b/i
    if ((hasLine(a, chooses) && background(b)) || (hasLine(b, chooses) && background(a))) return true
    const doctor = (c: ScryfallCard) => typeLines(c).some(t => /\bCreature\b/.test(t) && /\bTime Lord\b/.test(t) && /\bDoctor\b/.test(t))
    const companion = /^Doctor's companion\b/i
    return (hasLine(a, companion) && doctor(b)) || (hasLine(b, companion) && doctor(a))
}

const frontType = (card: ScryfallCard) => (card.card_faces?.[0]?.type_line ?? card.type_line ?? "").split(" // ")[0]

const isLand = (card: ScryfallCard) => /\bLand\b/.test(frontType(card))

const isBasicLand = (card: ScryfallCard) => /\bBasic\b/.test(frontType(card)) && isLand(card)

// the group a card belongs to, by its front face. A creature that is also an artifact is a Creature; an
// artifact land is a Land.
const GROUP_ORDER: TypeGroup[] = ["Creature", "Land", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle"]

export function typeGroupOf(card: ScryfallCard): TypeGroup | "Other" {
    const type = frontType(card)
    return GROUP_ORDER.find(g => new RegExp(`\\b${g}\\b`).test(type)) ?? "Other"
}

// a new array of the entries by mana value (missing counts as 0), then by name; the input is not changed
export function sortEntries(entries: readonly DeckEntry[]): DeckEntry[] {
    return [...entries].sort((a, b) =>
        (a.card.cmc ?? 0) - (b.card.cmc ?? 0) || a.card.name.localeCompare(b.card.name))
}

// the main deck's entries by type, in TYPE_GROUPS order; empty groups are left out, and anything
// that fits none of them (a Dungeon, say) goes last under "Other". Each group is sorted by sortEntries.
export function groupByType(deck: Deck): { group: TypeGroup | "Other"; entries: DeckEntry[] }[] {
    const groups = [...TYPE_GROUPS, "Other" as const]
    return groups
        .map(group => ({ group, entries: sortEntries(cardsOf(deck).filter(e => typeGroupOf(e.card) === group)) }))
        .filter(g => g.entries.length > 0)
}

// a non-land card's place on the curve: its mana value, 0 up to 7 ("7 or more"), as manaCurve counts it
const curveSlot = (card: ScryfallCard) => Math.min(7, Math.max(0, Math.floor(card.cmc ?? 0)))

// the main deck (no commander) by mana value: non-land cards in "0" ... "6", "7+", then every land under "Lands";
// empty groups are left out, and each group is sorted by sortEntries. Lands go by the front face, like manaCurve.
export function groupByManaValue(deck: Deck): { group: string; entries: DeckEntry[] }[] {
    const slots: DeckEntry[][] = Array.from({ length: 8 }, () => [])
    const lands: DeckEntry[] = []
    for (const e of deck.main) {
        if (isLand(e.card)) lands.push(e)
        else slots[curveSlot(e.card)].push(e)
    }
    return [
        ...slots.map((entries, i) => ({ group: i === 7 ? "7+" : String(i), entries })),
        { group: "Lands", entries: lands },
    ]
        .filter(g => g.entries.length > 0)
        .map(g => ({ ...g, entries: sortEntries(g.entries) }))
}

// cards at each mana value, 0 up to 7 (index 7 is "7 or more"); lands aren't counted
export function manaCurve(deck: Deck): number[] {
    const curve = new Array<number>(8).fill(0)
    for (const { card, count } of cardsOf(deck)) {
        if (isLand(card)) continue
        curve[curveSlot(card)] += count
    }
    return curve
}

// a card's colors: top-level when it has any, else the front face's (API shape), else the colored
// symbols in the front face's mana cost (compact-data shape)
function colorsOf(card: ScryfallCard): string[] {
    if (card.colors && card.colors.length > 0) return card.colors
    const front = card.card_faces?.[0]
    if (!front) return []
    if (front.colors && front.colors.length > 0) return front.colors
    return COLORS.filter(c => new RegExp(`\\{(?:[^}]*/)?${c}(?:/[^}]*)?\\}`).test(front.mana_cost ?? ""))
}

// how many cards are each color (a two-color card counts for both), plus "C" for colorless spells.
// Lands aren't counted.
export function colorCounts(deck: Deck): Record<"W" | "U" | "B" | "R" | "G" | "C", number> {
    const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const { card, count } of cardsOf(deck)) {
        if (isLand(card)) continue
        const colors = colorsOf(card)
        const known = COLORS.filter(c => colors.includes(c))
        if (known.length === 0) counts.C += count
        for (const c of known) counts[c] += count
    }
    return counts
}

// lands and spells in the main deck plus the commander (by the front face, like manaCurve), and the spells'
// average mana value weighted by count, rounded to 2 decimals (0 with no spells)
export function deckSummary(deck: Deck): { lands: number; spells: number; averageManaValue: number } {
    let lands = 0, spells = 0, total = 0
    for (const { card, count } of cardsOf(deck)) {
        if (isLand(card)) {
            lands += count
        } else {
            spells += count
            total += (card.cmc ?? 0) * count
        }
    }
    return { lands, spells, averageManaValue: spells === 0 ? 0 : Math.round((total / spells) * 100) / 100 }
}

// the deck's colors in WUBRG order: its commander's color identity when it has one, else every color its spells
// use (colorCounts); [] for an empty or colorless deck
export function deckColors(deck: Deck): string[] {
    if (deck.commander) return commanderIdentity(deck)
    const counts = colorCounts(deck)
    return COLORS.filter(c => counts[c] > 0)
}

// shares `count` basic lands between the colors by the colored mana symbols in the main deck's and commander's
// mana costs (front face), weighted by card count. A hybrid symbol counts half for each of its colors;
// generic, colorless and X don't count. Largest-remainder rounding, ties in WUBRG order, so the parts add up
// to `count`. Returned in WUBRG order without zeros; no colored symbols gives [].
export function basicLandSplit(deck: Deck, count: number): { color: "W" | "U" | "B" | "R" | "G"; count: number }[] {
    // weights in half symbols
    const weight: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    for (const { card, count: copies } of cardsOf(deck)) {
        const front = manaCostOf(card).split(" // ")[0]
        for (const [, code] of front.matchAll(/\{([^}]+)\}/g)) {
            const colored = code.split("/").filter(p => COLORS.some(c => c === p))
            for (const c of colored) weight[c] += (2 / colored.length) * copies
        }
    }
    const sum = COLORS.reduce((n, c) => n + weight[c], 0)
    const total = Math.max(0, Math.floor(count))
    if (sum === 0 || total === 0) return []
    const parts = COLORS.map((color, order) => ({
        color, order,
        count: Math.floor((total * weight[color]) / sum),
        rest: (total * weight[color]) % sum,
    }))
    let left = total - parts.reduce((n, p) => n + p.count, 0)
    const byRest = [...parts].sort((a, b) => b.rest - a.rest || a.order - b.order)
    for (const p of byRest) {
        if (left <= 0) break
        if (p.rest > 0 || weight[p.color] > 0) { p.count++; left-- }
    }
    return parts.filter(p => p.count > 0).map(p => ({ color: p.color, count: p.count }))
}

// the cards to buy: commander, partner, main, then the sideboard when asked. the buy link and the price both use this
export const buyEntries = (deck: Deck, side: boolean): DeckEntry[] => [
    ...(deck.commander ? [deck.commander] : []),
    ...(deck.partner ? [deck.partner] : []),
    ...deck.main,
    ...(side ? deck.side : []),
]

// a rough total from the prices on the cards' printings. usd falls back to the foil, then etched price; cards with
// no price are listed by name (once) and add nothing
export function deckPrice(deck: Deck, opts: { side: boolean; currency: "usd" | "eur" | "tix" }): { total: number; missing: string[] } {
    const entries = buyEntries(deck, opts.side)
    let cents = 0
    const missing: string[] = []
    for (const { card, count } of entries) {
        const prices = card.prices as Partial<Record<string, string | null>> | undefined
        const raw = prices?.[opts.currency] ?? (opts.currency === "usd" ? prices?.usd_foil ?? prices?.usd_etched : undefined)
        const price = raw == null ? NaN : parseFloat(raw)
        if (Number.isNaN(price)) {
            if (!missing.includes(card.name)) missing.push(card.name)
            continue
        }
        cents += Math.round(price * 100) * count
    }
    return { total: cents / 100, missing }
}

// "$12.34", "€12.34" or "12.34 tix": always two decimals
export function formatPrice(total: number, currency: "usd" | "eur" | "tix"): string {
    const n = total.toFixed(2)
    if (currency === "usd") return `$${n}`
    if (currency === "eur") return `€${n}`
    return `${n} tix`
}

const NUMBER_WORDS:Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }

// most copies the rules let a deck hold: 4 normally, no limit for basic lands and "any number" cards,
// a stated number for cards like Seven Dwarves
function copyLimit(card: ScryfallCard): number {
    if (isBasicLand(card)) return Infinity
    const text = [card.oracle_text, ...(card.card_faces ?? []).map(f => f.oracle_text)].join("\n")
    if (/A deck can have any number of cards named/i.test(text)) return Infinity
    const upTo = /A deck can have up to (\w+) cards named/i.exec(text)
    if (upTo && NUMBER_WORDS[upTo[1].toLowerCase()]) return NUMBER_WORDS[upTo[1].toLowerCase()]
    return 4
}

// legendary creatures, and anything whose text says it can be your commander
export function canBeCommander(card: ScryfallCard): boolean {
    const faces = card.card_faces ?? []
    const type = frontType(card)
    if (/\bLegendary\b/.test(type) && /\bCreature\b/.test(type)) return true
    const text = [card.oracle_text, ...faces.map(f => f.oracle_text)].join("\n")
    if (/can be your commander/i.test(text)) return true
    if (/isn't on the battlefield, it's a [^.]*\bcreature\b/i.test(text)) return true
    const power = card.power ?? faces[0]?.power
    return /\bLegendary\b/.test(type) && /\b(Vehicle|Spacecraft)\b/.test(type) && power != null && power !== ""
}

const SIDEBOARD_MAX = 15
const MIN_MAIN = 60

// what's wrong with the deck for this format ("standard", "commander", ...), as sentences; none means legal
export function legalityProblems(deck: Deck, format: string): string[] {
    const fmt = format.toLowerCase()
    const commander = fmt === "commander"
    const problems: string[] = []
    const all = [...cardsOf(deck), ...deck.side]

    // a card is checked once, however many times it shows up
    const seen = new Set<string>()
    for (const { card } of all) {
        if (seen.has(card.name)) continue
        seen.add(card.name)
        const status = card.legalities?.[fmt]
        if (status !== "legal" && status !== "restricted") problems.push(`${card.name} is not legal in ${format}.`)
    }

    // copies are counted over main, side and commander together
    const totals = new Map<string, { card: ScryfallCard; count: number }>()
    for (const { card, count } of all) {
        totals.set(card.name, { card, count: (totals.get(card.name)?.count ?? 0) + count })
    }
    for (const { card, count } of totals.values()) {
        const limit = commander ? (copyLimit(card) !== 4 ? copyLimit(card) : 1)
            : card.legalities?.[fmt] === "restricted" ? 1 : copyLimit(card)
        if (count > limit) {
            problems.push(commander && limit === 1
                ? `${card.name} appears ${count} times; Commander decks are singleton.`
                : `${card.name} appears ${count} times; the limit is ${limit}.`)
        }
    }

    const mainCount = deck.main.reduce((n, e) => n + e.count, 0)
    const sideCount = deck.side.reduce((n, e) => n + e.count, 0)
    if (commander) {
        if (!deck.commander) {
            problems.push("There is no commander.")
        }
        const size = mainCount + (deck.commander?.count ?? 0) + (deck.partner?.count ?? 0)
        if (size !== 100) problems.push(`A Commander deck has exactly 100 cards (this has ${size}).`)
        if (deck.commander && deck.partner && !canPartner(deck.commander.card, deck.partner.card)) {
            problems.push(`${deck.commander.card.name} and ${deck.partner.card.name} can't both be commanders.`)
        }
        if (deck.commander) {
            const identity = new Set(commanderIdentity(deck))
            for (const { card } of deck.main) {
                const outside = (card.color_identity ?? []).filter(c => !identity.has(c))
                if (outside.length > 0) {
                    problems.push(`${card.name} has color identity outside the commander's (${outside.join("")}).`)
                }
            }
        }
    } else {
        if (mainCount < MIN_MAIN) problems.push(`The main deck needs at least ${MIN_MAIN} cards (this has ${mainCount}).`)
        if (sideCount > SIDEBOARD_MAX) problems.push(`The sideboard has at most ${SIDEBOARD_MAX} cards (this has ${sideCount}).`)
    }
    return problems
}
