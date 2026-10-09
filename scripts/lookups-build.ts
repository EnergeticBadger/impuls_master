// Builds the data scripts/lookups.ts answers from, out of Scryfall's bulk files: node scripts/lookups-build.ts [out]
// (default fuzz-results/lookups/data). SCRYFALL_BULK_DIR is the folder holding the bulk files, the same convention
// as scripts/card-data.ts: default_cards.jsonl.gz, oracle_cards.jsonl.gz, rulings.jsonl.gz and sets.json
// (Scryfall's /sets answer, which no bulk file has), and optionally all_cards.jsonl.gz for the other languages.
// Without all_cards a printing in another language isn't known here, and lookups.ts says so (undefined), so the
// caller can ask Scryfall instead.
//
// What it writes, all plain files so a Worker could read them from R2 one at a time:
//   index.json            the catalogs, every card name (for cards/named and autocomplete), the set codes
//   sets.json             Scryfall's /sets answer as it is
//   cards/<abc>.jsonl     every card object, one a line exactly as Scryfall gives it, by the first 3 letters of its id
//   prints/<set>.json     each printing in a set: collector number, language, id
//   rulings/<ab>.json     rulings by oracle id, by its first 2 letters
//
// The catalogs come from the cards where they can (card-names, word-bank, watermarks, powers, toughnesses,
// loyalties, artist-names); the lists Scryfall keeps by hand come from scripts/catalogs.json (npm run catalogs),
// checked against the cards (see buildCatalogs).

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { join, resolve } from "node:path";
import { CATALOG_NAMES, type Index, type NameEntry, cardKey } from "./lookups.ts";
import { extraKind } from "./local-search.ts";

// a copy of a string cut from a longer one, which would otherwise keep the longer one in memory
const fresh = (s: string) => JSON.parse(JSON.stringify(s)) as string;

async function* lines(file: string) {
    for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
        if (line.startsWith("{")) yield line.replace(/,$/, "");
    }
}

// ---- catalogs ----

// Ruby's String#to_f, which Scryfall sorts powers, toughnesses and loyalties by: the number the text starts
// with, else 0 ("*" and "∞" are 0, "1+*" is 1, ".5" is 0.5, "1d4+1" is 1)
export function rubyFloat(s: string) {
    const m = /^\s*[+-]?(\d+(\.\d+)?|\.\d+)/.exec(s);
    return m ? Number(m[0]) : 0;
}

// The order Scryfall sorts artist-names in, found by comparing: letters and digits only, case and accents
// ignored, the way Postgres sorts in an English locale ("Bengt Hampus Viklander" before "Ben Harvey", "I☆LA"
// with the I's, "Ørjan" with the O's)
const FOLD: Record<string, string> = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "þ": "th", "ð": "d", "ı": "i" };
export const collationKey = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[øæœßłđþðı]/g, (c) => FOLD[c]).replace(/[^\p{L}\p{N}]/gu, "");
const byCodepoint = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byCollation = (a: string, b: string) => byCodepoint(collationKey(a), collationKey(b)) || byCodepoint(a, b);

// card-names: the name of every printing that's a card, found by comparing with Scryfall (all 35,137 names, 9 Oct
// 2026): not art series, and not a token, emblem or helper card by its type line ("Token Creature — Goblin",
// "Card", "Emblem — Ajani"). Token layouts that are cards by type (the Theros "Hero's Path" creatures, the
// Turtles bosses and events, Morph and Manifest) count; a reversible card counts by its own name
// ("Birds of Paradise // Birds of Paradise")
export function isCardName(c: { layout: string, type_line?: string, card_faces?: { type_line?: string }[] }) {
    const type = c.type_line ?? c.card_faces?.[0]?.type_line ?? "";
    return c.layout !== "art_series" && !/(^|\/\/ )(Token|Card|Emblem)\b/.test(type);
}

// word-bank: each word of every printing's name (tokens and art cards too), lower case, a trailing comma or colon
// taken off; only words that start with a letter a–z and have two characters or more ("a", "x", "1996", "éowyn" and
// "\"brims\"" aren't in it; "run!\"" and "beebles)" are). Checked word for word against Scryfall's 22,843
export function nameWords(name: string): string[] {
    return name.toLowerCase().split(/\s+/).map((w) => w.replace(/[,:]$/, "")).filter((w) => /^[a-z]/.test(w) && w.length >= 2);
}

