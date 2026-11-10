import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import type { Deck } from "./deck.ts";
import { deckFromLines, deckLinkHash, formatDeckList, parseDeckList, quickAddLine, readDeckLinkHash, unchangedEntries, type Line } from "./decklist.ts";

test("quickAddLine reads one typed line", () => {
  assert.deepEqual(quickAddLine("4 Opt"), { count: 4, name: "Opt" });
  assert.deepEqual(quickAddLine("Opt"), { count: 1, name: "Opt" });
  assert.deepEqual(quickAddLine("2x Opt"), { count: 2, name: "Opt" });
  assert.deepEqual(quickAddLine("1 Opt (M19) 65"), { count: 1, name: "Opt", set: "m19", number: "65" });
  assert.equal(quickAddLine(""), undefined);
  assert.equal(quickAddLine("   "), undefined);
});

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
        if (style === "mtgo") {
            // MTGO has no commander zone: the commander comes back as a sideboard line
            assert.deepEqual(names(parsed.side), ["1 Atraxa, Praetors' Voice", "3 Negate"]);
            assert.equal(parsed.commander, undefined);
        } else {
            assert.deepEqual(names(parsed.side), ["3 Negate"]);
            assert.equal(parsed.commander?.name, "Atraxa, Praetors' Voice");
        }
    });

    test(`${style}: reads back a deck with only a sideboard`, () => {
        const parsed = parseDeckList(formatDeckList({ main: [], side: deck.side }, style));
        assert.deepEqual(names(parsed.side), ["3 Negate"]);
        assert.equal(parsed.main.length, 0);
    });
}

test("mtgo: a commander deck has no headers and the commander after the blank line", () => {
    const commanderDeck: Deck = {
        main: [
            { card: card("Sol Ring", "c16", "1"), count: 1 },
            { card: card("Command Tower", "c16", "2"), count: 1 },
            { card: card("Forest", "c16", "3"), count: 30 },
        ],
        side: [],
        commander: { card: card("Atraxa, Praetors' Voice", "c16", "28"), count: 1 },
    };
    const text = formatDeckList(commanderDeck, "mtgo");
    assert.equal(text, "1 Sol Ring\n1 Command Tower\n30 Forest\n\n1 Atraxa, Praetors' Voice\n");
    assert.doesNotMatch(text, /^(Commander|Deck|Sideboard)$/m);
    const parsed = parseDeckList(text);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.main.reduce((n, l) => n + l.count, 0), 32);
    assert.deepEqual(names(parsed.side), ["1 Atraxa, Praetors' Voice"]);
});

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

