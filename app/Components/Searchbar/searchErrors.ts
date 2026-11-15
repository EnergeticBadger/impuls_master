// What to tell the user when a search fails. `status` is the HTTP-style status of the failure,
// or undefined when no answer came back at all (a network failure).
// undefined means there's nothing to say on screen (the error is just logged).
export function searchErrorMessage(status: number | undefined): string | undefined {
    if (status === undefined) return "Couldn't reach the search. Check your connection and try again."
    if (status === 404 || status === 400) return 'No cards found'
    if (status === 503 || status === 429) return 'Scryfall is busy right now. Try again in a moment.'
    return undefined
}