type Collected = {
    names: Set<string>, words: Set<string>, watermarks: Set<string>, powers: Set<string>, toughnesses: Set<string>,
    loyalties: Set<string>, keywords: Set<string>,
    // artist id → each name it's credited as, with how often
    artists: Map<string, Map<string, number>>, credited: Set<string>,
    // subtypes on cards, by the card type they follow ("Creature" → Goblin)
    subtypes: Map<string, Set<string>>,
};

function collect(into: Collected, c: any) {
    if (isCardName(c)) into.names.add(c.name);
    for (const w of nameWords(c.name)) into.words.add(w);
    // types and keywords only to check the hand-kept lists with, from cards legal somewhere
    const legal = Object.values(c.legalities ?? {}).some((v) => v !== "not_legal");
    if (legal) for (const k of c.keywords ?? []) into.keywords.add(k);
    const faces = [c, ...(c.card_faces ?? [])];
    for (const f of faces) {
        if (f.watermark) into.watermarks.add(f.watermark);
        if (f.power != null) into.powers.add(f.power);
        if (f.toughness != null) into.toughnesses.add(f.toughness);
        if (f.loyalty != null) into.loyalties.add(f.loyalty);
    }
    for (const f of legal ? c.card_faces ?? [c] : []) {
        const m = /^(.*?) — (.*)$/.exec(f.type_line ?? "");
        if (!m) continue;
        for (const t of m[1].split(" ")) {
            let set = into.subtypes.get(t);
            if (!set) into.subtypes.set(t, set = new Set());
            // "Time Lord" is one type
            for (const s of m[2].replace(/\bTime Lord\b/g, "Time_Lord").split(" ")) set.add(s.replace("_", " "));
        }
    }
    // artist names: a printing credits "A & B" with an id each; a face has its own artist and id
    const credit = (artist: string | undefined, ids: string[] | undefined) => {
        if (!artist || !ids?.length) return;
        // one id is one artist, even with an "&" in the name ("Hari & Deepti")
        const parts = ids.length === 1 ? [artist] : artist.split(" & ");
        for (const p of artist.split(" & ")) into.credited.add(p);
        into.credited.add(artist);
        if (parts.length !== ids.length) return;
        ids.forEach((id, i) => {
            let m = into.artists.get(id);
            if (!m) into.artists.set(id, m = new Map());
            m.set(parts[i], (m.get(parts[i]) ?? 0) + 1);
        });
    };
    if (c.card_faces?.some((f: any) => f.artist)) for (const f of c.card_faces) credit(f.artist, f.artist_id ? [f.artist_id] : c.artist_ids);
    else credit(c.artist, c.artist_ids);
}

// which catalog a card type's subtypes go in
const SUBTYPE_CATALOG: Record<string, string> = {
    Creature: "creature-types", Kindred: "creature-types", Tribal: "creature-types", Planeswalker: "planeswalker-types",
    Land: "land-types", Artifact: "artifact-types", Enchantment: "enchantment-types", Instant: "spell-types",
    Sorcery: "spell-types", Battle: "battle-types",
};

