// Our own list of mechanics that Scryfall has no keyword for, so `kw:` can't find them (it ignores kw:devotion).
// Each is a real Scryfall search, so picking one writes plain syntax that also works on Scryfall itself.
// They're shown in the Keyword filter as their own groups. The nightly card data (scripts/mechanics.ts) counts
// each one's cards into /data/mechanics.json.

// .ts with no ~/ imports, so scripts/mechanics.ts and the test scripts can load it in plain Node

// `value` is the label in lower case: the keyword picker stores what's picked that way.
// `token` is one term or one bracketed group, so it reads back as a single chip (mechanicByToken)
export type Mechanic = { value: string, label: string, token: string }

const mechanic = (label: string, token: string): Mechanic => ({ value: label.toLowerCase(), label, token })

// each checked against Scryfall on 7 Oct 2026, from 14 cards (Villainous choice) to 143 (Energy)
export const MECHANICS: Mechanic[] = [
    mechanic('Devotion', 'o:"devotion to"'),
    mechanic('Party', 'o:"your party"'),
    mechanic('Monarch', 'o:monarch'),
    mechanic('Initiative', 'o:"the initiative"'),
    mechanic('Energy', 'o:{E}'),
    mechanic('Experience counters', 'o:"experience counter"'),
    mechanic('Poison counters', '(o:"poison counter" or kw:toxic or kw:infect or kw:poisonous)'),
    mechanic('Day and night', '(o:daybound or o:"it becomes day" or o:"it becomes night")'),
    mechanic("City's blessing", `o:"city's blessing"`),
    mechanic('The Ring tempts you', 'o:"the ring tempts you"'),
    mechanic('Dungeons', 'o:dungeon'),
    mechanic('Dice rolling', 'o:/roll(s)? (a|one or more|two|\\w+) (d\\d+|dice|die)/'),
    mechanic('Coin flipping', 'o:"flip a coin"'),
    mechanic('Attractions', 'o:attraction'),
    mechanic('Stickers', 'o:sticker'),
    mechanic('Villainous choice', 'o:"villainous choice"'),
    mechanic('Rad counters', 'o:"rad counter"'),
    mechanic('Voting', 'o:vote'),
]

// Affinity for X: a spell costs {1} less for each X you control. kw:affinity finds all of them; these find one X.
// X is a card type (artifacts) or a subtype (Equipment, Forests, Elves), so the two are listed apart. `words` is X
// as cards print it, and the What it does filter's affinity pieces (./rules.ts) are made from the same lists.
// Every X Scryfall had on 8 Oct 2026, 81 cards in all: artifacts 41, creatures and Equipment 4, the rest 1 or 2
export type Affinity = Mechanic & { words: string }

const affinity = (words: string): Affinity => ({ ...mechanic(`Affinity for ${words}`, `o:"affinity for ${words.toLowerCase()}"`), words })

export const AFFINITY_TYPES: Affinity[] = [
    'artifacts', 'artifact creatures', 'creatures', 'enchantments', 'planeswalkers', 'snow lands',
    // not types, but kinds of card picked out the same way
    'historic permanents', 'outlaws', 'tokens',
].map(affinity)

export const AFFINITY_SUBTYPES: Affinity[] = [
    'Allies', 'Auras', 'Birds', 'Cats', 'Citizens', 'Clowns', 'Daleks', 'Elves', 'Equipment', 'Foods', 'Forests',
    'Frogs', 'Gates', 'Goats', 'Humans', 'Islands', 'Knights', 'Lizards', 'Mountains', 'Plains', 'Slivers', 'Spirits',
    'Swamps', 'Towns',
].map(affinity)

// every search of ours the Keyword filter offers, each counted into /data/mechanics.json
export const OUR_SEARCHES: Mechanic[] = [...MECHANICS, ...AFFINITY_TYPES, ...AFFINITY_SUBTYPES]

export const mechanicByValue = (value: string) => OUR_SEARCHES.find((m) => m.value === value.toLowerCase())

// a search term that's exactly one mechanic's search, or that search left out (`-o:"devotion to"`)
export function mechanicByToken(term: string): { mechanic: Mechanic, exclude: boolean } | undefined {
    const exclude = term.startsWith('-')
    const t = exclude ? term.slice(1) : term
    const hit = OUR_SEARCHES.find((m) => m.token.toLowerCase() === t.toLowerCase())
    return hit && { mechanic: hit, exclude }
}

// /data/mechanics.json, written each night by scripts/mechanics.ts. Each count is for the token it was made
// with, so a mechanic whose search has changed since isn't shown with an old count
export type MechanicsFile = {
    built: string
    mechanics: Record<string, { token: string, count: number, ids: string[] }>
}
