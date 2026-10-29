// ---- the deck model: pure functions over plain data, no state, no UI ----

import type { ScryfallCard } from "~/types";

export type DeckEntry = { card: ScryfallCard; count: number }
export type Deck = { main: DeckEntry[]; side: DeckEntry[]; commander?: DeckEntry }
export type DeckZone = "main" | "side"

export const TYPE_GROUPS = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"] as const
export type TypeGroup = (typeof TYPE_GROUPS)[number]

export const COLORS = ["W", "U", "B", "R", "G"] as const

export const emptyDeck = (): Deck => ({ main: [], side: [] })

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

// takes `count` copies out (default one); an entry with none left disappears
export function removeCard(deck: Deck, card: ScryfallCard, zone: DeckZone = "main", count = 1): Deck {
    const entries = deck[zone]
        .map(e => (e.card.name === card.name ? { ...e, count: e.count - count } : e))
        .filter(e => e.count > 0)
    return { ...deck, [zone]: entries }
}

const cardsOf = (deck: Deck): DeckEntry[] => (deck.commander ? [...deck.main, deck.commander] : deck.main)

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

// the main deck's entries by type, in TYPE_GROUPS order; empty groups are left out, and anything
// that fits none of them (a Dungeon, say) goes last under "Other"
export function groupByType(deck: Deck): { group: TypeGroup | "Other"; entries: DeckEntry[] }[] {
    const groups = [...TYPE_GROUPS, "Other" as const]
    return groups
        .map(group => ({ group, entries: cardsOf(deck).filter(e => typeGroupOf(e.card) === group) }))
        .filter(g => g.entries.length > 0)
}

// cards at each mana value, 0 up to 7 (index 7 is "7 or more"); lands aren't counted
export function manaCurve(deck: Deck): number[] {
    const curve = new Array<number>(8).fill(0)
    for (const { card, count } of cardsOf(deck)) {
        if (isLand(card)) continue
        curve[Math.min(7, Math.max(0, Math.floor(card.cmc ?? 0)))] += count
    }
    return curve
}

// how many cards are each color (a two-color card counts for both), plus "C" for colorless spells.
// Lands aren't counted.
export function colorCounts(deck: Deck): Record<"W" | "U" | "B" | "R" | "G" | "C", number> {
    const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const { card, count } of cardsOf(deck)) {
        if (isLand(card)) continue
        const colors = card.colors ?? []
        const known = COLORS.filter(c => colors.includes(c))
        if (known.length === 0) counts.C += count
        for (const c of known) counts[c] += count
    }
    return counts
}

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }

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
        const limit = commander ? (isBasicLand(card) || copyLimit(card) === Infinity ? Infinity : 1)
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
        const size = mainCount + (deck.commander?.count ?? 0)
        if (size !== 100) problems.push(`A Commander deck has exactly 100 cards (this has ${size}).`)
        if (deck.commander) {
            const identity = new Set(deck.commander.card.color_identity ?? [])
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
