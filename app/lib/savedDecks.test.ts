import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { oracleOf } from "./carddata.ts";
import { addCard, copiesIn, colorCounts, legalityProblems, manaCurve, type Deck } from "./deck.ts";
import { backupJson, filterDecks, mergeDecks, readBackup, copyDeck, deckToBuild, decksByRecent, newDeck, readSavedDecks, reloadFromStorage, saveErrorMessage, slimCard, slimDeck, writeGate, type SavedDeck } from "./savedDecks.ts";

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

test("a format is kept when it is a string, dropped otherwise", () => {
    const base = newDeck("Burn", 5, "b")
    assert.equal(readSavedDecks([{ ...base, format: "modern" }])[0].format, "modern")
    assert.equal("format" in readSavedDecks([{ ...base, format: 3 }])[0], false)
    assert.equal("format" in readSavedDecks([base])[0], false)
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

test("decksByRecent puts the most recently updated first without changing the input", () => {
    const a = newDeck("A", 1, "a")
    const b = newDeck("B", 3, "b")
    const c = newDeck("C", 2, "c")
    const list = [a, b, c]
    assert.deepEqual(decksByRecent(list), [b, c, a])
    assert.deepEqual(list, [a, b, c])
    assert.deepEqual(decksByRecent([]), [])
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

test("a well-formed deck re-serialises to the same JSON it was read from", () => {
    const scry = (id: string, name: string, extra: object = {}) => ({
        id, oracle_id: `o-${id}`, name, mana_cost: "{R}", type_line: "Instant",
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

test("reloadFromStorage takes the other tab's decks and keeps our current deck if it still exists", () => {
    const a = newDeck("A", 1, "a")
    const b = newDeck("B", 2, "b")
    const json = JSON.stringify({ list: [a, b], current: "b" })
    assert.deepEqual(reloadFromStorage(json, "a"), { list: [a, b], current: "a" })
    assert.deepEqual(reloadFromStorage(json, "gone"), { list: [a, b], current: undefined })
    assert.deepEqual(reloadFromStorage(json, undefined), { list: [a, b], current: undefined })
    assert.deepEqual(reloadFromStorage(null, "a"), { list: [], current: undefined })
    assert.throws(() => reloadFromStorage("{not json", "a"))
})

test("writeGate skips exactly one write after a reload", () => {
    const gate = writeGate()
    assert.equal(gate.shouldWrite(), true)
    gate.skipNext()
    assert.equal(gate.shouldWrite(), false)
    assert.equal(gate.shouldWrite(), true)
})

test("two tabs with different current decks do not ping-pong", () => {
    let stored: string | null = null
    let writes = 0
    type Tab = { list: SavedDeck[]; current?: string; gate: ReturnType<typeof writeGate> }
    const tabs: Tab[] = []
    // the store's subscribe: runs after any change, writes unless the change was a reload
    const notify = (tab: Tab) => {
        if (!tab.gate.shouldWrite()) return
        const json = JSON.stringify({ list: tab.list, current: tab.current })
        if (stored === json) return
        stored = json
        writes++
        for (const other of tabs) if (other !== tab) storageEvent(other, json)
    }
    const storageEvent = (tab: Tab, json: string) => {
        const next = reloadFromStorage(json, tab.current)
        tab.gate.skipNext()
        tab.list = next.list
        tab.current = next.current
        notify(tab)
    }
    const searchTab: Tab = { list: [], current: undefined, gate: writeGate() }
    const decksTab: Tab = { list: [], current: undefined, gate: writeGate() }
    tabs.push(searchTab, decksTab)
    decksTab.list = [newDeck("Burn", 1, "burn")]
    decksTab.current = "burn"
    notify(decksTab)
    assert.equal(writes, 1)
    assert.equal(searchTab.list.length, 1)
    assert.equal(searchTab.current, undefined)
})

test("backup then read gives the same decks", () => {
    const a = { ...newDeck("A", 5, "a"), deck: { main: [{ card: card("1", "Bolt"), count: 4 }], side: [] } }
    const b = newDeck("B", 7, "b")
    const read = readBackup(backupJson([a, b]))
    assert.equal(read.error, undefined)
    assert.deepEqual(read.decks, [a, b])
})

test("a bad backup file gives an error and no decks", () => {
    for (const text of ["not json at all", "{}", "[]", "null", JSON.stringify({ app: "other-app", version: 1, decks: [newDeck("X", 1, "x")] })]) {
        const read = readBackup(text)
        assert.deepEqual(read.decks, [])
        assert.equal(typeof read.error, "string")
    }
})

test("a backup drops bad deck entries", () => {
    const good = newDeck("Good", 1, "g")
    const read = readBackup(JSON.stringify({ app: "impulse-caster", version: 1, decks: [null, { id: "x" }, good] }))
    assert.equal(read.error, undefined)
    assert.deepEqual(read.decks, [good])
})

test("merging adds new ids and keeps the newer deck for a shared id", () => {
    const old = newDeck("Old", 1, "same")
    const newer = newDeck("Newer", 2, "same")
    const other = newDeck("Other", 1, "other")
    assert.deepEqual(mergeDecks([old], [newer, other]), [newer, other])
    assert.deepEqual(mergeDecks([newer], [old]), [newer])
})

// a reversible card in Scryfall's real API shape: no top-level oracle id, it is only on the faces
const IMAGES = { small: "s.jpg", normal: "n.jpg", large: "l.jpg", png: "p.png", art_crop: "a.jpg", border_crop: "b.jpg" }
const propagandaFace = {
    object: "card_face", name: "Propaganda", oracle_id: "prop-oracle", mana_cost: "{2}{U}", type_line: "Enchantment",
    oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    colors: ["U"], artist: "Someone", image_uris: IMAGES,
}
const reversible = {
    id: "prop-sld", name: "Propaganda // Propaganda", layout: "reversible_card", set: "sld", collector_number: "1",
    card_faces: [propagandaFace, { ...propagandaFace, artist: "Someone Else" }],
} as unknown as ScryfallCard
const regular = { id: "prop-tmp", oracle_id: "prop-oracle", name: "Propaganda", layout: "normal", set: "tmp" } as unknown as ScryfallCard

test("slimCard keeps the faces' oracle id of a reversible card", () => {
    const slim = slimCard(reversible)
    assert.equal(oracleOf(slim), "prop-oracle")
    assert.equal(slim.oracle_id, undefined)
})

test("a slimmed reversible card counts toward its copies in the deck", () => {
    let deck: Deck = { main: [], side: [] }
    for (let i = 0; i < 3; i++) deck = addCard(deck, slimCard(reversible))
    assert.equal(copiesIn(slimDeck(deck), "prop-oracle"), 3)

    let mixed: Deck = addCard({ main: [], side: [] }, slimCard(regular), "main", 2)
    mixed = addCard(mixed, slimCard(reversible))
    assert.equal(copiesIn(slimDeck(mixed), "prop-oracle"), 3)
})

test("readSavedDecks keeps the faces' oracle id", () => {
    const saved = [{ id: "d1", name: "Blue", updated: 1, deck: { main: [{ card: reversible, count: 1 }], side: [] } }]
    const [read] = readSavedDecks(JSON.parse(JSON.stringify(saved)))
    assert.equal(oracleOf(read.deck.main[0].card), "prop-oracle")
    assert.equal(copiesIn(read.deck, "prop-oracle"), 1)
})

test("saveErrorMessage says storage is full for a quota error", () => {
    const full = "Your browser's storage is full, so the latest deck changes were not saved. Delete a deck or copy this one out with Export."
    assert.equal(saveErrorMessage({ name: "QuotaExceededError" }), full)
    assert.equal(saveErrorMessage({ name: "NS_ERROR_DOM_QUOTA_REACHED" }), full)
})

test("saveErrorMessage gives the general message for anything else", () => {
    const other = "Your browser didn't let us save your decks, so the latest changes will be lost on reload."
    assert.equal(saveErrorMessage(new Error("SecurityError")), other)
    assert.equal(saveErrorMessage("nope"), other)
    assert.equal(saveErrorMessage(null), other)
    assert.equal(saveErrorMessage({ name: "SecurityError" }), other)
})

const named = ["Mono Red Burn", "Éowyn Tokens", "Izzet Phoenix", "Burn (old)", "Golgari Food"].map((name) => ({ name }))

test("filterDecks matches any case and ignores accents", () => {
    assert.deepEqual(filterDecks(named, "BURN").map((d) => d.name), ["Mono Red Burn", "Burn (old)"])
    assert.deepEqual(filterDecks(named, "eowyn").map((d) => d.name), ["Éowyn Tokens"])
    assert.deepEqual(filterDecks(named, "ÉOWYN").map((d) => d.name), ["Éowyn Tokens"])
})

test("filterDecks needs every word, in any order", () => {
    assert.deepEqual(filterDecks(named, "burn red").map((d) => d.name), ["Mono Red Burn"])
    assert.deepEqual(filterDecks(named, "  red   mono ").map((d) => d.name), ["Mono Red Burn"])
    assert.deepEqual(filterDecks(named, "burn izzet"), [])
})

test("filterDecks with an empty query keeps the whole list in order", () => {
    assert.deepEqual(filterDecks(named, ""), named)
    assert.deepEqual(filterDecks(named, "   "), named)
    assert.notEqual(filterDecks(named, ""), named, "a new array")
})

test("readSavedDecks keeps notes that are a string and drops anything else", () => {
    const base = { id: "d1", name: "Burn", updated: 1, deck: { main: [], side: [] } }
    const [kept] = readSavedDecks([{ ...base, notes: "Side in Smash vs artifacts.\nBuy 2 more Rift Bolt." }])
    assert.equal(kept.notes, "Side in Smash vs artifacts.\nBuy 2 more Rift Bolt.")
    for (const bad of [42, null, { text: "x" }, ["a"]]) {
        const [read] = readSavedDecks([{ ...base, notes: bad }])
        assert.equal("notes" in read, false, `notes ${JSON.stringify(bad)} is dropped`)
    }
})

test("notes survive a backup and restore", () => {
    const deck: SavedDeck = { id: "d1", name: "Burn", updated: 1, deck: { main: [], side: [] }, notes: "Mulligan hands without a 1-drop." }
    assert.equal(readBackup(backupJson([deck])).decks[0].notes, "Mulligan hands without a 1-drop.")
})
