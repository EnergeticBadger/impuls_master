import { test } from 'node:test'
import assert from 'node:assert/strict'
import { curveBars } from './deckStats.ts'

test('an empty deck gives all zeros, not NaN', () => {
    const bars = curveBars([0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(bars.length, 8)
    for (const b of bars) {
        assert.equal(b.count, 0)
        assert.equal(b.pct, 0)
    }
})

test('heights are relative to the tallest bar', () => {
    const bars = curveBars([0, 4, 8, 2, 0, 0, 0, 1])
    assert.deepEqual(bars.map(b => b.pct), [0, 50, 100, 25, 0, 0, 0, 12.5])
})

test('labels run 0 to 7+', () => {
    const bars = curveBars([1, 1, 1, 1, 1, 1, 1, 1])
    assert.deepEqual(bars.map(b => b.label), ["0", "1", "2", "3", "4", "5", "6", "7+"])
})
