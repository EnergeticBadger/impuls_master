import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchErrorMessage } from './searchErrors.ts'

test('404 and 400 are a search that found nothing', () => {
    assert.equal(searchErrorMessage(404), 'No cards found')
    assert.equal(searchErrorMessage(400), 'No cards found')
})

test('503 and 429 say Scryfall is busy', () => {
    const busy = 'Scryfall is busy right now. Try again in a moment.'
    assert.equal(searchErrorMessage(503), busy)
    assert.equal(searchErrorMessage(429), busy)
})

test('no status is a network failure', () => {
    assert.equal(searchErrorMessage(undefined), "Couldn't reach the search. Check your connection and try again.")
})

test('anything else has no message', () => {
    assert.equal(searchErrorMessage(500), undefined)
    assert.equal(searchErrorMessage(200), undefined)
    assert.equal(searchErrorMessage(0), undefined)
})
