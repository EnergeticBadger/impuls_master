// The search index as one file: everything the local search loads from Scryfall's bulk files (see loadCards),
// as columns (see columns.ts), so it loads in about a second without them. Made by npm run search-index; no
// Node in here, so a Worker can read it too.
// The file: "MTGIDX01", the header's length and the format's version (32-bit, little-endian), the header (JSON),
// then the typed arrays, each at a multiple of 8 bytes. The header says where each column's arrays are, holds
// every string once (columns and lists of strings are numbers into that list), the other parts of the cards
// (tags, sets' dates and blocks…), and the order of the colour and format bits.

import { fromTable, tableOf, type Column, type Table } from "./columns.ts";
import { maskNames, useMaskNames, type Cards } from "./local-search.ts";

const MAGIC = "MTGIDX01";
const VERSION = 1;
const ARRAYS = { Int32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array };
type Typed = Int32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array;
// a list in the header: strings as numbers into the string list (a typed array), anything else as JSON
type List = { strings: number } | { json: unknown[] };
type Header = {
    format: string, version: number, about: Record<string, unknown>, masks: ReturnType<typeof maskNames>,
    cards: TableHeader, prints: TableHeader, tags: { names: [number, number][], start: number, all: number },
    rest: Record<"artTags" | "setDates" | "blocks" | "parents" | "promoTypes" | "languages", unknown>,
    strings: string[], arrays: { type: keyof typeof ARRAYS, offset: number, length: number }[],
};
type TableHeader = { length: number, fields: Record<string, { kind: Column["kind"], data: number | List | { ints: number }, start?: number, values?: List }> };

const align = (n: number) => Math.ceil(n / 8) * 8;

export function encodeIndex(data: Cards, about: Record<string, unknown> = {}): Uint8Array {
    const strings: string[] = [], stringAt = new Map<string, number>();
    const str = (s: string) => {
        let i = stringAt.get(s);
        if (i === undefined) stringAt.set(s, i = strings.push(s) - 1);
        return i;
    };
    const arrays: Typed[] = [];
    const array = (a: Typed) => arrays.push(a) - 1;
    // any other value as JSON, tagged: { u } undefined, { s } a string, { a } a list, { set }, { map }, { o } an
    // object, { n } NaN or Infinity; frozen lists and objects stay frozen
    const value = (v: unknown): unknown => {
        if (v === undefined) return { u: 1 };
        if (v === null || typeof v === "boolean") return v;
        if (typeof v === "number") return Number.isFinite(v) ? v : { n: String(v) };
        if (typeof v === "string") return { s: str(v) };
        if (Array.isArray(v)) return { a: v.map(value), f: Object.isFrozen(v) ? 1 : 0 };
        if (v instanceof Set) return { set: [...v].map(value) };
        if (v instanceof Map) return { map: [...v].map(([k, x]) => [value(k), value(x)]) };
        if (Object.getPrototypeOf(v) === Object.prototype) {
            return { o: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, value(x)])), f: Object.isFrozen(v) ? 1 : 0 };
        }
        throw new Error(`an index file can't keep ${Object.prototype.toString.call(v)}`);
    };
    const list = (l: unknown[]): List => l.every((v) => typeof v === "string")
        ? { strings: array(Int32Array.from(l as string[], str)) } : { json: l.map(value) };
    const table = (rows: readonly object[]): TableHeader => {
        const t = tableOf(rows);
        if (!t) throw new Error("the cards aren't columns: load them with loadCards");
        return {
            length: t.length, fields: Object.fromEntries(Object.entries(t.fields).map(([field, c]) => [field,
                c.kind === "code" ? { kind: c.kind, data: array(c.data), values: list(c.values) }
                : c.kind === "list" ? { kind: c.kind, start: array(c.start), data: c.data instanceof Int32Array ? { ints: array(c.data) } : list(c.data) }
                : c.kind === "any" ? { kind: c.kind, data: list(c.data) }
                : { kind: c.kind, data: array(c.data) }])),
        };
    };
    // a tag's aliases share its list of cards, so each list once
    const lists: Int32Array[] = [], listAt = new Map<Int32Array, number>();
    const names = [...data.tags].map(([name, cards]): [number, number] => {
        let i = listAt.get(cards);
        if (i === undefined) listAt.set(cards, i = lists.push(cards) - 1);
        return [str(name), i];
    });
    const start = new Int32Array(lists.length + 1);
    lists.forEach((l, i) => start[i + 1] = start[i] + l.length);
    const all = new Int32Array(start[lists.length]);
    lists.forEach((l, i) => all.set(l, start[i]));

    const header: Header = {
        format: MAGIC, version: VERSION, about, masks: maskNames(),
        cards: table(data.cards), prints: table(data.prints),
        tags: { names, start: array(start), all: array(all) },
        rest: {
            artTags: value(data.artTags), setDates: value(data.setDates), blocks: value(data.blocks), parents: value(data.parents),
            promoTypes: value(data.promoTypes), languages: value(data.languages),
        },
        strings, arrays: [],
    };
    let offset = 0;
    for (const a of arrays) {
        header.arrays.push({ type: a.constructor.name as keyof typeof ARRAYS, offset, length: a.length });
        offset = align(offset + a.byteLength);
    }
    const json = new TextEncoder().encode(JSON.stringify(header));
    const at = align(16 + json.length);
    const out = new Uint8Array(at + offset);
    out.set(new TextEncoder().encode(MAGIC), 0);
    const view = new DataView(out.buffer);
    view.setUint32(8, json.length, true);
    view.setUint32(12, VERSION, true);
    out.set(json, 16);
    arrays.forEach((a, i) => out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at + header.arrays[i].offset));
    return out;
}

