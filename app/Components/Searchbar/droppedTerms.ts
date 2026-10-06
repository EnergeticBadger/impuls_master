// Terms Scryfall drops without a sign in the results: a minus in front of a number comparison. It reads the minus
// as part of the key ("-mv", which it doesn't know) and searches without the term, so `-mv>=3 t:sliver` is every
// sliver. -(mv>=3) and mv<3 work. Found by comparing with Scryfall (scripts/test-syntax.ts); the local search in
// scripts/local-search.ts drops them the same way.

// the keys this happens to; -mv:even, -c=2, -r>=rare and the like are read as meant
export const MINUS_DROPPED = new Set(['mv', 'cmc', 'manavalue', 'pow', 'power', 'tou', 'toughness', 'loy', 'loyalty', 'pt', 'powtou',
    'usd', 'eur', 'tix', 'year', 'edhrec', 'edhrecrank', 'cn', 'number', 'prints', 'sets', 'paperprints', 'papersets'])

const OPPOSITE: Record<string, string> = { '>=': '<', '<=': '>', '>': '<=', '<': '>=', '=': '!=', ':': '!=', '!=': '=' }

// a note for each such term in the search, with what to write instead
export function droppedTerms(query: string): string[] {
    const notes: string[] = []
    for (const m of query.matchAll(/(?:^|[\s(])-([a-z]+)(>=|<=|!=|=|:|<|>)([^\s()"]+)/gi)) {
        const [, key, op, value] = m
        if (!MINUS_DROPPED.has(key.toLowerCase()) || /^(even|odd)$/i.test(value)) continue
        notes.push(`Scryfall ignores “-${key}${op}${value}”: it reads the minus as part of the key. Write ${key}${OPPOSITE[op]}${value} instead.`)
    }
    return notes
}
