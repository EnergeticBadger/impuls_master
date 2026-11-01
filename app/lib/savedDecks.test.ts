import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { deckToBuild, decksByRecent, newDeck, readSavedDecks } from "./savedDecks.ts";

const card = (id: string, name: string) => ({ id, name }) as unknown as ScryfallCard;

test("junk input gives no decks", () => {
    assert.deepEqual(readSavedDecks(null), [])
    assert.deepEqual(readSavedDecks("decks"), [])
    assert.deepEqual(readSavedDecks({ id: "a" }), [])
    assert.deepEqual(readSavedDecks([null, 3, "x", []]), [])
})

test("a deck missing its name or id is dropped", () => {
    const good = newDeck("Good", 1, "g")
    const noName = { id: "n", updated: 1, deck: { main: [], side: [] } }
    const noId = { name: "No id", updated: 1, deck: { main: [], side: [] } }
    assert.deepEqual(readSavedDecks([noName, good, noId]), [good])
})

test("cards without an id or a positive count are dropped", () => {
    const saved = {
        ...newDeck("Burn", 5, "b"),
        deck: {
            main: [{ card: card("1", "Bolt"), count: 4 }, { card: card("2", "Zero"), count: 0 }, { card: {}, count: 1 }],
            side: [{ card: card("3", "Neg"), count: -1 }],
        },
    }
    const [read] = readSavedDecks([saved])
    assert.deepEqual(read.deck.main, [{ card: card("1", "Bolt"), count: 4 }])
    assert.deepEqual(read.deck.side, [])
})

test("a good deck round-trips through JSON", () => {
    const deck = {
        ...newDeck("Burn", 5, "b"),
        deck: {
            main: [{ card: card("1", "Bolt"), count: 4 }],
            side: [{ card: card("3", "Neg"), count: 2 }],
            commander: { card: card("4", "Boss"), count: 1 },
        },
    }
    assert.deepEqual(readSavedDecks(JSON.parse(JSON.stringify([deck]))), [deck])
})

test("deckToBuild prefers the current deck, else the most recently updated", () => {
    const old = newDeck("Old", 1, "a")
    const recent = newDeck("Recent", 5, "b")
    assert.equal(deckToBuild([old, recent], "a"), old)
    assert.equal(deckToBuild([old, recent], undefined), recent)
    assert.equal(deckToBuild([old, recent], "gone"), recent)
    assert.equal(deckToBuild([], "a"), undefined)
})

test("decksByRecent puts the most recently updated first without changing the input", () => {
    const a = newDeck("A", 1, "a")
    const b = newDeck("B", 3, "b")
    const c = newDeck("C", 2, "c")
    const list = [a, b, c]
    assert.deepEqual(decksByRecent(list), [b, c, a])
    assert.deepEqual(list, [a, b, c])
    assert.deepEqual(decksByRecent([]), [])
})
