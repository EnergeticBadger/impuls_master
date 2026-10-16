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
//   any    anything else (a plain array): lists a row each, ids

export type Kind = "int" | "num" | "bool" | "code" | "any";
export type Kinds<T> = { [K in keyof Required<T>]: Kind };

const ROW = Symbol("row");

export function columns<T extends object>(rows: readonly T[], kinds: Kinds<T>): T[] {
    const View = class { [ROW]: number; constructor(row: number) { this[ROW] = row; } };
    const n = rows.length;
    for (const [field, kind] of Object.entries(kinds) as [keyof T & string, Kind][]) {
        let get: (this: { [ROW]: number }) => unknown;
        if (kind === "int") {
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
