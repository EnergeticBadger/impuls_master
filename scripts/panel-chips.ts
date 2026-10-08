// The filter panel's chips, made with its own code (buildToken in app/Components/Searchbar/filters.ts), for the
// scripts that test searches built from them: combo-cases.ts and test-chips.ts.

import { FILTERS, buildToken, emptyDraft, type Draft, type Join } from "../app/Components/Searchbar/filters.ts";

export type Spec = { id: string, d: Partial<Draft> };
export type Chip = { token: string, join: Join };
const byId = (id: string) => FILTERS.find((f) => f.id === id)!;
export const chip = (s: Spec, join: Join = "and"): Chip => {
    const f = byId(s.id);
    return { token: buildToken(f, { ...emptyDraft(f), ...s.d }), join };
};

// every filter but "What it does", a few ways each
export const OTHERS: Spec[] = [
    ...["creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "equipment", "aura", "vehicle"].map((v) => ({ id: "type", d: { values: [v] } })),
    { id: "type", d: { values: ["instant", "sorcery"], match: "any" } },
    { id: "type", d: { values: ["artifact", "creature"], match: "all" } },
    { id: "type", d: { values: ["creature"], exclude: true } },
    ...["elf", "goblin", "zombie", "human", "dragon", "wizard", "soldier", "spirit"].map((v) => ({ id: "creature", d: { values: [v] } })),
    { id: "creature", d: { values: ["elf", "goblin"], match: "any" } },
    { id: "creature", d: { values: ["human"], exclude: true } },
    { id: "legendary", d: { values: ["legendary"] } },
    { id: "legendary", d: { values: ["legendary creature"] } },
    { id: "legendary", d: { values: ["commander"] } },
    { id: "legendary", d: { values: ["legendary"], exclude: true } },
    ...["w", "u", "b", "r", "g"].map((c) => ({ id: "color", d: { values: [c] } })),
    { id: "color", d: { values: ["r", "g"], compare: "=" } },
    { id: "color", d: { values: ["u", "b"], compare: "<=" } },
    { id: "color", d: { values: ["c"] } },
    { id: "color", d: { colorBy: "count", compare: ">=", text: "2" } },
    { id: "color", d: { values: ["g"], exclude: true } },
    ...["w", "u", "b", "r", "g"].map((c) => ({ id: "identity", d: { values: [c], compare: "=" } })),
    { id: "identity", d: { values: ["b", "g"] } },
    { id: "identity", d: { values: ["w", "u", "r"] } },
    { id: "identity", d: { values: ["c"], compare: "=" } },
    { id: "identity", d: { colorBy: "count", compare: "=", text: "3" } },
    ...["flying", "trample", "haste", "flash", "lifelink", "deathtouch", "cycling", "flashback", "landfall", "ward"].map((v) => ({ id: "keyword", d: { values: [v] } })),
    { id: "keyword", d: { values: ["flying", "vigilance"], match: "all" } },
    { id: "keyword", d: { values: ["flying"], exclude: true } },
    // our own mechanics: a quoted phrase, a regex, a bracketed group, mixed with a keyword, and one left out
    ...["devotion", "energy", "dice rolling", "poison counters", "day and night"].map((v) => ({ id: "keyword", d: { values: [v] } })),
    { id: "keyword", d: { values: ["flying", "devotion"], match: "any" } },
    { id: "keyword", d: { values: ["poison counters", "trample"], match: "any" } },
    { id: "keyword", d: { values: ["monarch"], exclude: true } },
    { id: "keyword", d: { values: ["poison counters"], exclude: true } },
    ...["0", "1", "2", "3", "4", "6"].map((v) => ({ id: "mv", d: { compare: "=", text: v } })),
    { id: "mv", d: { compare: "<=", text: "2" } },
    { id: "mv", d: { compare: ">=", text: "5" } },
    { id: "mv", d: { compare: ">=", text: "4", exclude: true } },
    { id: "power", d: { compare: ">=", text: "4" } },
    { id: "power", d: { compare: "<=", text: "1" } },
    { id: "power", d: { compare: "=", text: "2" } },
    { id: "toughness", d: { compare: ">=", text: "5" } },
    { id: "toughness", d: { compare: "<", text: "2" } },
    { id: "loyalty", d: { compare: "<=", text: "4" } },
    ...["common", "uncommon", "rare", "mythic"].map((v) => ({ id: "rarity", d: { values: [v] } })),
    { id: "rarity", d: { values: ["rare", "mythic"], match: "any" } },
    { id: "rarity", d: { values: ["common"], exclude: true } },
    ...["commander", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "brawl", "historic", "timeless"].map((v) => ({ id: "format", d: { values: [v] } })),
    { id: "format", d: { values: ["modern"], exclude: true } },
    { id: "price", d: { compare: "<", text: "1" } },
    { id: "price", d: { compare: ">=", text: "10" } },
    { id: "year", d: { compare: ">=", text: "2022" } },
    { id: "year", d: { compare: "<=", text: "2003" } },
    { id: "year", d: { compare: "=", text: "2015" } },
    { id: "year", d: { compare: ">=", text: "2010", exclude: true } },
    ...["neo", "mh3", "dmu", "m21", "eld", "c20", "lea", "cmr"].map((v) => ({ id: "set", d: { text: v } })),
    ...["john avon", "rebecca guay", "seb mckinnon", "guay"].map((v) => ({ id: "artist", d: { text: v } })),
    ...["dragon", "of the", "angel"].map((v) => ({ id: "name", d: { text: v } })),
    { id: "name", d: { text: "the", exclude: true } },
];

// a "What it does" chip
export const rules = (d: Partial<Draft>): Spec => ({ id: "oracle", d: { blocks: [], ...d } });
