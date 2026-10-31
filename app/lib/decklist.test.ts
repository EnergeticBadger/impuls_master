import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import type { Deck } from "./deck.ts";
import { deckFromLines, formatDeckList, parseDeckList, type Line } from "./decklist.ts";

const card = (name: string, set: string, collector_number: string): ScryfallCard =>
    ({ name, set, collector_number }) as unknown as ScryfallCard;

const deck: Deck = {
    main: [
        { card: card("Opt", "xln", "65"), count: 4 },
        { card: card("Fire // Ice", "mh2", "290"), count: 2 },
        { card: card("Island", "snc", "270"), count: 20 },
    ],
    side: [{ card: card("Negate", "m21", "62"), count: 3 }],
    commander: { card: card("Atraxa, Praetors' Voice", "c16", "28"), count: 1 },
};

const names = (lines: Line[]) => lines.map(l => `${l.count} ${l.name}`);

for (const style of ["text", "arena", "mtgo"] as const) {
    test(`${style}: reads back what it writes`, () => {
        const parsed = parseDeckList(formatDeckList(deck, style));
        assert.deepEqual(parsed.problems, []);
        assert.deepEqual(names(parsed.main), ["4 Opt", "2 Fire // Ice", "20 Island"]);
        assert.deepEqual(names(parsed.side), ["3 Negate"]);
        assert.equal(parsed.commander?.name, "Atraxa, Praetors' Voice");
    });

    test(`${style}: reads back a deck with only a sideboard`, () => {
        const parsed = parseDeckList(formatDeckList({ main: [], side: deck.side }, style));
        assert.deepEqual(names(parsed.side), ["3 Negate"]);
        assert.equal(parsed.main.length, 0);
    });
}

test("arena writes set and number, and they read back", () => {
    const text = formatDeckList(deck, "arena");
    assert.match(text, /^4 Opt \(XLN\) 65$/m);
    const opt = parseDeckList(text).main[0];
    assert.deepEqual(opt, { count: 4, name: "Opt", set: "xln", number: "65" });
});

test("text and mtgo leave set and number out", () => {
    assert.doesNotMatch(formatDeckList(deck, "text"), /\(/);
    assert.equal(formatDeckList({ main: deck.main.slice(0, 1), side: [] }, "mtgo"), "4 Opt\n");
});

test("reads an Arena export", () => {
    const parsed = parseDeckList(`About
Name Izzet Phoenix

Deck
4 Opt (XLN) 65
4 Arclight Phoenix (GRN) 95
2 Fire // Ice (MH2) 290
20 Island (SNC) 270

Sideboard
2 Negate (M21) 62
`);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.main.length, 4);
    assert.deepEqual(parsed.main[1], { count: 4, name: "Arclight Phoenix", set: "grn", number: "95" });
    assert.deepEqual(names(parsed.side), ["2 Negate"]);
});

test("reads an Arena Commander export", () => {
    const parsed = parseDeckList(`Commander
1 Atraxa, Praetors' Voice (C16) 28

Deck
1 Sol Ring (C21) 263
35 Forest (SNC) 270
`);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.commander, { count: 1, name: "Atraxa, Praetors' Voice", set: "c16", number: "28" });
    assert.deepEqual(names(parsed.main), ["1 Sol Ring", "35 Forest"]);
});

test("reads an MTGO list with a blank line before the sideboard", () => {
    const parsed = parseDeckList("4 Lightning Bolt\r\n4 Goblin Guide\r\n20 Mountain\r\n\r\n3 Smash to Smithereens\r\n2 Pyroblast\r\n");
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(names(parsed.main), ["4 Lightning Bolt", "4 Goblin Guide", "20 Mountain"]);
    assert.deepEqual(names(parsed.side), ["3 Smash to Smithereens", "2 Pyroblast"]);
});

test("reads SB: lines", () => {
    const parsed = parseDeckList("4 Opt\nSB: 2 Negate\n");
    assert.deepEqual(names(parsed.main), ["4 Opt"]);
    assert.deepEqual(names(parsed.side), ["2 Negate"]);
});

