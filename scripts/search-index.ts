// The search index file (see search-index-file.ts): npm run search-index -- [--out <file>] [--bulk <dir>]
// Loads the cards from Scryfall's bulk files as the local search does (SCRYFALL_BULK_DIR, or downloaded into
// --bulk, default fuzz-results/bulk), writes them to <file> (default card-data/search-index.bin) and <file>.gz,
// then reads the file back and checks every field of every card and printing, the tags and the rest are the
// same as loaded from the bulk files. loadIndex reads one (.gz or not) in place of loadCards.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { bulkFile, loadCards, setsFile, type Cards } from "./local-search.ts";
import { decodeIndex, encodeIndex } from "./search-index-file.ts";

export function loadIndex(path: string): Cards & { about: Record<string, unknown> } {
    const bytes = readFileSync(path);
    return decodeIndex(path.endsWith(".gz") ? gunzipSync(bytes) : bytes);
}

// two values the same: lists, Sets, Maps and objects by what's in them, NaN as NaN
function same(a: unknown, b: unknown): boolean {
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
    if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
    if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([k, x]) => b.has(k) && same(x, b.get(k)));
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) return same([...a as Int32Array], [...b as Int32Array]);
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => same((a as any)[k], (b as any)[k]));
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const option = (name: string, fallback: string) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
    };
    const out = resolve(option("out", "card-data/search-index.bin"));
    const bulk = option("bulk", "fuzz-results/bulk");
    const mb = (n: number) => `${(n / 2 ** 20).toFixed(1)} MB`;
    const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

    let t = Date.now();
    const prints = await bulkFile("default_cards", bulk);
    const data = await loadCards(prints, await bulkFile("oracle_tags", bulk).catch(() => undefined), await setsFile(bulk).catch(() => undefined));
    console.log(`${data.cards.length.toLocaleString()} cards, ${data.prints.length.toLocaleString()} printings loaded from the bulk files in ${seconds(t)}`);

    t = Date.now();
    const bytes = encodeIndex(data, { built: new Date().toISOString(), bulk: new Date(statSync(prints).mtimeMs).toISOString(), cards: data.cards.length, printings: data.prints.length });
    const zipped = gzipSync(bytes, { level: 9 });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    writeFileSync(`${out}.gz`, zipped);
    console.log(`${out}: ${mb(bytes.length)}, ${mb(zipped.length)} gzipped, written in ${seconds(t)}`);

    t = Date.now();
    const back = loadIndex(`${out}.gz`);
    console.log(`read back in ${seconds(t)}`);
    const wrong: string[] = [];
    for (const part of ["cards", "prints"] as const) {
        const fields = Object.keys(Object.getPrototypeOf(data[part][0]));
        if (back[part].length !== data[part].length) wrong.push(`${part}: ${back[part].length} rows, not ${data[part].length}`);
        else for (const f of fields) {
            const i = data[part].findIndex((row, i) => !same((row as any)[f], (back[part][i] as any)[f]));
            if (i >= 0) wrong.push(`${part}[${i}].${f}`);
        }
    }
    for (const part of ["tags", "artTags", "setDates", "blocks", "parents", "promoTypes", "languages"] as const) {
        if (!same(data[part], back[part])) wrong.push(part);
    }
    if (wrong.length) {
        console.log(`read back, these differ: ${wrong.join(", ")}`);
        process.exitCode = 1;
    } else console.log("read back the same: every field of every card and printing, the tags and the rest");
}