// what encodeIndex wrote, as loadCards gives it. Sets the order of the colour and format bits, so it throws if
// cards with another order were loaded in this process first
export function decodeIndex(bytes: Uint8Array): Cards & { about: Record<string, unknown> } {
    if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("not a search index file");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(8, true), version = view.getUint32(12, true);
    if (version !== VERSION) throw new Error(`a search index of version ${version}; this reads ${VERSION}`);
    const header: Header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)));
    // the arrays copied to a buffer of their own, so the rest of the file can go (a copy, as a Node Buffer's
    // slice isn't one)
    const blob = new Uint8Array(bytes.subarray(align(16 + length))).buffer;
    const arrays = header.arrays.map(({ type, offset, length }) => new ARRAYS[type](blob, offset, length));
    const strings = header.strings;
    const value = (v: any): any => {
        if (v === null || typeof v !== "object") return v;
        if ("u" in v) return undefined;
        if ("n" in v) return Number(v.n);
        if ("s" in v) return strings[v.s];
        if ("a" in v) { const l = v.a.map(value); return v.f ? Object.freeze(l) : l; }
        if ("set" in v) return new Set(v.set.map(value));
        if ("map" in v) return new Map(v.map.map(([k, x]: [unknown, unknown]) => [value(k), value(x)]));
        const o = Object.fromEntries(Object.entries(v.o).map(([k, x]) => [k, value(x)]));
        return v.f ? Object.freeze(o) : o;
    };
    const list = (l: List): unknown[] => "strings" in l ? Array.from(arrays[l.strings] as Int32Array, (i) => strings[i]) : l.json.map(value);
    const table = (t: TableHeader): Table => ({
        length: t.length, fields: Object.fromEntries(Object.entries(t.fields).map(([field, c]): [string, Column] => [field,
            c.kind === "code" ? { kind: c.kind, data: arrays[c.data as number] as Uint8Array, values: list(c.values!) }
            : c.kind === "list" ? { kind: c.kind, start: arrays[c.start!] as Int32Array, data: "ints" in (c.data as object) ? arrays[(c.data as { ints: number }).ints] as Int32Array : list(c.data as List) }
            : c.kind === "any" ? { kind: c.kind, data: list(c.data as List) }
            : { kind: c.kind, data: arrays[c.data as number] } as Column])),
    });
    useMaskNames(header.masks);
    const start = arrays[header.tags.start] as Int32Array, all = arrays[header.tags.all] as Int32Array;
    const lists = Array.from({ length: start.length - 1 }, (_, i) => all.subarray(start[i], start[i + 1]));
    const r = header.rest;
    return {
        about: header.about,
        cards: fromTable(table(header.cards)), prints: fromTable(table(header.prints)),
        tags: new Map(header.tags.names.map(([name, i]) => [strings[name], lists[i]])),
        artTags: value(r.artTags), setDates: value(r.setDates), blocks: value(r.blocks), parents: value(r.parents),
        promoTypes: value(r.promoTypes), languages: value(r.languages),
    };
}
