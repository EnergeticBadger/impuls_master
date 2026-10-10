// The requests scripts/test-lookups.ts asks both Scryfall and scripts/lookups.ts, made from the bulk files with a
// fixed seed, so a rerun asks the same ones (and Scryfall's answers come from the cache).
// Each case is an API path with its query, as the app would ask it: "cards/named?fuzzy=lightning%20bolt".

import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

export type Case = { endpoint: string, kind: string, path: string };

// a seeded random number generator (mulberry32), so the same cases come out every time
function random(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function* lines(file: string) {
    for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
        if (line.startsWith("{")) yield line.replace(/,$/, "");
    }
}

const q = encodeURIComponent;

export async function makeCases(bulk: string, seed = 1): Promise<Case[]> {
    const rand = random(seed);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
    const sample = <T>(list: T[], n: number) => {
        const copy = [...list], out: T[] = [];
        while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
        return out;
    };

    // what the cases are made from
    type P = { id: string, name: string, set: string, cn: string, lang: string, layout: string, faces: string[], oracle?: string, digital: boolean };
    const printings: P[] = [];
    const tokens = new Set<string>(), extras = new Set<string>(), named = new Set<string>();
    for await (const line of lines(`${bulk}/default_cards.jsonl.gz`)) {
        const c = JSON.parse(line);
        const p: P = {
            id: c.id, name: c.name, set: c.set, cn: c.collector_number, lang: c.lang, layout: c.layout, digital: c.digital,
            faces: (c.card_faces ?? []).map((f: any) => f.name), oracle: c.oracle_id ?? c.card_faces?.[0]?.oracle_id,
        };
        printings.push(p);
        if (/token|emblem/.test(c.layout)) tokens.add(c.name);
        if (c.layout === "art_series") extras.add(c.name);
        // the names in catalog/card-names (see scripts/lookups-build.ts)
        if (c.layout !== "art_series" && !/(^|\/\/ )(Token|Card|Emblem)\b/.test(c.type_line ?? c.card_faces?.[0]?.type_line ?? "")) named.add(c.name);
    }
    const realNames = [...named].sort();
    const multiFace = printings.filter((p) => p.faces.length > 1 && !/token|art_series/.test(p.layout));
    const byName = new Map<string, P[]>();
    for (const p of printings) (byName.get(p.name) ?? byName.set(p.name, []).get(p.name)!).push(p);

    // other languages: a sample of printings not in default_cards
    const foreign: { id: string, set: string, cn: string, lang: string }[] = [];
    let seen = 0;
    for await (const line of lines(`${bulk}/all_cards.jsonl.gz`)) {
        if (line.includes('"lang":"en"')) continue;
        const m = /"id":"([^"]+)".*?"lang":"([^"]+)".*?"set":"([^"]+)".*?"collector_number":"([^"]+)"/.exec(line);
        if (!m) continue;
        seen++;
        // reservoir sampling, 200 kept
        if (foreign.length < 200) foreign.push({ id: m[1], lang: m[2], set: m[3], cn: m[4] });
        else if (rand() < 200 / seen) foreign[Math.floor(rand() * 200)] = { id: m[1], lang: m[2], set: m[3], cn: m[4] };
    }

    const out: Case[] = [];
    const add = (endpoint: string, kind: string, path: string) => out.push({ endpoint, kind, path });

    // ---- catalogs: every one Scryfall lists (https://scryfall.com/docs/api/catalogs), and one that isn't ----
    for (const name of CATALOGS) add("catalog", "catalog", `catalog/${name}`);
    add("catalog", "unknown", "catalog/set-types");

    // ---- named: exact ----
    for (const n of sample(realNames, 250)) add("named-exact", "name", `cards/named?exact=${q(n)}`);
    for (const n of sample(realNames, 60)) add("named-exact", "lower case", `cards/named?exact=${q(n.toLowerCase())}`);
    for (const n of sample(realNames, 30)) add("named-exact", "upper case", `cards/named?exact=${q(n.toUpperCase())}`);
    for (const p of sample(multiFace, 60)) add("named-exact", "face name", `cards/named?exact=${q(pick(p.faces))}`);
    for (const n of sample(realNames.filter((n) => /[^\x00-\x7f]/.test(n)), 30)) add("named-exact", "no accents", `cards/named?exact=${q(plain(n))}`);
    for (const n of sample(realNames.filter((n) => /[,'\-:!.]/.test(n)), 30)) add("named-exact", "no punctuation", `cards/named?exact=${q(n.replace(/[,'\-:!.]/g, ""))}`);
    for (const n of sample([...tokens], 25)) add("named-exact", "token", `cards/named?exact=${q(n)}`);
    for (const n of sample([...extras], 10)) add("named-exact", "art series", `cards/named?exact=${q(n)}`);
    for (const n of sample(realNames, 25)) add("named-exact", "part of a name", `cards/named?exact=${q(n.split(" ")[0])}`);
    for (const n of sample(realNames, 20)) add("named-exact", "misspelt", `cards/named?exact=${q(misspell(n, rand))}`);
    for (const n of sample(realNames, 40)) {
        const p = pick(byName.get(n)!);
        add("named-exact", "with set", `cards/named?exact=${q(n)}&set=${p.set}`);
    }
    for (const n of sample(realNames, 10)) add("named-exact", "with wrong set", `cards/named?exact=${q(n)}&set=lea`);

    // ---- named: fuzzy ----
    for (const n of sample(realNames, 200)) add("named-fuzzy", "name", `cards/named?fuzzy=${q(n)}`);
    // the app asks with the page's slug, dashes as spaces (app/routes/card.tsx)
    for (const n of sample(realNames, 150)) add("named-fuzzy", "slug", `cards/named?fuzzy=${q(slugWords(n))}`);
    for (const n of sample(realNames, 60)) add("named-fuzzy", "random case", `cards/named?fuzzy=${q(randomCase(n, rand))}`);
    for (const n of sample(realNames, 200)) add("named-fuzzy", "misspelt", `cards/named?fuzzy=${q(misspell(n, rand))}`);
    for (const n of sample(realNames, 80)) add("named-fuzzy", "misspelt twice", `cards/named?fuzzy=${q(misspell(misspell(n, rand), rand))}`);
    for (const n of sample(realNames.filter((n) => n.includes(" ")), 120)) add("named-fuzzy", "first word", `cards/named?fuzzy=${q(n.split(" ")[0])}`);
    for (const n of sample(realNames.filter((n) => n.split(" ").length > 2), 80)) {
        const w = n.split(" ");
        add("named-fuzzy", "some words", `cards/named?fuzzy=${q(w.slice(0, 2).join(" "))}`);
    }
    for (const n of sample(realNames.filter((n) => n.split(" ").length > 1), 80)) {
        const w = n.split(" ");
        add("named-fuzzy", "last word", `cards/named?fuzzy=${q(w[w.length - 1])}`);
    }
    for (const n of sample(realNames.filter((n) => n.length > 8), 100)) {
        const len = 3 + Math.floor(rand() * (n.length - 4));
        add("named-fuzzy", "start of a name", `cards/named?fuzzy=${q(n.slice(0, len))}`);
    }
    for (const n of sample(realNames.filter((n) => n.length > 10), 50)) {
        const from = 1 + Math.floor(rand() * (n.length / 2)), len = 4 + Math.floor(rand() * (n.length / 2));
        add("named-fuzzy", "middle of a name", `cards/named?fuzzy=${q(n.slice(from, from + len))}`);
    }
    for (const n of sample(realNames.filter((n) => n.split(" ").length > 1), 40)) {
        const w = n.split(" ");
        add("named-fuzzy", "words reordered", `cards/named?fuzzy=${q([...w.slice(1), w[0]].join(" "))}`);
    }
    for (const n of sample(realNames.filter((n) => /[^\x00-\x7f]/.test(n)), 30)) add("named-fuzzy", "no accents", `cards/named?fuzzy=${q(plain(n))}`);
    for (const n of sample(realNames.filter((n) => /[,'\-:!.]/.test(n)), 50)) add("named-fuzzy", "no punctuation", `cards/named?fuzzy=${q(n.replace(/[,'\-:!.]/g, ""))}`);
    for (const p of sample(multiFace, 80)) add("named-fuzzy", "face name", `cards/named?fuzzy=${q(pick(p.faces))}`);
    for (const p of sample(multiFace, 20)) add("named-fuzzy", "faces reversed", `cards/named?fuzzy=${q([...p.faces].reverse().join(" // "))}`);
    for (const n of sample([...tokens], 25)) add("named-fuzzy", "token", `cards/named?fuzzy=${q(n)}`);
    for (const w of AMBIGUOUS) add("named-fuzzy", "one common word", `cards/named?fuzzy=${q(w)}`);
    for (const w of NONSENSE) add("named-fuzzy", "nonsense", `cards/named?fuzzy=${q(w)}`);
    for (const n of sample(realNames, 50)) {
        const p = pick(byName.get(n)!);
        add("named-fuzzy", "with set", `cards/named?fuzzy=${q(misspell(n, rand))}&set=${p.set}`);
    }

    // ---- set and collector number ----
    const odd = printings.filter((p) => !/^\d+$/.test(p.cn));
    for (const p of sample(printings, 150)) add("set-number", "plain", `cards/${p.set}/${q(p.cn)}`);
    for (const p of sample(odd, 120)) add("set-number", "odd number", `cards/${p.set}/${q(p.cn)}`);
    for (const p of sample(printings.filter((p) => p.lang !== "en"), 20)) add("set-number", "not English", `cards/${p.set}/${q(p.cn)}`);
    for (const p of sample(printings, 15)) add("set-number", "upper case set", `cards/${p.set.toUpperCase()}/${q(p.cn)}`);
    for (const p of sample(printings, 15)) add("set-number", "no such number", `cards/${p.set}/${q(p.cn + "9999")}`);
    add("set-number", "no such set", "cards/zzzz/1");
    for (const p of sample(printings, 25)) add("set-number", "with lang en", `cards/${p.set}/${q(p.cn)}/en`);
    for (const f of sample(foreign, 50)) add("set-number", "with lang", `cards/${f.set}/${q(f.cn)}/${f.lang}`);
    for (const p of sample(printings, 10)) add("set-number", "with lang it has not", `cards/${p.set}/${q(p.cn)}/ph`);

    // ---- by id ----
    for (const p of sample(printings, 120)) add("id", "id", `cards/${p.id}`);
    for (const f of sample(foreign, 30)) add("id", "other language", `cards/${f.id}`);
    add("id", "unknown id", "cards/00000000-0000-0000-0000-000000000000");

    // ---- rulings ----
    for (const p of sample(printings, 150)) add("rulings", "by id", `cards/${p.id}/rulings`);
    for (const p of sample(printings, 40)) add("rulings", "by set and number", `cards/${p.set}/${q(p.cn)}/rulings`);
    add("rulings", "unknown id", "cards/00000000-0000-0000-0000-000000000000/rulings");

    // ---- autocomplete ----
    for (const n of sample(realNames, 120)) {
        const len = 2 + Math.floor(rand() * Math.min(10, n.length - 1));
        add("autocomplete", "start of a name", `cards/autocomplete?q=${q(n.slice(0, len).toLowerCase())}`);
    }
    for (const n of sample(realNames.filter((n) => n.length > 8), 40)) {
        const from = 2 + Math.floor(rand() * (n.length - 6));
        add("autocomplete", "middle of a name", `cards/autocomplete?q=${q(n.slice(from, from + 4))}`);
    }
    for (const n of sample(realNames, 40)) add("autocomplete", "misspelt", `cards/autocomplete?q=${q(misspell(n.slice(0, 8), rand))}`);
    for (const n of sample(realNames, 30)) add("autocomplete", "whole name", `cards/autocomplete?q=${q(n)}`);
    for (const w of ["a", "x", "", "zz", "of the", "æther", "lim-dul", "fire // ice", "bolt"]) add("autocomplete", "edge", `cards/autocomplete?q=${q(w)}`);
    for (const n of sample([...tokens], 15)) add("autocomplete", "include extras", `cards/autocomplete?q=${q(n.slice(0, 5).toLowerCase())}&include_extras=true`);

    // ---- sets ----
    const sets = JSON.parse(readFileSync(`${bulk}/sets.json`, "utf8")).data as { code: string, id: string, tcgplayer_id?: number }[];
    add("sets", "all", "sets");
    for (const s of sample(sets, 80)) add("sets", "by code", `sets/${s.code}`);
    for (const s of sample(sets, 15)) add("sets", "by code, upper case", `sets/${s.code.toUpperCase()}`);
    for (const s of sample(sets, 15)) add("sets", "by id", `sets/${s.id}`);
    add("sets", "unknown", "sets/zzzz");
    return out;
}

// every catalog, as listed on https://scryfall.com/docs/api/catalogs
export const CATALOGS = [
    "card-names", "artist-names", "word-bank", "supertypes", "card-types", "artifact-types", "battle-types",
    "creature-types", "enchantment-types", "land-types", "planeswalker-types", "spell-types", "powers",
    "toughnesses", "loyalties", "watermarks", "keyword-abilities", "keyword-actions", "ability-words", "flavor-words",
];

const AMBIGUOUS = ["dragon", "goblin", "angel", "bolt", "elf", "fire", "sword", "wall", "serra", "jace", "urza", "lightning",
    "giant", "knight", "of", "the", "shock", "path", "island", "forest", "mox", "lotus", "ajani", "counterspell", "sol",
    "storm", "titan", "sliver", "ancestral", "black", "spirit", "zombie", "bear", "lord", "growth", "ring", "time", "dark",
    "chandra", "liliana"];
const NONSENSE = ["xyzzyq", "qqqq", "asdfghjkl", "zzzzzz zzzz", "!!!", "12345", "lightning bolt bolt bolt bolt", "a"];

const plain = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");
const slugWords = (s: string) => plain(s.toLowerCase()).replace(/_+/g, " blank ").replace(/[^a-z0-9]+/g, " ").trim();

function randomCase(s: string, rand: () => number) {
    return [...s].map((ch) => rand() < 0.5 ? ch.toUpperCase() : ch.toLowerCase()).join("");
}

// one typing slip: a letter left out, added, changed or swapped with the next
function misspell(s: string, rand: () => number) {
    const letters = [...s].map((ch, i) => /\p{L}/u.test(ch) ? i : -1).filter((i) => i >= 0);
    if (letters.length < 2) return s;
    const i = letters[Math.floor(rand() * letters.length)];
    const abc = "abcdefghijklmnopqrstuvwxyz";
    const other = abc[Math.floor(rand() * abc.length)];
    const chars = [...s];
    switch (Math.floor(rand() * 4)) {
        case 0: chars.splice(i, 1); break;
        case 1: chars.splice(i, 0, other); break;
        case 2: chars[i] = other; break;
        default: if (i + 1 < chars.length) [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    }
    return chars.join("");
}