test("reversible cards are written by their one name in every style", () => {
    const face = { name: "Propaganda", oracle_id: "prop-oracle", type_line: "Enchantment", mana_cost: "{2}{U}" };
    const propaganda = {
        name: "Propaganda // Propaganda", layout: "reversible_card", set: "sld", collector_number: "1446",
        card_faces: [face, { ...face }],
    } as unknown as ScryfallCard;
    const d: Deck = { main: [{ card: propaganda, count: 1 }], side: [] };
    assert.match(formatDeckList(d, "arena"), /^1 Propaganda \(SLD\) 1446$/m);
    assert.match(formatDeckList(d, "mtgo"), /^1 Propaganda$/m);
    assert.match(formatDeckList(d, "text"), /^1 Propaganda$/m);
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

test("deck link: round trips a non-ASCII name and a commander", () => {
    const hash = deckLinkHash("Æther Vial deck", deck);
    assert.match(hash, /^#deck=[A-Za-z0-9_-]+$/);
    const back = readDeckLinkHash(hash);
    assert.equal(back?.name, "Æther Vial deck");
    assert.equal(back?.text, formatDeckList(deck, "text"));
    const parsed = parseDeckList(back?.text ?? "");
    assert.equal(parsed.commander?.name, "Atraxa, Praetors' Voice");
    assert.deepEqual(names(parsed.main), ["4 Opt", "2 Fire // Ice", "20 Island"]);
});

test("deck link: garbage gives undefined", () => {
    const enc = (v: unknown) => `#deck=${Buffer.from(JSON.stringify(v)).toString("base64url")}`;
    for (const hash of ["", "#", "#deck=", "#other=abc", "#deck=!!!", "#deck=a", "#deck=bm90IGpzb24",
        enc({ n: "x" }), enc({ l: "1 Opt" }), enc({ n: 1, l: "1 Opt" }), enc(null), enc("str")]) {
        assert.equal(readDeckLinkHash(hash), undefined, hash);
    }
});

// ---- unchangedEntries: which lines of an edited list need no lookup ----

const base = formatDeckList(deck, "text");
const reusedNames = (r: { line: { count: number; zone: string }; card: ScryfallCard }[]) =>
    r.map(x => `${x.line.zone}:${x.line.count} ${x.card.name}`);

test("unchangedEntries: an unchanged list reuses every card", () => {
    const r = unchangedEntries(deck, base);
    assert.deepEqual(r.lookups, []);
    assert.deepEqual(r.problems, []);
    assert.equal(r.reused.length, 5);
    assert.equal(r.reused.find(x => x.card.name === "Opt")?.card, deck.main[0].card);
});

test("unchangedEntries: a changed count reuses the card with the new count", () => {
    const r = unchangedEntries(deck, base.replace("4 Opt", "3 Opt"));
    assert.deepEqual(r.lookups, []);
    assert.ok(reusedNames(r.reused).includes("main:3 Opt"));
});

test("unchangedEntries: an added card is looked up", () => {
    const r = unchangedEntries(deck, base.replace("20 Island", "20 Island\n2 Shock"));
    assert.deepEqual(r.lookups, [{ count: 2, name: "Shock", zone: "main" }]);
    assert.equal(r.reused.length, 5);
});

test("unchangedEntries: a removed card just leaves the list", () => {
    const r = unchangedEntries(deck, base.replace("20 Island\n", ""));
    assert.deepEqual(r.lookups, []);
    assert.equal(r.reused.length, 4);
    assert.ok(!r.reused.some(x => x.card.name === "Island"));
});

test("unchangedEntries: a blanked-out line in a main-only deck keeps the rest in main", () => {
    const mainOnly: Deck = { main: deck.main, side: [] };
    const text = formatDeckList(mainOnly, "text").replace("2 Fire // Ice", "");
    assert.equal(text, "4 Opt\n\n20 Island\n");
    const r = unchangedEntries(mainOnly, text);
    assert.deepEqual(r.lookups, []);
    assert.deepEqual(reusedNames(r.reused), ["main:4 Opt", "main:20 Island"]);
});

test("unchangedEntries: an extra blank line in the main deck changes no zone", () => {
    const r = unchangedEntries(deck, base.replace("4 Opt\n", "4 Opt\n\n"));
    assert.deepEqual(r.lookups, []);
    assert.deepEqual(reusedNames(r.reused).sort(), [
        "commander:1 Atraxa, Praetors' Voice", "main:2 Fire // Ice", "main:20 Island", "main:4 Opt", "side:3 Negate",
    ]);
});

test("parseDeckList: without the option a blank line still starts the sideboard", () => {
    const parsed = parseDeckList("4 Opt\n\n20 Island\n");
    assert.deepEqual(names(parsed.main), ["4 Opt"]);
    assert.deepEqual(names(parsed.side), ["20 Island"]);
});

test("unchangedEntries: a card moved to the sideboard is looked up again", () => {
    const text = base.replace("4 Opt\n", "").replace("3 Negate", "3 Negate\n4 Opt");
    const r = unchangedEntries(deck, text);
    assert.deepEqual(r.lookups, [{ count: 4, name: "Opt", zone: "side" }]);
    assert.equal(r.reused.length, 4);
});

// ---- partner commanders ----

const partnerDeck: Deck = {
    ...deck,
    commander: { card: card("Thrasios, Triton Hero", "cmr", "1"), count: 1 },
    partner: { card: card("Tymna the Weaver", "cmr", "2"), count: 1 },
};

test("parse: two commanders become commander and partner", () => {
    const parsed = parseDeckList("Commander\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\nDeck\n4 Opt\n");
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.commander?.name, "Thrasios, Triton Hero");
    assert.equal(parsed.partner?.name, "Tymna the Weaver");
    assert.deepEqual(names(parsed.main), ["4 Opt"]);
});

test("parse: a third commander is a problem", () => {
    const parsed = parseDeckList("Commander\n1 A\n1 B\n1 C\n");
    assert.equal(parsed.problems.length, 1);
    assert.match(parsed.problems[0], /already two commanders/);
    assert.equal(parsed.partner?.name, "B");
});

test("parse: a one-commander list has no partner", () => {
    const parsed = parseDeckList(formatDeckList(deck, "text"));
    assert.equal(parsed.commander?.name, "Atraxa, Praetors' Voice");
    assert.equal(parsed.partner, undefined);
    assert.deepEqual(parsed.problems, []);
});

for (const style of ["text", "arena", "mtgo"] as const) {
    test(`${style}: round trips commander and partner`, () => {
        const parsed = parseDeckList(formatDeckList(partnerDeck, style));
        assert.deepEqual(parsed.problems, []);
        assert.deepEqual(names(parsed.main), ["4 Opt", "2 Fire // Ice", "20 Island"]);
        if (style === "mtgo") {
            assert.deepEqual(names(parsed.side), ["1 Thrasios, Triton Hero", "1 Tymna the Weaver", "3 Negate"]);
        } else {
            assert.equal(parsed.commander?.name, "Thrasios, Triton Hero");
            assert.equal(parsed.partner?.name, "Tymna the Weaver");
            assert.deepEqual(names(parsed.side), ["3 Negate"]);
        }
    });
}

test("deckFromLines and unchangedEntries carry the partner", () => {
    const built = deckFromLines([{ line: { count: 1, zone: "partner" }, card: card("Tymna the Weaver", "cmr", "2") }]);
    assert.equal(built.partner?.card.name, "Tymna the Weaver");
    const r = unchangedEntries(partnerDeck, formatDeckList(partnerDeck, "text"));
    assert.deepEqual(r.lookups, []);
    assert.ok(r.reused.some(f => f.line.zone === "partner" && f.card.name === "Tymna the Weaver"));
});
