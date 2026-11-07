import assert from "node:assert/strict";
import { test } from "node:test";
import { hasTerm, toggleTerm } from "./queryTerms.ts";

test("toggleTerm adds the term to the end", () => {
    assert.equal(toggleTerm("t:elf c:g", "id<=g"), "t:elf c:g id<=g")
})

test("toggleTerm adds to an empty query", () => {
    assert.equal(toggleTerm("", "id<=ub"), "id<=ub")
    assert.equal(toggleTerm("   ", "id<=ub"), "id<=ub")
})

test("toggleTerm removes the term and the extra space", () => {
    assert.equal(toggleTerm("t:elf id<=g c:g", "id<=g"), "t:elf c:g")
    assert.equal(toggleTerm("t:elf id<=g", "id<=g"), "t:elf")
    assert.equal(toggleTerm("id<=g", "id<=g"), "")
})

test("toggleTerm replaces any other identity term", () => {
    assert.equal(toggleTerm("id<=wu t:elf", "id<=g"), "t:elf id<=g")
    assert.equal(toggleTerm("t:elf id:c", "id<=g"), "t:elf id<=g")
    assert.equal(toggleTerm("t:elf -id:r", "id<=g"), "t:elf -id:r id<=g")
})

test("hasTerm finds a whole word only", () => {
    assert.equal(hasTerm("t:elf id<=g", "id<=g"), true)
    assert.equal(hasTerm("t:elf id<=gw", "id<=g"), false)
})
