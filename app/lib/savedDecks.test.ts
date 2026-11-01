import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { addCard } from "./deck.ts";
import { copyDeck, deckToBuild, newDeck, readSavedDecks } from "./savedDecks.ts";

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

test("a copy gets a new id, name and time, and equal cards", () => {
    const original = {
        ...newDeck("Mono-Red", 1, "a"),
        deck: {
            main: [{ card: card("1", "Bolt"), count: 4 }],
            side: [{ card: card("3", "Neg"), count: 2 }],
            commander: { card: card("4", "Boss"), count: 1 },
        },
    }
    const copy = copyDeck(original, 9, "b")
    assert.equal(copy.id, "b")
    assert.equal(copy.name, "Mono-Red (copy)")
    assert.equal(copy.updated, 9)
    assert.deepEqual(copy.deck, original.deck)
    assert.notEqual(copy.deck, original.deck)
})

test("changing a copy leaves the original's main unchanged", () => {
    const original = { ...newDeck("Burn", 1, "a"), deck: { main: [{ card: card("1", "Bolt"), count: 4 }], side: [] } }
    const copy = copyDeck(original, 2, "b")
    const changed = { ...copy, deck: addCard(copy.deck, card("2", "Shock")) }
    assert.deepEqual(changed.deck.main.map((e) => e.card.id), ["1", "2"])
    assert.deepEqual(original.deck.main, [{ card: card("1", "Bolt"), count: 4 }])
    assert.deepEqual(copy.deck.main, [{ card: card("1", "Bolt"), count: 4 }])
})

test("deckToBuild prefers the current deck, else the most recently updated", () => {
    const old = newDeck("Old", 1, "a")
    const recent = newDeck("Recent", 5, "b")
    assert.equal(deckToBuild([old, recent], "a"), old)
    assert.equal(deckToBuild([old, recent], undefined), recent)
    assert.equal(deckToBuild([old, recent], "gone"), recent)
    assert.equal(deckToBuild([], "a"), undefined)
})
