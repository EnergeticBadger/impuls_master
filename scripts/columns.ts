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

export type Kind = "int" | "num" | "bool" | "code" | "uuid" | "list" | "any";
export type Kinds<T> = { [K in keyof Required<T>]: Kind };

const ROW = Symbol("row");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));

export function columns<T extends object>(rows: readonly T[], kinds: Kinds<T>): T[] {
    const View = class { [ROW]: number; constructor(row: number) { this[ROW] = row; } };
    const n = rows.length;
    for (const [field, wanted] of Object.entries(kinds) as [keyof T & string, Kind][]) {
        const kind = wanted === "uuid" && !rows.every((r) => UUID.test(r[field] as string)) ? "any" : wanted;
        let get: (this: { [ROW]: number }) => unknown;
        if (kind === "uuid") {
            const a = new Uint8Array(16 * n);
            rows.forEach((r, i) => {
                const hex = (r[field] as string).replace(/-/g, "");
                for (let b = 0; b < 16; b++) a[16 * i + b] = parseInt(hex.slice(2 * b, 2 * b + 2), 16);
            });
            get = function () {
                const at = 16 * this[ROW], h = (b: number) => HEX[a[at + b]];
                return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
            };
        } else if (kind === "list") {
            const lists = rows.map((r) => r[field] as unknown[]), start = new Int32Array(n + 1);
            lists.forEach((l, i) => start[i + 1] = start[i] + l.length);
            const whole = lists.every((l) => l.every((v) => typeof v === "number" && (v | 0) === v));
            const all: { [i: number]: unknown } = whole ? new Int32Array(start[n]) : [];
            lists.forEach((l, i) => l.forEach((v, k) => all[start[i] + k] = v));
            get = function () {
                const out: unknown[] = [];
                for (let k = start[this[ROW]], end = start[this[ROW] + 1]; k < end; k++) out.push(all[k]);
                return out;
            };
        } else if (kind === "int") {
            const a = Int32Array.from(rows, (r) => r[field] as number);
            get = function () { return a[this[ROW]]; };
        } else if (kind === "num") {
            const a = Float64Array.from(rows, (r) => (r[field] ?? NaN) as number);
            get = function () { const v = a[this[ROW]]; return v === v ? v : undefined; };
        } else if (kind === "bool") {
            const a = Uint8Array.from(rows, (r) => r[field] ? 1 : 0);
            get = function () { return a[this[ROW]] === 1; };
        } else if (kind === "code") {
            const values: unknown[] = [], index = new Map<unknown, number>();
            const codes = rows.map((r) => {
                let code = index.get(r[field]);
                if (code === undefined) index.set(r[field], code = values.push(r[field]) - 1);
                return code;
            });
            const a = (values.length <= 0x100 ? Uint8Array : values.length <= 0x10000 ? Uint16Array : Uint32Array).from(codes);
            get = function () { return values[a[this[ROW]]]; };
        } else {
            const a = rows.map((r) => r[field]);
            get = function () { return a[this[ROW]]; };
        }
        Object.defineProperty(View.prototype, field, { get, enumerable: true });
    }
    return Array.from({ length: n }, (_, i) => new View(i) as unknown as T);
}
