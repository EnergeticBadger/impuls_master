import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketHeader, bucketOf, bucketOfName, findEntryByName, pickByName, pickPrinting, slug, type BucketEntry, type CardRecord, type Printing } from "./carddata.ts";

const print = (set: string, number: string): Printing =>
    ({ id: `${set}-${number}`, set, set_name: set, number, rarity: "common", released: "2020-01-01" });

const record = {
    name: "Opt",
    prints: [print("xln", "65"), print("dom", "60"), print("dom", "61"), print("m21", "7")],
    main: 3,
} as unknown as CardRecord;

test("pickPrinting matches set and number", () => {
    assert.equal(pickPrinting(record, "dom", "61").number, "61");
    assert.equal(pickPrinting(record, "DOM", "61").number, "61");
});

test("pickPrinting falls back to the set's first printing", () => {
    assert.equal(pickPrinting(record, "dom").number, "60");
    assert.equal(pickPrinting(record, "dom", "999").number, "60");
});

test("pickPrinting falls back to the page's own printing", () => {
    assert.equal(pickPrinting(record).set, "m21");
    assert.equal(pickPrinting(record, "zzz", "1").set, "m21");
});

test("names match without case or accents", () => {
    assert.equal(slug("LIM-DÛL's Vault"), slug("lim-dul's vault"));
});

const entries: BucketEntry[] = [
    ["fire-ice", "o1", 0, 10],
    ["bonecrusher-giant-stomp", "o2", 10, 10],
    ["opt", "o3", 20, 10],
    ["soldier-token", "o4", 30, 10],
];

test("findEntryByName finds split and double-faced cards by full name", () => {
    assert.equal(findEntryByName(entries, "Fire // Ice")?.[0], "fire-ice");
    assert.equal(findEntryByName(entries, "fire // ice")?.[0], "fire-ice");
    assert.equal(findEntryByName(entries, "Bonecrusher Giant // Stomp")?.[0], "bonecrusher-giant-stomp");
    assert.equal(findEntryByName(entries, "BONECRUSHER GIANT // STOMP")?.[0], "bonecrusher-giant-stomp");
    assert.equal(findEntryByName(entries, "Opt")?.[0], "opt");
});

test("findEntryByName finds nothing for a front face alone, so the caller falls back", () => {
    assert.equal(findEntryByName(entries, "Bonecrusher Giant"), undefined);
});

test("a full name's bucket is its slug's bucket", () => {
    assert.equal(bucketOfName("Fire // Ice"), bucketOf("fire-ice"));
});

// a bucket laid out like scripts/card-data.ts writes it: the header line, then the records
function makeBucket(records: { name: string; slug: string; oracle: string; prints: Printing[] }[]) {
    const entries: BucketEntry[] = [];
    const bodies: string[] = [];
    let offset = 0;
    for (const r of records) {
        const json = JSON.stringify({ name: r.name, slug: r.slug, oracle_id: r.oracle, prints: r.prints, main: 0 });
        const size = Buffer.byteLength(json);
        entries.push([r.slug, r.oracle, offset, size]);
        bodies.push(json);
        offset += size;
    }
    const bytes = new TextEncoder().encode(`${JSON.stringify(entries)}\n${bodies.join("")}`);
    return { bytes, header: bucketHeader(bytes) };
}

const variants = makeBucket([
    { name: "Everythingamajig", slug: "everythingamajig", oracle: "e1", prints: [print("ust", "147a")] },
    { name: "Everythingamajig", slug: "everythingamajig-2", oracle: "e2", prints: [print("ust", "147c")] },
    { name: "Everythingamajigs", slug: "everythingamajigs", oracle: "e3", prints: [print("ust", "1")] },
]);

test("pickByName picks the same-name card that has the line's printing", () => {
    const { bytes, header } = variants;
    assert.equal(pickByName(bytes, header, "Everythingamajig", "UST", "147c")?.oracle_id, "e2");
    assert.equal(pickByName(bytes, header, "Everythingamajig", "UST", "147a")?.oracle_id, "e1");
    assert.equal(pickByName(bytes, header, "Everythingamajig")?.oracle_id, "e1");
    assert.equal(pickByName(bytes, header, "Everythingamajig", "UST", "999")?.oracle_id, "e1");
    assert.equal(pickByName(bytes, header, "Everythingamajig", "M21", "1")?.oracle_id, "e1");
});

test("pickByName picks a token that shares a real card's name", () => {
    const { bytes, header } = makeBucket([
        { name: "Soldier", slug: "soldier", oracle: "s1", prints: [print("xyz", "5")] },
        { name: "Soldier", slug: "soldier-token", oracle: "s2", prints: [print("tm20", "3")] },
    ]);
    assert.equal(pickByName(bytes, header, "Soldier", "TM20", "3")?.oracle_id, "s2");
    assert.equal(pickByName(bytes, header, "Soldier", "XYZ", "5")?.oracle_id, "s1");
    assert.equal(pickByName(bytes, header, "Soldier")?.oracle_id, "s1");
});

test("pickByName still matches full names and finds nothing for a front face alone", () => {
    const { bytes, header } = makeBucket([
        { name: "Fire // Ice", slug: "fire-ice", oracle: "f1", prints: [print("apc", "128")] },
    ]);
    assert.equal(pickByName(bytes, header, "Fire // Ice", "APC", "128")?.oracle_id, "f1");
    assert.equal(pickByName(bytes, header, "Fire"), undefined);
});
