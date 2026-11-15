// Pure helpers for adding and removing one term of a search query string.

const words = (query: string) => query.split(/\s+/).filter(Boolean)
const isIdentityTerm = (w: string) => /^(id|identity)(<=|:)/i.test(w)

// whether the query has this term as one of its words
export function hasTerm(query: string, term: string): boolean {
    return words(query).some((w) => w.toLowerCase() === term.toLowerCase())
}

// the query with the term added at the end, or taken out when it is already there. Adding an `id<=`/`id:` term
// replaces any other one, so there is only ever one.
export function toggleTerm(query: string, term: string): string {
    if (hasTerm(query, term)) return words(query).filter((w) => w.toLowerCase() !== term.toLowerCase()).join(' ')
    const rest = isIdentityTerm(term) ? words(query).filter((w) => !isIdentityTerm(w)) : words(query)
    return [...rest, term].join(' ')
}
