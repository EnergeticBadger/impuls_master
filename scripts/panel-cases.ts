// Writes scripts/panel-cases.txt: the searches the filter panel writes, made with its own code (FILTERS and
// buildToken in app/Components/Searchbar/filters.ts), for npm run test-syntax to check against Scryfall like
// syntax-cases.txt: npm run panel-cases
// Every option, comparison and color mode once, plus picking several, any or all, and leaving one out. Each is
// narrowed by a second term so Scryfall's whole answer fits in a few pages and can be compared card by card.
// Runs under vite-node, since filters.ts imports the app's ~/ paths.

import { writeFileSync } from "node:fs";
import { COLOR_COUNTS, COLOR_MODES, COMPARE_WORDS, FILTERS, buildToken, emptyDraft, type Draft, type Filter } from "../app/Components/Searchbar/filters.ts";

const byId = (id: string) => FILTERS.find((f) => f.id === id)!;
const token = (f: Filter, d: Partial<Draft>) => buildToken(f, { ...emptyDraft(f), ...d });
const lines: string[] = [];
const group = (title: string, searches: string[]) => lines.push("", `# ${title}`, ...searches);

// a choice filter: each option, two picked (any and all), and one left out
function choices(id: string, narrow: string, values?: string[]) {
    const f = byId(id) as Filter & { kind: "choice" };
    const all = values ?? f.options.map((o) => o.value);
    group(f.label, [
        ...all.map((v) => `${token(f, { values: [v] })} ${narrow}`),
        `${token(f, { values: all.slice(0, 2), match: "any" })} ${narrow}`,
        `${token(f, { values: all.slice(0, 2), match: "all" })} ${narrow}`,
        `${token(f, { values: [all[0]], exclude: true })} ${narrow}`,
    ]);
}

choices("type", "mv=3 c:r");
choices("legendary", "mv=3 c:b");
choices("rarity", "t:goblin");
choices("format", "t:dragon r:mythic");

const creature = byId("creature");
group(creature.label, [
    ...["elf", "goblin", "zombie", "dragon"].map((v) => `${token(creature, { values: [v] })} mv=2`),
    `${token(creature, { values: ["elf", "warrior"], match: "all" })}`,
    `${token(creature, { values: ["elf", "goblin"], match: "any" })} mv=1`,
    `${token(creature, { values: ["zombie"], exclude: true })} t:creature mv=1 c:b`,
]);

const keyword = byId("keyword") as Filter & { kind: "keyword" };
group(keyword.label, [
    ...keyword.common.map((v) => `${token(keyword, { values: [v] })} mv=3 c:w`),
    `${token(keyword, { values: ["flying", "lifelink"], match: "all" })} mv<=3`,
    `${token(keyword, { values: ["flying"], exclude: true })} t:dragon mv<=4`,
]);

// colors: each color in each mode, colorless, two colors, and by how many
for (const id of ["color", "identity"] as const) {
    const f = byId(id) as Filter & { kind: "color" };
    const narrow = id === "color" ? "t:creature mv=3" : "t:legendary t:creature mv=3";
    group(f.label, [
        ...COLOR_MODES[f.key].flatMap((m) => ["w", "u", "b", "r", "g"].map((c) => `${token(f, { values: [c], compare: m.value })} ${narrow}`)),
        ...COLOR_MODES[f.key].map((m) => `${token(f, { values: ["r", "g"], compare: m.value })} ${narrow}`),
        `${token(f, { values: ["c"] })} ${narrow}`,
        ...COMPARE_WORDS.flatMap((c) => [COLOR_COUNTS[0], COLOR_COUNTS[2]].map((n) => `${token(f, { colorBy: "count", compare: c.value, text: n })} ${narrow}`)),
        `${token(f, { values: ["u"], exclude: true })} ${narrow} c:w`,
    ]);
}

// numbers: each comparison, at a value or two that keep the answer small
const numbers: [string, string[], string][] = [
    ["mv", ["0", "7"], "t:creature c:g r:mythic"],
    ["power", ["0", "8"], "t:creature c:r r:rare"],
    ["toughness", ["1", "8"], "t:creature c:u r:rare"],
    ["loyalty", ["3", "6"], "t:planeswalker"],
    ["price", ["50"], "t:dragon r:mythic"],
    ["year", ["1995", "2024"], "t:sliver"],
];
for (const [id, values, narrow] of numbers) {
    const f = byId(id);
    group(f.label, [
        ...COMPARE_WORDS.flatMap((c) => values.map((v) => `${token(f, { compare: c.value, text: v })} ${narrow}`)),
        `${token(f, { compare: ">=", text: values[0], exclude: true })} ${narrow}`,
    ]);
}

// text: a word, a phrase that needs quotes, and one left out
const texts: [string, string[], string][] = [
    ["name", ["dragon", "lightning bolt", "of the"], "r:mythic"],
    ["set", ["neo", "lea", "mh3"], "t:creature mv=3"],
    ["artist", ["guay", "rebecca guay", "john avon"], "t:land"],
];
for (const [id, values, narrow] of texts) {
    const f = byId(id);
    group(f.label, [
        ...values.map((v) => `${token(f, { text: v })} ${narrow}`),
        `${token(f, { text: values[0], exclude: true })} ${narrow} t:dragon`,
    ]);
}

// what it does: roles (Tagger tags), the exact-words box, several at once
const rules = byId("oracle");
group(rules.label, [
    ...["removal", "ramp", "card-advantage", "counterspell", "tutor", "board-wipe"].map((v) => `${token(rules, { values: [v] })} mv=2 r:rare`),
    `${token(rules, { text: "draw a card" })} t:instant mv=1`,
    `${token(rules, { text: "enters tapped" })} t:land r:rare`,
    `${token(rules, { values: ["removal", "ramp"], match: "any" })} t:creature mv=2 c:g`,
    `${token(rules, { values: ["removal"], text: "exile", match: "all" })} mv=2`,
    `${token(rules, { values: ["removal"], exclude: true })} t:instant mv=1 c:w`,
]);

const out = [
    "# Generated by npm run panel-cases from the filter panel's own code (scripts/panel-cases.ts); don't edit by hand.",
    "# npm run test-syntax checks these against Scryfall along with syntax-cases.txt.",
    ...lines,
].join("\n") + "\n";
writeFileSync(new URL("./panel-cases.txt", import.meta.url), out);
console.log(`${lines.filter((l) => l && !l.startsWith("#")).length} searches written to scripts/panel-cases.txt`);
