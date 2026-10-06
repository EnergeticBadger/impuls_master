// Scryfall's limits on regular expressions, found by trying them against its API. Going past one doesn't fail
// loudly: Scryfall drops that regex and searches without it (or, with too many, refuses the whole search),
// so the cards shown quietly stop matching what was asked. The search box checks for them before searching.

// a regex much longer than this is dropped; exactly where depends on what's in it, somewhere around 245–250
export const MAX_REGEX_CHARS = 240
// brackets inside brackets inside brackets are dropped, whatever kind: ((a|(b)) c), (?=(a|(b)))
export const MAX_REGEX_DEPTH = 2
// a search with more regexes than this is refused
export const MAX_REGEXES = 6

// every /regex/ in a search, e.g. the draws? of o:/draws?/; quoted text is skipped
export function findRegexes(query: string): string[] {
    const found: string[] = []
    let quoted = false
    for (let i = 0; i < query.length; i++) {
        const ch = query[i]
        if (ch === '"') quoted = !quoted
        // a regex starts right after a keyword's : or =, like o:/ or name=/
        if (quoted || ch !== '/' || !/\w[:=]$/.test(query.slice(Math.max(0, i - 2), i))) continue
        let end = i + 1
        while (end < query.length && query[end] !== '/') end += query[end] === '\\' ? 2 : 1
        found.push(query.slice(i + 1, end))
        i = end
    }
    return found
}

// how deep the brackets go; escaped ones and ones inside [classes] don't count
export function regexDepth(re: string): number {
    let depth = 0, deepest = 0, inClass = false
    for (let i = 0; i < re.length; i++) {
        const ch = re[i]
        if (ch === '\\') i++
        else if (inClass) inClass = ch !== ']'
        else if (ch === '[') inClass = true
        else if (ch === '(') deepest = Math.max(deepest, ++depth)
        else if (ch === ')') depth--
    }
    return deepest
}

const excerpt = (re: string) => `/${re.length > 32 ? `${re.slice(0, 32)}…` : re}/`

// what Scryfall will drop or refuse in this search, as sentences; empty when it's all within the limits
export function regexProblems(query: string): string[] {
    const regexes = findRegexes(query)
    const problems: string[] = []
    for (const re of regexes) {
        if (re.length > MAX_REGEX_CHARS) problems.push(`${excerpt(re)} is ${re.length} characters long. Scryfall ignores a regex much past ${MAX_REGEX_CHARS} characters and searches without it, so the results won't match it. Split it into shorter regexes joined with “or”.`)
        if (regexDepth(re) > MAX_REGEX_DEPTH) problems.push(`${excerpt(re)} has brackets ${regexDepth(re)} deep. Scryfall ignores a regex with brackets more than ${MAX_REGEX_DEPTH} deep and searches without it.`)
    }
    if (regexes.length > MAX_REGEXES) problems.push(`This search has ${regexes.length} regexes. Scryfall allows ${MAX_REGEXES} at most and won't run it. Take some filters out, or combine regexes with “|”.`)
    return problems
}