function buildCatalogs(got: Collected, kept: Record<string, string[]>, warn: (line: string) => void): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    out["card-names"] = [...got.names].sort(byCodepoint);
    out["word-bank"] = [...got.words].sort(byCodepoint);
    out["watermarks"] = [...got.watermarks].sort(byCodepoint);
    // by number, then in Scryfall's own order (from catalogs.json), then anything new
    for (const name of ["powers", "toughnesses", "loyalties"] as const) {
        const known = new Map(kept[name].map((v, i) => [v, i]));
        out[name] = [...got[name]].sort((a, b) => rubyFloat(a) - rubyFloat(b)
            || (known.get(a) ?? Infinity) - (known.get(b) ?? Infinity) || byCodepoint(a, b));
    }
    // each artist id by the name it's credited as most, plus the artists Scryfall names that no card credits by
    // name (14 on 9 Oct 2026: the Marvel inkers and colorists, credited only by id)
    const artists = new Set<string>();
    for (const names of got.artists.values()) artists.add([...names].sort((a, b) => b[1] - a[1])[0][0]);
    for (const a of kept["artist-names"]) if (!got.credited.has(a)) artists.add(a);
    out["artist-names"] = [...artists].sort(byCollation);

    // the lists Scryfall keeps by hand, plus any type a card has that they don't
    for (const name of ["supertypes", "card-types", "artifact-types", "battle-types", "creature-types", "enchantment-types",
        "land-types", "planeswalker-types", "spell-types", "keyword-abilities", "keyword-actions", "ability-words", "flavor-words"]) {
        out[name] = [...kept[name]];
    }
    // Scryfall adds to these by hand, and not every type on a card is in them (Un-cards' and playtest cards' aren't),
    // so they're taken as they are; a type or keyword on a card that's legal somewhere and isn't in them is
    // reported, as a sign catalogs.json needs refreshing
    const known = (names: string[]) => new Set(names.flatMap((n) => out[n].map((t) => t.toLowerCase())));
    const types = known(Object.values(SUBTYPE_CATALOG));
    for (const [type, subtypes] of got.subtypes) {
        if (!SUBTYPE_CATALOG[type]) continue;
        for (const s of subtypes) if (!types.has(s.toLowerCase())) warn(`type ${s} (${type}) isn't in ${SUBTYPE_CATALOG[type]}: npm run catalogs?`);
    }
    const keywords = known(["keyword-abilities", "keyword-actions", "ability-words", "flavor-words"]);
    for (const k of got.keywords) if (!keywords.has(k.toLowerCase())) warn(`keyword ${k} isn't in Scryfall's keyword lists: npm run catalogs?`);
    return Object.fromEntries(CATALOG_NAMES.map((n) => [n, out[n]]));
}

// ---- the build ----

