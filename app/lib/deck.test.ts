import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { oracleOf, printingCard, type CardRecord, type Printing } from "./carddata.ts";
import { addCard, basicLandSplit, canBeCommander, colorCounts, copiesIn, deckColors, deckPrice, deckSummary, groupByManaValue, groupByType, identityTerm, legalityProblems, manaCostOf, manaCurve, removeCard, replacePrinting, setCommander, sortEntries, type Deck, type DeckEntry } from "./deck.ts";

const card = (name: string, type_line: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
    ({
        name, type_line, cmc: 0, colors: [], color_identity: [], oracle_text: "",
        legalities: { standard: "legal", modern: "legal", commander: "legal" },
        ...extra,
    }) as unknown as ScryfallCard;

const bolt = card("Lightning Bolt", "Instant", { cmc: 1, colors: ["R"], color_identity: ["R"], legalities: { modern: "legal", standard: "not_legal", commander: "legal" } });
const bear = card("Grizzly Bears", "Creature — Bear", { cmc: 2, colors: ["G"], color_identity: ["G"] });
const golem = card("Myr Golem", "Artifact Creature — Golem", { cmc: 9 });
const forest = card("Forest", "Basic Land — Forest", { color_identity: ["G"] });
const relentless = card("Relentless Rats", "Creature — Rat", { cmc: 2, colors: ["B"], color_identity: ["B"], oracle_text: "A deck can have any number of cards named Relentless Rats." });
const mdfc = card("Valakut Awakening // Valakut Stoneforge", "Instant // Land", {
    cmc: 4, colors: undefined, color_identity: ["R"], layout: "modal_dfc",
    card_faces: [
        { name: "Valakut Awakening", mana_cost: "{2}{R}{R}", type_line: "Instant", colors: ["R"] },
        { name: "Valakut Stoneforge", mana_cost: "", type_line: "Land" },
    ],
});
const delverApi = card("Delver of Secrets // Insectile Aberration", "Creature — Human Wizard // Creature — Human Insect", {
    cmc: 1, colors: undefined, color_identity: ["U"], layout: "transform",
    card_faces: [
        { name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature — Human Wizard", colors: ["U"] },
        { name: "Insectile Aberration", mana_cost: "", type_line: "Creature — Human Insect", colors: ["U"] },
    ],
});
const delverCompact = card("Delver of Secrets // Insectile Aberration", "Creature — Human Wizard // Creature — Human Insect", {
    cmc: 1, colors: [], color_identity: ["U"], layout: "transform",
    card_faces: [
        { name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature — Human Wizard" },
        { name: "Insectile Aberration", mana_cost: "", type_line: "Creature — Human Insect" },
    ],
});
const nazgul = card("Nazgûl", "Creature — Wraith", { color_identity: ["B"], oracle_text: "A deck can have up to nine cards named Nazgûl." });
const dwarves = card("Seven Dwarves", "Creature — Dwarf", { color_identity: ["R"], oracle_text: "A deck can have up to seven cards named Seven Dwarves." });

const empty: Deck = { main: [], side: [] };

test("addCard merges by name and does not mutate", () => {
    const one = addCard(empty, bolt);
    const two = addCard(one, bolt, "main", 2);
    assert.equal(empty.main.length, 0);
    assert.equal(one.main[0].count, 1);
    assert.equal(two.main.length, 1);
    assert.equal(two.main[0].count, 3);
    assert.equal(addCard(two, bear, "side").side[0].card.name, "Grizzly Bears");
});

test("removeCard matches by oracle id across printings, by name without one", () => {
    const a = card("Lightning Bolt", "Instant", { oracle_id: "bolt-oracle" });
    const b = card("Lightning Bolt", "Instant", { oracle_id: "bolt-oracle", id: "other-printing" });
    const other = card("Other Bolt", "Instant", { oracle_id: "other-oracle" });
    assert.equal(removeCard(addCard(empty, a), b).main.length, 0);
    assert.equal(removeCard(addCard(empty, a), other).main.length, 1);
    assert.equal(removeCard(addCard(empty, bolt), bolt).main.length, 0);
});

test("copiesIn counts main deck copies by oracle id across printings", () => {
    const a = card("Lightning Bolt", "Instant", { oracle_id: "bolt-oracle" });
    const b = card("Lightning Bolt", "Instant", { oracle_id: "bolt-oracle", id: "other-printing" });
    const other = card("Grizzly Bears", "Creature — Bear", { oracle_id: "bear-oracle" });
    let deck = addCard(empty, a, "main", 2);
    deck = { ...deck, main: [...deck.main, { card: b, count: 1 }] };
    deck = addCard(addCard(deck, other), a, "side", 3);
    assert.equal(copiesIn(deck, "bolt-oracle"), 3);
    assert.equal(copiesIn(deck, "bear-oracle"), 1);
    assert.equal(copiesIn(deck, "missing"), 0);
    assert.equal(copiesIn(deck, undefined), 0);
});

const regularProp = card("Propaganda", "Enchantment", { oracle_id: "prop-oracle" });
const reversibleProp = card("Propaganda // Propaganda", "Enchantment // Enchantment", {
    layout: "reversible_card",
    card_faces: [
        { name: "Propaganda", oracle_id: "prop-oracle", type_line: "Enchantment" },
        { name: "Propaganda", oracle_id: "prop-oracle", type_line: "Enchantment" },
    ] as unknown as ScryfallCard["card_faces"],
});

test("reversible cards (oracle id only on their faces) are counted and removed", () => {
    let deck = empty;
    for (let i = 0; i < 3; i++) deck = addCard(deck, reversibleProp);
    assert.equal(copiesIn(deck, oracleOf(reversibleProp)), 3);

    const mixed: Deck = { main: [{ card: regularProp, count: 2 }, { card: reversibleProp, count: 1 }], side: [] };
    assert.equal(copiesIn(mixed, oracleOf(reversibleProp)), 3);
    assert.equal(copiesIn(mixed, oracleOf(regularProp)), 3);

    // copies come out of the entry with the card's own name; the other entry is left alone
    const less = removeCard(mixed, reversibleProp);
    assert.deepEqual(less.main.map(e => e.count), [2]);
    assert.equal(copiesIn(less, oracleOf(reversibleProp)), 2);
    assert.deepEqual(removeCard(mixed, regularProp).main.map(e => e.count), [1, 1]);

    const lessRegular = removeCard({ main: [{ card: reversibleProp, count: 2 }, { card: regularProp, count: 2 }], side: [] }, regularProp);
    assert.deepEqual(lessRegular.main.map(e => e.count), [2, 1]);

    const three: Deck = { main: [{ card: regularProp, count: 2 }, { card: reversibleProp, count: 3 }], side: [] };
    const moved = removeCard(three, reversibleProp, "main", 3);
    assert.deepEqual(moved.main.map(e => [e.card.name, e.count]), [["Propaganda", 2]]);
});

test("removeCard falls back to the oracle id when no entry has the card's name", () => {
    const deck: Deck = { main: [{ card: regularProp, count: 2 }], side: [] };
    const less = removeCard(deck, reversibleProp);
    assert.deepEqual(less.main.map(e => e.count), [1]);
});

test("removeCard lowers the count and drops an entry at zero", () => {
    const deck = addCard(empty, bolt, "main", 2);
    const less = removeCard(deck, bolt);
    assert.equal(less.main[0].count, 1);
    assert.equal(deck.main[0].count, 2);
    assert.equal(removeCard(less, bolt).main.length, 0);
    assert.equal(removeCard(less, bear).main.length, 1);
});

test("groupByType uses the front face and puts creatures first", () => {
    let deck = empty;
    for (const c of [bolt, bear, golem, forest, mdfc]) deck = addCard(deck, c);
    const groups = Object.fromEntries(groupByType(deck).map(g => [g.group, g.entries.map(e => e.card.name)]));
    assert.deepEqual(groups, {
        Creature: ["Grizzly Bears", "Myr Golem"],
        Instant: ["Lightning Bolt", "Valakut Awakening // Valakut Stoneforge"],
        Land: ["Forest"],
    });
});

test("sortEntries orders by mana value, then by name", () => {
    const entries: DeckEntry[] = [
        { card: golem, count: 1 },
        { card: bear, count: 2 },
        { card: bolt, count: 1 },
    ];
    assert.deepEqual(sortEntries(entries).map(e => e.card.name), ["Lightning Bolt", "Grizzly Bears", "Myr Golem"]);
});

test("sortEntries breaks equal mana value ties by name", () => {
    const zed = card("Zombie", "Creature — Zombie", { cmc: 2 });
    const ant = card("Ant", "Creature — Insect", { cmc: 2 });
    const entries: DeckEntry[] = [{ card: zed, count: 1 }, { card: bear, count: 1 }, { card: ant, count: 1 }];
    assert.deepEqual(sortEntries(entries).map(e => e.card.name), ["Ant", "Grizzly Bears", "Zombie"]);
});

test("sortEntries treats a card with no cmc as 0", () => {
    const nocmc = card("Nameless Token", "Creature — Token", { cmc: undefined });
    const entries: DeckEntry[] = [{ card: bolt, count: 1 }, { card: nocmc, count: 1 }];
    assert.deepEqual(sortEntries(entries).map(e => e.card.name), ["Nameless Token", "Lightning Bolt"]);
});

test("sortEntries returns a new array and leaves the input alone", () => {
    const entries: DeckEntry[] = [{ card: golem, count: 1 }, { card: bolt, count: 1 }];
    const before = [...entries];
    const sorted = sortEntries(entries);
    assert.notEqual(sorted, entries);
    assert.deepEqual(entries, before);
    assert.equal(entries[0].card.name, "Myr Golem");
    assert.equal(sorted[0].card.name, "Lightning Bolt");
});

test("groupByType sorts entries inside each group", () => {
    let deck = empty;
    for (const c of [golem, bear, card("Elf", "Creature — Elf", { cmc: 2 }), bolt]) deck = addCard(deck, c);
    const creatures = groupByType(deck).find(g => g.group === "Creature")!;
    assert.deepEqual(creatures.entries.map(e => e.card.name), ["Elf", "Grizzly Bears", "Myr Golem"]);
});

test("manaCurve skips lands and folds 7+", () => {
    let deck = addCard(empty, bear, "main", 3);
    deck = addCard(addCard(addCard(deck, bolt), golem, "main", 2), forest, "main", 10);
    assert.deepEqual(manaCurve(deck), [0, 1, 3, 0, 0, 0, 0, 2]);
});

test("colorCounts counts cards per color and colorless spells", () => {
    let deck = addCard(empty, bear, "main", 2);
    deck = addCard(addCard(addCard(deck, bolt), golem), forest, "main", 5);
    assert.deepEqual(colorCounts(deck), { W: 0, U: 0, B: 0, R: 1, G: 2, C: 1 });
});

test("colorCounts reads a double-faced card's front face", () => {
    const none = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    assert.deepEqual(colorCounts(addCard(empty, delverApi, "main", 4)), { ...none, U: 4, C: 0 });
    assert.deepEqual(colorCounts(addCard(empty, delverCompact, "main", 4)), { ...none, U: 4, C: 0 });
    assert.deepEqual(colorCounts(addCard(empty, mdfc)), { ...none, R: 1, C: 0 });
    const hybrid = card("Hybrid", "Creature", { colors: [], card_faces: [{ name: "Hybrid", mana_cost: "{W/U}{1}", type_line: "Creature" }, { name: "Back", type_line: "Creature" }] });
    assert.deepEqual(colorCounts(addCard(empty, hybrid)), { ...none, W: 1, U: 1, C: 0 });
    const ornithopter = card("Ornithopter", "Artifact Creature — Thopter");
    assert.deepEqual(colorCounts(addCard(empty, ornithopter)), { ...none, C: 1 });
});

test("commander: 'up to N cards named' cards use their own limit", () => {
    const general: Deck["commander"] = { card: card("Ghave", "Legendary Creature", { color_identity: ["B", "R"] }), count: 1 };
    const withCards = (...adds: [ScryfallCard, number][]): string[] => {
        let deck: Deck = { main: [], side: [], commander: general };
        for (const [c, n] of adds) deck = addCard(deck, c, "main", n);
        return legalityProblems(deck, "commander").filter(p => !p.includes("exactly 100"));
    };
    assert.deepEqual(withCards([nazgul, 9]), []);
    assert.ok(withCards([nazgul, 10]).some(p => p.includes("Nazgûl appears 10 times") && p.includes("the limit is 9")));
    assert.deepEqual(withCards([dwarves, 7]), []);
    assert.ok(withCards([bear, 2]).some(p => p.includes("Commander decks are singleton")));
    assert.ok(!withCards([relentless, 30]).some(p => p.includes("Relentless Rats appears")));
});

const sixty = (extra: Deck = empty): Deck => addCard({ main: [...extra.main], side: extra.side }, forest, "main", 60);

test("a 60-card deck of legal cards has no problems", () => {
    assert.deepEqual(legalityProblems(sixty(), "modern"), []);
});

test("legality: not legal in the format, copies, deck size and sideboard", () => {
    const deck = addCard(addCard(sixty(), bolt, "main", 5), relentless, "main", 20);
    const problems = legalityProblems(deck, "standard");
    assert.ok(problems.some(p => p.includes("Lightning Bolt is not legal")));
    assert.ok(problems.some(p => p.includes("Lightning Bolt appears 5 times")));
    assert.ok(!problems.some(p => p.includes("Forest")));
    assert.ok(!problems.some(p => p.includes("Relentless Rats appears")));

    assert.ok(legalityProblems(addCard(empty, bear, "main", 4), "modern").some(p => p.includes("at least 60")));
    assert.ok(legalityProblems(addCard(sixty(), bear, "side", 16), "modern").some(p => p.includes("sideboard")));
    // copies add up across main and side
    assert.ok(legalityProblems(addCard(addCard(sixty(), bear, "main", 3), bear, "side", 2), "modern").some(p => p.includes("Grizzly Bears appears 5")));
});

test("commander: singleton, size and color identity", () => {
    const general: Deck["commander"] = { card: card("Ghave", "Legendary Creature", { color_identity: ["G"] }), count: 1 };
    let deck: Deck = { main: [], side: [], commander: general };
    deck = addCard(deck, forest, "main", 90);
    for (let i = 0; i < 9; i++) deck = addCard(deck, card(`Filler ${i}`, "Creature", { color_identity: ["G"] }));
    assert.deepEqual(legalityProblems(deck, "commander"), []);

    const bad = addCard(addCard(deck, bear, "main", 2), bolt);
    const problems = legalityProblems(bad, "commander");
    assert.ok(problems.some(p => p.includes("Grizzly Bears appears 2 times")));
    assert.ok(problems.some(p => p.includes("Lightning Bolt has color identity outside")));
    assert.ok(problems.some(p => p.includes("exactly 100")));

    assert.ok(legalityProblems({ main: deck.main, side: [] }, "commander").some(p => p.includes("no commander")));
});

const priced = (name: string, prices: Record<string, string | null>) => card(name, "Instant", { prices } as unknown as Partial<ScryfallCard>);

test("deckPrice multiplies by count, falls back to foil, lists unpriced cards once", () => {
    const a = priced("A", { usd: "1.10", usd_foil: null });
    const b = priced("B", { usd: null, usd_foil: "2.50" });
    const c = priced("C", { usd: null, usd_foil: null });
    let deck: Deck = addCard(addCard(addCard({ main: [], side: [] }, a, "main", 3), b), c);
    deck = addCard(deck, c, "side", 2);
    deck = addCard(deck, a, "side", 1);
    assert.deepEqual(deckPrice(deck, { side: false, currency: "usd" }), { total: 5.8, missing: ["C"] });
    assert.deepEqual(deckPrice(deck, { side: true, currency: "usd" }), { total: 6.9, missing: ["C"] });
    assert.deepEqual(deckPrice(deck, { side: false, currency: "eur" }).missing, ["A", "B", "C"]);
});

test("deckPrice counts the commander; an empty deck is free", () => {
    const a = priced("A", { usd: "0.10" });
    assert.equal(deckPrice({ main: [{ card: a, count: 3 }], side: [], commander: { card: a, count: 1 } }, { side: false, currency: "usd" }).total, 0.4);
    assert.deepEqual(deckPrice({ main: [], side: [] }, { side: true, currency: "usd" }), { total: 0, missing: [] });
});

test("canBeCommander: legendary creatures and 'can be your commander' text", () => {
    assert.equal(canBeCommander(card("Ghave", "Legendary Creature — Fungus")), true);
    assert.equal(canBeCommander(card("Bear", "Creature — Bear")), false);
    assert.equal(canBeCommander(card("Crown", "Legendary Artifact")), false);
    assert.equal(canBeCommander(card("Teferi", "Legendary Planeswalker — Teferi", { oracle_text: "Teferi can be your commander." })), true);
    const faces = [{ name: "Front", type_line: "Legendary Creature — Human" }, { name: "Back", type_line: "Legendary Enchantment" }];
    assert.equal(canBeCommander(card("Front // Back", "", { card_faces: faces } as Partial<ScryfallCard>)), true);
});

// ---- manaCostOf, on cards built the way the site builds them from its card data ----

const printing: Printing = { id: "p1", set: "tst", set_name: "Test", number: "1", rarity: "common", released: "2020-01-01" };
const fromData = (name: string, layout: string, extra: Partial<CardRecord> = {}): ScryfallCard =>
    printingCard({
        oracle_id: `oracle-${name}`, name, slug: name.toLowerCase(), layout, cmc: 0, type_line: "Card",
        color_identity: [], keywords: [], legalities: {}, rulings: [], prints: [printing], main: 0,
        ...extra,
    }, printing);

test("manaCostOf reads the faces of double-faced cards from card data", () => {
    const delver = fromData("Delver of Secrets // Insectile Aberration", "transform", {
        faces: [{ name: "Delver of Secrets", mana_cost: "{U}" }, { name: "Insectile Aberration", mana_cost: "" }],
    });
    assert.equal(manaCostOf(delver), "{U}");
    const valakut = fromData("Valakut Awakening // Valakut Stoneforge", "modal_dfc", {
        faces: [{ name: "Valakut Awakening", mana_cost: "{2}{R}{R}" }, { name: "Valakut Stoneforge", mana_cost: "" }],
    });
    assert.equal(manaCostOf(valakut), "{2}{R}{R}");
});

test("manaCostOf keeps a split card's own cost, and is empty for lands", () => {
    const fire = fromData("Fire // Ice", "split", { mana_cost: "{1}{R} // {1}{U}" });
    assert.equal(manaCostOf(fire), "{1}{R} // {1}{U}");
    assert.equal(manaCostOf(fromData("Forest", "normal")), "");
});

test("manaCostOf reads Scryfall's API shape, with no top-level cost", () => {
    assert.equal(manaCostOf(delverApi), "{U}");
});

const legend =card("Isamaru, Hound of Konda", "Legendary Creature — Dog", { cmc: 1 });
const legend2 = card("Kenrith, the Returned King", "Legendary Creature — Human Noble", { cmc: 5 });
const walker = card("Grist, the Hunger Tide", "Legendary Planeswalker — Grist", { oracle_text: "Grist, the Hunger Tide can be your commander." });
const legendDfc = card("Jace, Vryn's Prodigy // Jace, Telepath Unbound", "Legendary Creature — Human Wizard // Legendary Planeswalker — Jace", {
    card_faces: [
        { name: "Jace, Vryn's Prodigy", mana_cost: "{1}{U}", type_line: "Legendary Creature — Human Wizard" },
        { name: "Jace, Telepath Unbound", mana_cost: "", type_line: "Legendary Planeswalker — Jace" },
    ],
});

test("canBeCommander: legendary creatures and 'can be your commander' cards", () => {
    assert.equal(canBeCommander(legend), true);
    assert.equal(canBeCommander(walker), true);
    assert.equal(canBeCommander(legendDfc), true);
    assert.equal(canBeCommander(bear), false);
    assert.equal(canBeCommander(card("Jace Beleren", "Legendary Planeswalker — Jace")), false);
});

test("setCommander takes one copy from main and does not mutate", () => {
    const deck: Deck = { main: [{ card: legend, count: 1 }, { card: bear, count: 1 }], side: [] };
    const next = setCommander(deck, legend);
    assert.deepEqual(next.commander, { card: legend, count: 1 });
    assert.deepEqual(next.main.map(e => e.card.name), ["Grizzly Bears"]);
    assert.equal(deck.main.length, 2);
    assert.equal(deck.commander, undefined);
});

test("setCommander sends the old commander back to main", () => {
    const deck: Deck = { main: [{ card: legend2, count: 1 }], side: [], commander: { card: legend, count: 1 } };
    const next = setCommander(deck, legend2);
    assert.equal(next.commander?.card.name, legend2.name);
    assert.deepEqual(next.main, [{ card: legend, count: 1 }]);
});

test("setCommander from a 2-of leaves one copy in main", () => {
    const deck: Deck = { main: [{ card: legend, count: 2 }], side: [] };
    const next = setCommander(deck, legend);
    assert.deepEqual(next.main, [{ card: legend, count: 1 }]);
    assert.deepEqual(next.commander, { card: legend, count: 1 });
});

test("deckSummary counts lands and spells and averages the spells' mana value", () => {
    let deck = addCard(empty, forest, "main", 24)
    deck = addCard(deck, bolt, "main", 20)
    deck = addCard(deck, bear, "main", 16)
    // (20 * 1 + 16 * 2) / 36 = 1.444...
    assert.deepEqual(deckSummary(deck), { lands: 24, spells: 36, averageManaValue: 1.44 })
});

test("deckSummary weights the average by count", () => {
    const deck = addCard(addCard(empty, bolt, "main", 3), golem)
    // (3 * 1 + 9) / 4 = 3
    assert.deepEqual(deckSummary(deck), { lands: 0, spells: 4, averageManaValue: 3 })
});

test("deckSummary counts the commander but not the sideboard", () => {
    const deck: Deck = { ...addCard(addCard(empty, forest), bear, "side", 5), commander: { card: golem, count: 1 } }
    assert.deepEqual(deckSummary(deck), { lands: 1, spells: 1, averageManaValue: 9 })
});

test("deckSummary counts a modal DFC by its front face", () => {
    // Valakut Awakening is an instant on the front, so a spell
    assert.equal(deckSummary(addCard(empty, mdfc)).spells, 1)
});

test("deckSummary of an empty deck is all zeros", () => {
    assert.deepEqual(deckSummary(empty), { lands: 0, spells: 0, averageManaValue: 0 })
});

const boltM10 = card("Lightning Bolt", "Instant", { id: "bolt-m10", cmc: 1 });
const boltA25 = card("Lightning Bolt", "Instant", { id: "bolt-a25", cmc: 1 });
const bearPrint = card("Grizzly Bears", "Creature — Bear", { id: "bear-1", cmc: 2 });
const elfPrint = card("Llanowar Elves", "Creature — Elf", { id: "elf-1", cmc: 1 });

test("replacePrinting swaps a main-deck row's card, keeping its count and place", () => {
    const deck: Deck = { main: [{ card: bearPrint, count: 2 }, { card: boltM10, count: 4 }, { card: elfPrint, count: 1 }], side: [] };
    const next = replacePrinting(deck, "main", boltM10, boltA25);
    assert.deepEqual(next.main.map((e) => [e.card.id, e.count]), [["bear-1", 2], ["bolt-a25", 4], ["elf-1", 1]]);
    assert.equal(deck.main[1].card.id, "bolt-m10", "the input is not changed");
});

test("replacePrinting in the sideboard leaves the main deck alone", () => {
    const deck: Deck = { main: [{ card: boltM10, count: 4 }], side: [{ card: boltM10, count: 1 }] };
    const next = replacePrinting(deck, "side", boltM10, boltA25);
    assert.equal(next.side[0].card.id, "bolt-a25");
    assert.equal(next.main[0].card.id, "bolt-m10");
    assert.equal(next.main, deck.main);
});

test("replacePrinting swaps the commander", () => {
    const deck: Deck = { main: [{ card: boltM10, count: 1 }], side: [], commander: { card: bearPrint, count: 1 } };
    const other = card("Grizzly Bears", "Creature — Bear", { id: "bear-2", cmc: 2 });
    const next = replacePrinting(deck, "commander", bearPrint, other);
    assert.equal(next.commander?.card.id, "bear-2");
    assert.equal(next.commander?.count, 1);
    assert.equal(next.main, deck.main);
});

test("replacePrinting merges into a row that already holds the new printing", () => {
    const deck: Deck = { main: [{ card: boltA25, count: 1 }, { card: elfPrint, count: 2 }, { card: boltM10, count: 3 }], side: [] };
    const next = replacePrinting(deck, "main", boltM10, boltA25);
    assert.deepEqual(next.main.map((e) => [e.card.id, e.count]), [["bolt-a25", 4], ["elf-1", 2]]);
    const back = replacePrinting(deck, "main", boltA25, boltM10);
    assert.deepEqual(back.main.map((e) => [e.card.id, e.count]), [["bolt-m10", 4], ["elf-1", 2]]);
});

test("replacePrinting of a card not in the zone changes nothing", () => {
    const deck: Deck = { main: [{ card: boltM10, count: 4 }], side: [] };
    assert.equal(replacePrinting(deck, "main", elfPrint, boltA25), deck);
    assert.equal(replacePrinting(deck, "side", boltM10, boltA25), deck);
    assert.equal(replacePrinting(deck, "commander", boltM10, boltA25), deck);
});

test("deckColors of a commander deck is the commander's color identity", () => {
    const atraxa = card("Atraxa, Praetors' Voice", "Legendary Creature — Phyrexian Angel Horror", { color_identity: ["G", "W", "U", "B"] });
    const deck: Deck = { ...addCard(empty, bolt), commander: { card: atraxa, count: 1 } };
    assert.deepEqual(deckColors(deck), ["W", "U", "B", "G"]);
});

test("deckColors of a 60-card deck is the colors its spells use, in WUBRG order", () => {
    const deck = addCard(addCard(addCard(empty, bear, "main", 20), bolt, "main", 16), forest, "main", 24);
    assert.deepEqual(deckColors(deck), ["R", "G"]);
});

test("deckColors of an empty or colorless deck is empty", () => {
    assert.deepEqual(deckColors(empty), []);
    assert.deepEqual(deckColors(addCard(addCard(empty, golem, "main", 4), forest)), []);
});

test("groupByManaValue puts spells in ascending mana value groups and lands last", () => {
    const deck = addCard(addCard(addCard(addCard(empty, forest, "main", 24), bear, "main", 4), bolt, "main", 4), golem, "main", 2);
    const groups = groupByManaValue(deck);
    assert.deepEqual(groups.map((g) => g.group), ["1", "2", "7+", "Lands"]);
    assert.deepEqual(groups.map((g) => g.entries.reduce((n, e) => n + e.count, 0)), [4, 4, 2, 24]);
});

test("groupByManaValue puts an 8-drop under 7+ and leaves out the commander and sideboard", () => {
    const eight = card("Eight-and-a-Half-Tails", "Creature", { cmc: 8 });
    const deck: Deck = { ...addCard(addCard(empty, eight), bolt, "side", 3), commander: { card: bear, count: 1 } };
    assert.deepEqual(groupByManaValue(deck).map((g) => [g.group, g.entries.map((e) => e.card.name)]), [["7+", ["Eight-and-a-Half-Tails"]]]);
});

test("groupByManaValue goes by a modal DFC's front face", () => {
    // Valakut Awakening // Valakut Stoneforge: an instant (mana value 4) on the front, a land on the back
    assert.deepEqual(groupByManaValue(addCard(empty, mdfc)).map((g) => g.group), ["4"]);
});

test("groupByManaValue sorts each group like sortEntries", () => {
    const a = card("Abrade", "Instant", { cmc: 2 });
    const deck = addCard(addCard(empty, bear), a);
    assert.deepEqual(groupByManaValue(deck)[0].entries.map((e) => e.card.name), ["Abrade", "Grizzly Bears"]);
});

test("groupByManaValue of an empty deck is empty", () => {
    assert.deepEqual(groupByManaValue(empty), []);
});

const spell = (name: string, mana_cost: string) => card(name, "Creature — Test", { mana_cost });
const deckOf = (...entries: [ScryfallCard, number][]): Deck => ({ main: entries.map(([c, count]) => ({ card: c, count })), side: [] });

test("basicLandSplit: mono-red gives all Mountains", () => {
    const deck = deckOf([spell("Red Guy", "{2}{R}{R}"), 4], [spell("Red Two", "{R}"), 4]);
    assert.deepEqual(basicLandSplit(deck, 17), [{ color: "R", count: 17 }]);
});

test("basicLandSplit: a tie goes to the earlier color in WUBRG order", () => {
    const deck = deckOf([spell("Red Ten", "{R}"), 10], [spell("Blue Ten", "{U}"), 10]);
    assert.deepEqual(basicLandSplit(deck, 17), [{ color: "U", count: 9 }, { color: "R", count: 8 }]);
});

test("basicLandSplit: hybrid counts half for each color", () => {
    assert.deepEqual(basicLandSplit(deckOf([spell("Hybrid", "{W/U}{W/U}"), 1]), 10), [{ color: "W", count: 5 }, { color: "U", count: 5 }]);
    // {W/U} is half W, half U; plus one {W} makes W 1.5 : U 0.5
    assert.deepEqual(basicLandSplit(deckOf([spell("Hybrid", "{W/U}"), 1], [spell("Plain", "{W}"), 1]), 8), [{ color: "W", count: 6 }, { color: "U", count: 2 }]);
});

test("basicLandSplit: card counts weight the symbols; generic and X don't count", () => {
    const deck = deckOf([spell("Three Green", "{X}{2}{G}"), 3], [spell("One Black", "{1}{B}"), 1]);
    assert.deepEqual(basicLandSplit(deck, 8), [{ color: "B", count: 2 }, { color: "G", count: 6 }]);
});

test("basicLandSplit counts the commander", () => {
    const deck: Deck = { main: [], side: [], commander: { card: spell("Boss", "{W}{W}"), count: 1 } };
    assert.deepEqual(basicLandSplit(deck, 5), [{ color: "W", count: 5 }]);
});

test("basicLandSplit: a colorless deck gives []", () => {
    assert.deepEqual(basicLandSplit(deckOf([spell("Golem", "{6}"), 4], [spell("X", "{X}"), 2]), 17), []);
    assert.deepEqual(basicLandSplit({ main: [], side: [] }, 17), []);
});

test("basicLandSplit: the parts always sum to count", () => {
    const deck = deckOf([spell("A", "{W}{U}{B}"), 3], [spell("B", "{R}{G/W}"), 7], [spell("C", "{B}{B}{U}"), 5]);
    for (let n = 0; n <= 60; n++) {
        const parts = basicLandSplit(deck, n);
        assert.equal(parts.reduce((s, p) => s + p.count, 0), n);
        assert.ok(parts.every(p => p.count > 0));
    }
});

test("identityTerm writes colors in WUBRG order, lower case", () => {
    assert.equal(identityTerm(["U", "B"]), "id<=ub");
    assert.equal(identityTerm(["G", "W"]), "id<=wg");
    assert.equal(identityTerm(["G", "R", "B", "U", "W"]), "id<=wubrg");
    assert.equal(identityTerm([]), "id<=c");
});