test("reads plain text with 4x counts and a Sideboard header", () => {
    const parsed = parseDeckList("4x Opt\n 2x Xenagos, God of Revels \n4 Xathrid Necromancer\n\nSideboard\n1x Negate");
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(names(parsed.main), ["4 Opt", "2 Xenagos, God of Revels", "4 Xathrid Necromancer"]);
    assert.deepEqual(names(parsed.side), ["1 Negate"]);
});

test("unreadable lines are reported with their line number", () => {
    const parsed = parseDeckList("4 Opt\nOpt\n0 Negate\n\n2 Shock");
    assert.equal(parsed.problems.length, 2);
    assert.match(parsed.problems[0], /^Line 2:/);
    assert.match(parsed.problems[1], /^Line 3:/);
    assert.deepEqual(names(parsed.main), ["4 Opt"]);
    assert.deepEqual(names(parsed.side), ["2 Shock"]);
});

test("arena and mtgo write double-faced cards by front name, split cards in full", () => {
    const giant = {
        name: "Bonecrusher Giant // Stomp", layout: "adventure", set: "eld", collector_number: "115",
        card_faces: [{ name: "Bonecrusher Giant" }, { name: "Stomp" }],
    } as unknown as ScryfallCard;
    const fireIce = { ...card("Fire // Ice", "mh2", "290"), layout: "split" } as ScryfallCard;
    const d: Deck = { main: [{ card: giant, count: 4 }, { card: fireIce, count: 2 }], side: [] };
    const arena = formatDeckList(d, "arena");
    assert.match(arena, /^4 Bonecrusher Giant \(ELD\) 115$/m);
    assert.match(arena, /^2 Fire \/\/ Ice \(MH2\) 290$/m);
    const mtgo = formatDeckList(d, "mtgo");
    assert.match(mtgo, /^4 Bonecrusher Giant$/m);
    assert.match(mtgo, /^2 Fire \/\/ Ice$/m);
    assert.match(formatDeckList(d, "text"), /^4 Bonecrusher Giant \/\/ Stomp$/m);
});

test("an Arena companion that is also in the sideboard is read once", () => {
    const parsed = parseDeckList(`Companion
1 Lurrus of the Dream-Den (IKO) 226

Deck
4 Opt (XLN) 65
56 Island (SNC) 270

Sideboard
1 Lurrus of the Dream-Den (IKO) 226
14 Negate (M21) 62
`);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.side.filter(l => l.name.startsWith("Lurrus")).length, 1);
    assert.equal(parsed.side.reduce((n, l) => n + l.count, 0), 15);
    assert.deepEqual(names(parsed.main), ["4 Opt", "56 Island"]);
});

test("a companion missing from the sideboard is added to it", () => {
    const parsed = parseDeckList("Companion\n1 Lurrus of the Dream-Den\n\nDeck\n4 Opt\n");
    assert.deepEqual(names(parsed.side), ["1 Lurrus of the Dream-Den"]);
});

test("deckFromLines sorts lines into zones and adds the counts of a card named twice", () => {
    const opt = card("Opt", "xln", "65");
    const built = deckFromLines([
        { line: { count: 2, zone: "main" }, card: opt },
        { line: { count: 3, zone: "main" }, card: card("Opt", "dom", "60") },
        { line: { count: 1, zone: "side" }, card: opt },
        { line: { count: 1, zone: "commander" }, card: card("Atraxa", "c16", "28") },
    ]);
    assert.deepEqual(built.main.map(e => [e.card.name, e.count]), [["Opt", 5]]);
    assert.deepEqual(built.side.map(e => [e.card.name, e.count]), [["Opt", 1]]);
    assert.equal(built.commander?.card.name, "Atraxa");
    assert.deepEqual(deckFromLines([]), { main: [], side: [] });
});

test("an empty list parses to nothing and writes nothing", () => {
    assert.deepEqual(parseDeckList(""), { main: [], side: [], problems: [] });
    assert.equal(formatDeckList({ main: [], side: [] }, "text"), "");
});