export async function build(bulk: string, out: string, say: (line: string) => void = console.log) {
    rmSync(out, { recursive: true, force: true });
    for (const d of ["cards", "prints", "rulings"]) mkdirSync(join(out, d), { recursive: true });

    // card objects go to their file in batches, so thousands of files don't each need a stream open
    const pending = new Map<string, string[]>();
    let pendingBytes = 0;
    const flush = () => {
        for (const [file, list] of pending) appendFileSync(join(out, "cards", `${file}.jsonl`), list.join("\n") + "\n");
        pending.clear();
        pendingBytes = 0;
    };
    const keep = (id: string, line: string) => {
        const k = cardKey(id);
        (pending.get(k) ?? pending.set(k, []).get(k)!).push(line);
        pendingBytes += line.length;
        if (pendingBytes > 16 << 20) flush();
    };

    // each set's printings: [collector number, language, id]
    const prints = new Map<string, [string, string, string][]>();
    const addPrint = (set: string, cn: string, lang: string, id: string) => {
        (prints.get(set) ?? prints.set(set, []).get(set)!).push([cn, lang, id]);
    };

    const got: Collected = {
        names: new Set(), words: new Set(), watermarks: new Set(), powers: new Set(), toughnesses: new Set(),
        loyalties: new Set(), keywords: new Set(), artists: new Map(), credited: new Set(), subtypes: new Map(),
    };
    // every name a printing has, for cards/named and autocomplete
    const names = new Map<string, NameEntry>();
    const defaults = new Set<string>();
    // each card's colors, as letters ("", "B", "GR")
    const colors = new Map<string, string>();
    // each set's printings that aren't variations, for sets/{code}'s card_count
    const counts: Record<string, number> = {};
    let count = 0;
    // all_cards, when it's there, gives every card object, English too: it's made a few minutes after
    // default_cards, so it's nearer what the API says (a card's all_parts can point at a newer token)
    const all = existsSync(join(bulk, "all_cards.jsonl.gz"));
    for await (const line of lines(join(bulk, "default_cards.jsonl.gz"))) {
        const c = JSON.parse(line);
        if (!all) keep(c.id, line);
        defaults.add(c.id);
        addPrint(c.set, c.collector_number, c.lang, c.id);
        if (!c.variation) counts[c.set] = (counts[c.set] ?? 0) + 1;
        collect(got, c);
        let e = names.get(c.name);
        if (!e) names.set(c.name, e = { name: c.name, faces: (c.card_faces ?? []).map((f: any) => f.name), card: false, art: true, visible: false, oracles: [], prints: [] });
        if (isCardName(c)) e.card = true;
        if (c.layout !== "art_series") e.art = false;
        if (extraKind(c) === "") e.visible = true;
        const oracle = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
        if (oracle && !e.oracles.includes(oracle)) e.oracles.push(oracle);
        if (oracle && !colors.has(oracle)) colors.set(oracle, (c.colors ?? [...new Set(c.card_faces?.flatMap((f: any) => f.colors ?? []))].sort()).join(""));
        e.prints.push(c.id);
        count++;
    }
    say(`${count} printings in default_cards`);
    // A name several cards have (tokens: "Knight", "Beast") gives the one first by its colors, as letters: the
    // colorless Beast, the black Knight before the white ones, the blue Angel. Found by comparing with Scryfall
    for (const e of names.values()) e.oracles.sort((a, b) => colors.get(a)! < colors.get(b)! ? -1 : colors.get(a)! > colors.get(b)! ? 1 : 0);

    // the printing Scryfall shows a card with: the one in oracle_cards ("the most up-to-date recognizable version")
    const shown: Record<string, string> = {};
    for await (const line of lines(join(bulk, "oracle_cards.jsonl.gz"))) {
        const m = /"id":"([^"]+)","oracle_id":"([^"]+)"/.exec(line);
        if (m) shown[fresh(m[2])] = fresh(m[1]);
        else {
            const c = JSON.parse(line);
            const oracle = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
            if (oracle) shown[oracle] = c.id;
        }
    }

    // other languages, when all_cards is there
    if (all) {
        let other = 0;
        for await (const line of lines(join(bulk, "all_cards.jsonl.gz"))) {
            // a copy, as a piece cut from the line would keep the whole line in memory
            const id = fresh(/"id":"([^"]+)"/.exec(line)![1]);
            keep(id, line);
            if (defaults.has(id)) continue;
            // only three fields are needed, so the line isn't parsed: 400,000 parses is most of the build's memory
            const field = (name: string) => JSON.parse(new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*")`).exec(line)![1]);
            addPrint(field("set"), field("collector_number"), field("lang"), id);
            other++;
        }
        say(`${other} printings in other languages from all_cards`);
    }
    flush();

    for (const [set, list] of prints) writeFileSync(join(out, "prints", `${set}.json`), JSON.stringify(list));

    // rulings, in the bulk file's order
    const rulings = new Map<string, Record<string, unknown[]>>();
    for await (const line of lines(join(bulk, "rulings.jsonl.gz"))) {
        const r = JSON.parse(line);
        const k = r.oracle_id.slice(0, 2);
        const file = rulings.get(k) ?? rulings.set(k, {}).get(k)!;
        (file[r.oracle_id] ??= []).push(r);
    }
    for (const [k, file] of rulings) writeFileSync(join(out, "rulings", `${k}.json`), JSON.stringify(file));

    const sets = readFileSync(join(bulk, "sets.json"), "utf8");
    writeFileSync(join(out, "sets.json"), sets);

    const kept = JSON.parse(readFileSync(new URL("./catalogs.json", import.meta.url), "utf8")).lists;
    const catalogs = buildCatalogs(got, kept, say);

    const index: Index = {
        built: new Date().toISOString(),
        languages: all,
        catalogs,
        names: [...names.values()],
        shown,
        sets: (JSON.parse(sets).data as { code: string, id: string }[]).map((s) => [s.code, s.id]),
        setCounts: counts,
    };
    writeFileSync(join(out, "index.json"), JSON.stringify(index));
    say(`built ${out}: ${names.size} names, ${prints.size} sets, ${rulings.size} rulings files`);
}

if (import.meta.main) {
    const bulk = process.env.SCRYFALL_BULK_DIR ?? "fuzz-results/bulk";
    await build(bulk, resolve(process.argv[2] ?? "fuzz-results/lookups/data"));
}
