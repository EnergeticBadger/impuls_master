import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { deckToBuild, newDeck, readSavedDecks } from "./savedDecks.ts";

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

test("a well-formed deck re-serialises to the same JSON it was read from", () => {
    const scry = (id: string, name: string, extra: object = {}) => ({
        id, oracle_id: `o-${id}`, name, type_line: "Instant", mana_cost: "{R}",
        legalities: { standard: "legal", commander: "legal" },
        image_uris: { small: `https://img/${id}-s.jpg`, normal: `https://img/${id}-n.jpg` },
        ...extra,
    }) as unknown as ScryfallCard
    const dfc = scry("d1", "Delver of Secrets // Insectile Aberration", {
        image_uris: undefined,
        card_faces: [
            { name: "Delver of Secrets", type_line: "Creature", image_uris: { small: "https://img/d1a.jpg" } },
            { name: "Insectile Aberration", type_line: "Creature", image_uris: { small: "https://img/d1b.jpg" } },
        ],
    })
    const saved = [{
        id: "deck-1", name: "Burn", updated: 1700000000000,
        deck: {
            main: [{ card: scry("c1", "Lightning Bolt"), count: 4 }, { card: dfc, count: 1 }],
            side: [{ card: scry("c2", "Smash to Smithereens"), count: 2 }],
            commander: { card: scry("c3", "Krenko, Mob Boss", { type_line: "Legendary Creature" }), count: 1 },
        },
    }]
    const s = JSON.stringify(saved)
    assert.equal(JSON.stringify(readSavedDecks(JSON.parse(s))), s)
})
