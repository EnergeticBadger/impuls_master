import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import { addCard, colorCounts, copiesIn, groupByType, legalityProblems, manaCurve, removeCard, type Deck } from "./deck.ts";

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
    cmc: 3, colors: ["R"], color_identity: ["R"],
    card_faces: [{ name: "Valakut Awakening", type_line: "Instant" }, { name: "Valakut Stoneforge", type_line: "Land" }],
});

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
