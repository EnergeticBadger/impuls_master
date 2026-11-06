import assert from "node:assert/strict";
import { test } from "node:test";
import { canUndo, record, startHistory, undo } from "./history.ts";

test("startHistory has no past", () => {
    assert.deepEqual(startHistory(1), { past: [], present: 1 });
    assert.equal(canUndo(startHistory(1)), false);
});

test("record pushes the present onto past", () => {
    const h = record(record(startHistory(1), 2), 3);
    assert.deepEqual(h, { past: [1, 2], present: 3 });
    assert.equal(canUndo(h), true);
});

test("record keeps at most limit entries, dropping the oldest", () => {
    let h = startHistory(0);
    for (let i = 1; i <= 5; i++) h = record(h, i, 3);
    assert.deepEqual(h, { past: [2, 3, 4], present: 5 });
});

test("record defaults to a limit of 20", () => {
    let h = startHistory(0);
    for (let i = 1; i <= 30; i++) h = record(h, i);
    assert.equal(h.past.length, 20);
    assert.equal(h.past[0], 10);
});

test("undo restores the previous present", () => {
    const h = undo(record(record(startHistory(1), 2), 3));
    assert.deepEqual(h, { past: [1], present: 2 });
    assert.deepEqual(undo(h), { past: [], present: 1 });
});

test("undo with nothing to undo returns the same history", () => {
    const h = startHistory(1);
    assert.equal(undo(h), h);
});
