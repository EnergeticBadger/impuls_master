import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { deckToBuild, newDeck, readSavedDecks, slimCard, slimDeck } from "./savedDecks.ts";
import { colorCounts, legalityProblems, manaCurve, type Deck } from "./deck.ts";

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

// ---- slimming ----

const url = (s: string) => `https://cards.scryfall.io/${s}/front/a/b/abcdef12-3456-7890-abcd-ef1234567890.jpg?1700000000`
const images = (extra = "") => ({
    small: url(`small${extra}`), normal: url(`normal${extra}`), large: url(`large${extra}`), png: url(`png${extra}`),
    art_crop: url(`art_crop${extra}`), border_crop: url(`border_crop${extra}`),
})
const fullCard = (over: Record<string, unknown> = {}) => ({
    object: "card", id: "id-1", oracle_id: "o-1", multiverse_ids: [1, 2], name: "Lightning Bolt", lang: "en",
    released_at: "2020-01-01", uri: url("uri"), scryfall_uri: url("suri"), layout: "normal", highres_image: true,
    image_status: "highres_scan", image_uris: images(), mana_cost: "{R}", cmc: 1, type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.", flavor_text: "Some flavor text goes here.",
    colors: ["R"], color_identity: ["R"], keywords: [], legalities: { standard: "not_legal", commander: "legal", modern: "legal" },
    games: ["paper", "mtgo"], set_id: "s", set: "m11", set_name: "Magic 2011", set_type: "core", set_uri: url("set"),
    set_search_uri: url("search"), scryfall_set_uri: url("sset"), rulings_uri: url("rulings"), prints_search_uri: url("prints"),
    collector_number: "149", rarity: "common", artist: "Christopher Moeller", artist_ids: ["a"], illustration_id: "i",
    border_color: "black", frame: "2003", prices: { usd: "1.00", usd_foil: "3.00", usd_etched: null, eur: "0.90", eur_foil: null, tix: "0.02" },
    related_uris: { gatherer: url("g"), edhrec: url("e"), tcgplayer_infinite_decks: url("d") },
    purchase_uris: { tcgplayer: url("t"), cardmarket: url("c"), cardhoarder: url("h") },
    all_parts: [{ id: "p", component: "token", name: "Thing", uri: url("p") }],
    ...over,
}) as unknown as ScryfallCard

test("slimCard drops extra fields and keeps the used ones equal", () => {
    const full = fullCard()
    const slim = slimCard(full)
    const s = slim as unknown as Record<string, unknown>
    for (const k of ["purchase_uris", "related_uris", "all_parts", "flavor_text", "artist", "uri"]) assert.equal(k in s, false, k)
    assert.deepEqual(slim.image_uris, { small: full.image_uris!.small, normal: full.image_uris!.normal })
    assert.deepEqual(slim.prices, { usd: "1.00", usd_foil: "3.00", eur: "0.90", tix: "0.02" })
    for (const k of ["id", "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "colors",
        "color_identity", "legalities", "set", "collector_number", "rarity"] as const) {
        assert.deepEqual(slim[k], full[k], k)
    }
})

test("slimCard leaves missing fields missing", () => {
    const slim = slimCard({ id: "1", name: "Bare" } as unknown as ScryfallCard)
    assert.deepEqual(Object.keys(slim).sort(), ["id", "name"])
})

test("slimCard keeps both faces of a double-faced card", () => {
    const dfc = fullCard({
        layout: "transform", image_uris: undefined, mana_cost: undefined, name: "Front // Back",
        card_faces: [
            { name: "Front", mana_cost: "{1}{W}", type_line: "Creature", oracle_text: "a", colors: ["W"], flavor_text: "x", artist: "y", image_uris: images("f") },
            { name: "Back", mana_cost: "", type_line: "Creature", oracle_text: "b", colors: ["B"], image_uris: images("b") },
        ],
    })
    const slim = slimCard(dfc)
    assert.deepEqual(slim.card_faces?.map((f) => f.name), ["Front", "Back"])
    assert.deepEqual(slim.card_faces?.map((f) => f.mana_cost), ["{1}{W}", ""])
    assert.deepEqual(slim.card_faces?.map((f) => f.image_uris?.small), [url("smallf"), url("smallb")])
    assert.deepEqual(Object.keys(slim.card_faces![0].image_uris!).sort(), ["normal", "small"])
    assert.equal("flavor_text" in slim.card_faces![0], false)
})

test("a slimmed realistic card is under half the size", () => {
    const full = fullCard()
    assert.ok(JSON.stringify(slimCard(full)).length < JSON.stringify(full).length / 2)
})

test("deck stats are the same on a slimmed deck", () => {
    const land = fullCard({ id: "l", name: "Forest", type_line: "Basic Land — Forest", colors: [], cmc: 0, legalities: { commander: "legal" } })
    const dfc = fullCard({
        id: "d", name: "Front // Back", layout: "transform", colors: [], cmc: 3, image_uris: undefined,
        legalities: { commander: "legal" },
        card_faces: [{ name: "Front", mana_cost: "{2}{G}", type_line: "Creature", colors: ["G"], image_uris: images("f") }, { name: "Back", type_line: "Creature" }],
    })
    const illegal = fullCard({ id: "i", name: "Banned", legalities: { commander: "banned" }, cmc: 9, colors: ["U", "B"] })
    const deck: Deck = {
        main: [{ card: fullCard(), count: 3 }, { card: land, count: 10 }, { card: dfc, count: 1 }, { card: illegal, count: 1 }],
        side: [{ card: fullCard({ id: "s", name: "Side" }), count: 1 }],
        commander: { card: fullCard({ id: "c", name: "Boss", colors: ["R", "G"], color_identity: ["R", "G"] }), count: 1 },
    }
    const slim = slimDeck(deck)
    assert.deepEqual(colorCounts(slim), colorCounts(deck))
    assert.deepEqual(manaCurve(slim), manaCurve(deck))
    for (const f of ["commander", "modern", "standard"]) assert.deepEqual(legalityProblems(slim, f), legalityProblems(deck, f))
})

test("readSavedDecks slims what it reads", () => {
    const saved = { ...newDeck("Burn", 1, "b"), deck: { main: [{ card: fullCard(), count: 2 }], side: [] } }
    const [read] = readSavedDecks([saved])
    assert.equal("purchase_uris" in read.deck.main[0].card, false)
    assert.equal(read.deck.main[0].count, 2)
})
