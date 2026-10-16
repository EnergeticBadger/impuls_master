// Rows kept as columns: a typed array a field instead of an object a row (118,663 printings of 40 fields took
// 27 MB as objects, 38,751 cards 11 MB). Each row is then a small object holding only its number, whose fields
// are getters on a shared prototype reading the columns, so code reading p.set or c.legal works as before. The
// rows can't be changed afterwards: setting a field throws.
// A field is one of:
//   int    a whole number (Int32Array)
//   num    a number or undefined (Float64Array, undefined as NaN)
//   bool   true or false (Uint8Array)
//   code   any value from a short list (strings, shared Sets): a code into the list of distinct values, compared
//          as === (Uint8Array, Uint16Array or Uint32Array, as the list needs)
//   uuid   an id like Scryfall's (a lower-case uuid): its 16 bytes, made a string again when read (a string took
//          about 50 bytes). A column with anything else in it is kept as `any`
//   list   a list a row (a card's faces, its printings): every row's in one array (an Int32Array when they're
//          whole numbers) and where each starts, read as a new list each time, so changing one changes nothing
//          (a list of its own took about 50 bytes, more than the one or two entries in most)
//   any    anything else (a plain array)
// The columns themselves are a Table (tableOf), which scripts/search-index.ts writes to a file and reads back.

export type Kind = "int" | "num" | "bool" | "code" | "uuid" | "list" | "any";
export type Kinds<T> = { [K in keyof Required<T>]: Kind };
export type Codes = Uint8Array | Uint16Array | Uint32Array;
export type Column =
    | { kind: "int", data: Int32Array }
    | { kind: "num", data: Float64Array }
    | { kind: "bool", data: Uint8Array }
    | { kind: "code", data: Codes, values: unknown[] }
    | { kind: "uuid", data: Uint8Array }
    | { kind: "list", data: Int32Array | unknown[], start: Int32Array }
    | { kind: "any", data: unknown[] };
export type Table = { length: number, fields: Record<string, Column> };

const ROW = Symbol("row");
const TABLE = Symbol("table");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));

export const columns = <T extends object>(rows: readonly T[], kinds: Kinds<T>): T[] => fromTable(toTable(rows, kinds));

// the columns behind rows made by columns() or fromTable()
export const tableOf = (rows: readonly object[]): Table | undefined => (rows as unknown as { [TABLE]?: Table })[TABLE];

export function toTable<T extends object>(rows: readonly T[], kinds: Kinds<T>): Table {
    const n = rows.length, fields: Record<string, Column> = {};
    for (const [field, wanted] of Object.entries(kinds) as [keyof T & string, Kind][]) {
        const kind = wanted === "uuid" && !rows.every((r) => UUID.test(r[field] as string)) ? "any" : wanted;
        if (kind === "uuid") {
            const data = new Uint8Array(16 * n);
            rows.forEach((r, i) => {
                const hex = (r[field] as string).replace(/-/g, "");
                for (let b = 0; b < 16; b++) data[16 * i + b] = parseInt(hex.slice(2 * b, 2 * b + 2), 16);
            });
            fields[field] = { kind, data };
        } else if (kind === "list") {
            const lists = rows.map((r) => r[field] as unknown[]), start = new Int32Array(n + 1);
            lists.forEach((l, i) => start[i + 1] = start[i] + l.length);
            const whole = lists.every((l) => l.every((v) => typeof v === "number" && (v | 0) === v));
            const data: { [i: number]: unknown } = whole ? new Int32Array(start[n]) : [];
            lists.forEach((l, i) => l.forEach((v, k) => data[start[i] + k] = v));
            fields[field] = { kind, data: data as Int32Array | unknown[], start };
        } else if (kind === "int") {
            fields[field] = { kind, data: Int32Array.from(rows, (r) => r[field] as number) };
        } else if (kind === "num") {
            fields[field] = { kind, data: Float64Array.from(rows, (r) => (r[field] ?? NaN) as number) };
        } else if (kind === "bool") {
            fields[field] = { kind, data: Uint8Array.from(rows, (r) => r[field] ? 1 : 0) };
        } else if (kind === "code") {
            const values: unknown[] = [], index = new Map<unknown, number>();
            const codes = rows.map((r) => {
                let code = index.get(r[field]);
                if (code === undefined) index.set(r[field], code = values.push(r[field]) - 1);
                return code;
            });
            fields[field] = { kind, data: (values.length <= 0x100 ? Uint8Array : values.length <= 0x10000 ? Uint16Array : Uint32Array).from(codes), values };
        } else {
            fields[field] = { kind: "any", data: rows.map((r) => r[field]) };
        }
    }
    return { length: n, fields };
}

export function fromTable<T extends object>(table: Table): T[] {
    const View = class { [ROW]: number; constructor(row: number) { this[ROW] = row; } };
    for (const [field, column] of Object.entries(table.fields)) {
        let get: (this: { [ROW]: number }) => unknown;
        if (column.kind === "uuid") {
            const a = column.data;
            get = function () {
                const at = 16 * this[ROW], h = (b: number) => HEX[a[at + b]];
                return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
            };
        } else if (column.kind === "list") {
            const all: { [i: number]: unknown } = column.data, start = column.start;
            get = function () {
                const out: unknown[] = [];
                for (let k = start[this[ROW]], end = start[this[ROW] + 1]; k < end; k++) out.push(all[k]);
                return out;
            };
        } else if (column.kind === "num") {
            const a = column.data;
            get = function () { const v = a[this[ROW]]; return v === v ? v : undefined; };
        } else if (column.kind === "bool") {
            const a = column.data;
            get = function () { return a[this[ROW]] === 1; };
        } else if (column.kind === "code") {
            const a = column.data, values = column.values;
            get = function () { return values[a[this[ROW]]]; };
        } else {
            const a: { [i: number]: unknown } = column.data;
            get = function () { return a[this[ROW]]; };
        }
        Object.defineProperty(View.prototype, field, { get, enumerable: true });
    }
    const rows = Array.from({ length: table.length }, (_, i) => new View(i) as unknown as T);
    Object.defineProperty(rows, TABLE, { value: table });
    return rows;
}
