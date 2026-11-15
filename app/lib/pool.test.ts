import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPool } from "./pool.ts";

test("mapPool keeps the order of the items", async () => {
    const out = await mapPool([30, 5, 10, 1], 2, async (n) => { await new Promise((r) => setTimeout(r, n)); return n * 2 })
    assert.deepEqual(out, [60, 10, 20, 2])
})

test("mapPool never runs more than the limit at once", async () => {
    let running = 0, peak = 0
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
        peak = Math.max(peak, ++running)
        await new Promise((r) => setTimeout(r, 2))
        running--
    })
    assert.equal(peak, 3)
})

test("mapPool of nothing is empty", async () => {
    assert.deepEqual(await mapPool([], 4, async () => 1), [])
})
