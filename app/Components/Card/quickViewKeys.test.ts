import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickViewAction } from './quickViewKeys.ts'

test('Escape closes', () => {
    assert.equal(quickViewAction('Escape', 2, 5, false), 'close')
})

test('arrows move to the previous and next card', () => {
    assert.deepEqual(quickViewAction('ArrowLeft', 2, 5, false), { go: 1 })
    assert.deepEqual(quickViewAction('ArrowRight', 2, 5, false), { go: 3 })
})

test('no wrap at either end', () => {
    assert.equal(quickViewAction('ArrowLeft', 0, 5, false), undefined)
    assert.equal(quickViewAction('ArrowRight', 4, 5, false), undefined)
    assert.deepEqual(quickViewAction('ArrowRight', 0, 5, false), { go: 1 })
    assert.deepEqual(quickViewAction('ArrowLeft', 4, 5, false), { go: 3 })
})

test('a single card has nowhere to go', () => {
    assert.equal(quickViewAction('ArrowLeft', 0, 1, false), undefined)
    assert.equal(quickViewAction('ArrowRight', 0, 1, false), undefined)
})

test('a card that is not in the results ignores the arrows but still closes', () => {
    assert.equal(quickViewAction('ArrowRight', -1, 5, false), undefined)
    assert.equal(quickViewAction('ArrowLeft', 5, 5, false), undefined)
    assert.equal(quickViewAction('Escape', -1, 0, false), 'close')
})

test('keys typed into an input are ignored', () => {
    assert.equal(quickViewAction('Escape', 2, 5, true), undefined)
    assert.equal(quickViewAction('ArrowLeft', 2, 5, true), undefined)
    assert.equal(quickViewAction('ArrowRight', 2, 5, true), undefined)
})

test('other keys do nothing', () => {
    assert.equal(quickViewAction('a', 2, 5, false), undefined)
    assert.equal(quickViewAction('Enter', 2, 5, false), undefined)
})
